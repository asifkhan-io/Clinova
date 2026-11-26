/**
 * Authorization at the edges for Phases 6b/7: the Server Actions and the staff
 * slot endpoint run the real guards. The clinic always comes from the session;
 * ids from another clinic in the form just aren't found.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { appointments, clinicMembers, clinics, platformAdmins, users } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
let currentUserId: string | null = null;
vi.mock("@/server/auth/session", () => ({
  getSession: async () => (currentUserId ? { user: { id: currentUserId, email: "t@test.local" } } : null),
}));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const actions = await import("@/server/actions/appointments");
const { GET: slots } = await import("@/app/api/clinic/slots/route");

const ids = {} as Record<"clinicA" | "clinicB" | "staffA" | "ownerB" | "admin" | "suspendedOwner" | "service" | "dentist", string>;
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
// Far enough ahead to be "today or later" whenever the suite runs.
const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const booking = () => ({ serviceId: ids.service, staffId: ids.dentist, date, time: "10:00", fullName: "Layla Omar", phone: "0512340000" });

beforeAll(async () => {
  const mk = async (name: string) => (await db.insert(users).values({ name, email: `${name}@test.local` }).returning({ id: users.id }))[0]!.id;
  const [a, b, s] = await db
    .insert(clinics)
    .values([
      { slug: "a", nameEn: "A", nameAr: "أ" },
      { slug: "b", nameEn: "B", nameAr: "ب" },
      { slug: "s", nameEn: "S", nameAr: "س", status: "suspended" },
    ])
    .returning({ id: clinics.id });
  ids.clinicA = a!.id;
  ids.clinicB = b!.id;
  ids.staffA = await mk("staff-a");
  ids.ownerB = await mk("owner-b");
  ids.admin = await mk("admin");
  ids.suspendedOwner = await mk("suspended-owner");
  await db.insert(clinicMembers).values([
    { clinicId: ids.clinicA, userId: ids.staffA, role: "clinic_staff" },
    { clinicId: ids.clinicB, userId: ids.ownerB, role: "clinic_owner" },
    { clinicId: s!.id, userId: ids.suspendedOwner, role: "clinic_owner" },
  ]);
  await db.insert(platformAdmins).values({ userId: ids.admin });
  const owner = { db, clinicId: ids.clinicA, userId: ids.staffA, role: "clinic_owner", clinicStatus: "trial" } as const;
  ids.service = (await services.createService(owner, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  ids.dentist = (await staffRepo.createStaff(owner, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  await hours.replaceStaffHours(owner, ids.dentist, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 720 })));
});

beforeEach(() => {
  currentUserId = null;
});

describe("Server Actions", () => {
  it("refuse the signed-out, the platform admin (no patient data, scope §3) and a suspended clinic", async () => {
    expect(await actions.createAppointmentAction(null, form(booking()))).toEqual({ ok: false, error: "unauthenticated" });
    currentUserId = ids.admin;
    expect(await actions.createAppointmentAction(null, form(booking()))).toEqual({ ok: false, error: "forbidden" });
    currentUserId = ids.suspendedOwner;
    expect(await actions.createAppointmentAction(null, form(booking()))).toEqual({ ok: false, error: "clinic_suspended" });
  });

  it("let a clinic_staff member book, and validate the phone", async () => {
    currentUserId = ids.staffA;
    expect(await actions.createAppointmentAction(null, form({ ...booking(), phone: "12" }))).toEqual({ ok: false, error: "phone" });
    const r = await actions.createAppointmentAction(null, form(booking()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.phoneE164).toBe("+966512340000");
  });

  it("another clinic's owner can't book clinic A's dentist or touch clinic A's appointment", async () => {
    const [mine] = await db.select().from(appointments).where(eq(appointments.clinicId, ids.clinicA));
    currentUserId = ids.ownerB;
    expect(await actions.createAppointmentAction(null, form({ ...booking(), time: "11:00" }))).toEqual({ ok: false, error: "not_bookable" });
    expect(await actions.cancelAppointmentAction(null, form({ appointmentId: mine!.id, expectedSequence: "0" }))).toEqual({ ok: false, error: "changed" });
    expect(await actions.rescheduleAppointmentAction(null, form({ ...booking(), appointmentId: mine!.id, expectedSequence: "0", time: "11:00" }))).toEqual({ ok: false, error: "not_found" });
    expect((await db.select().from(appointments).where(eq(appointments.id, mine!.id)))[0]).toMatchObject({ status: "booked", icsSequence: 0 });
  });

  it("reject junk ids without reaching the database", async () => {
    currentUserId = ids.staffA;
    expect(await actions.cancelAppointmentAction(null, form({ appointmentId: "1 OR 1=1", expectedSequence: "0" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.setOutcomeAction(null, form({ appointmentId: ids.service, status: "deleted" }))).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("Phase 8 actions", () => {
  // A well-formed v4 uuid that is nobody's appointment: enough to see which
  // answer the guard gives before any lookup happens.
  const nobodys = "123e4567-e89b-42d3-a456-426614174000";

  it("let any member re-send a lost link, which is reception's job", async () => {
    const [mine] = await db.select().from(appointments).where(eq(appointments.clinicId, ids.clinicA));
    currentUserId = ids.staffA;
    const reissued = await actions.reissueLinkAction(null, form({ appointmentId: mine!.id }));
    expect(reissued.ok).toBe(true);
    // Still scoped: another clinic's owner cannot touch clinic A's appointment.
    currentUserId = ids.ownerB;
    expect(await actions.reissueLinkAction(null, form({ appointmentId: mine!.id }))).toEqual({ ok: false, error: "not_found" });
  });

  it("let only an owner undo an outcome — recording one is not correcting one", async () => {
    expect(await actions.undoOutcomeAction(null, form({ appointmentId: nobodys }))).toEqual({ ok: false, error: "unauthenticated" });
    // A clinic_staff member may record an outcome but not reverse it.
    currentUserId = ids.staffA;
    expect(await actions.undoOutcomeAction(null, form({ appointmentId: nobodys }))).toEqual({ ok: false, error: "forbidden" });
    // An owner gets past the guard, and is then scoped to their own clinic.
    currentUserId = ids.ownerB;
    expect(await actions.undoOutcomeAction(null, form({ appointmentId: nobodys }))).toEqual({ ok: false, error: "not_found" });
  });

  it("reject a junk appointment id before reaching the database", async () => {
    currentUserId = ids.ownerB;
    expect(await actions.undoOutcomeAction(null, form({ appointmentId: "'; drop table appointments; --" }))).toEqual({ ok: false, error: "invalid_input" });
    expect(await actions.reissueLinkAction(null, form({ appointmentId: "not-a-uuid" }))).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("GET /api/clinic/slots", () => {
  const call = () => slots(new Request(`http://x/api/clinic/slots?serviceId=${ids.service}&staffId=${ids.dentist}&date=${date}`));

  it("is for signed-in clinic members only", async () => {
    expect((await call()).status).toBe(401);
    currentUserId = ids.admin;
    expect((await call()).status).toBe(403);
  });

  it("returns clinic A's suggestions to clinic A, and nothing to clinic B", async () => {
    currentUserId = ids.staffA;
    const mine = (await (await call()).json()) as { slots: number[] };
    expect(mine.slots.length).toBeGreaterThan(0);
    currentUserId = ids.ownerB;
    expect(await (await call()).json()).toEqual({ slots: [] });
  });
});
