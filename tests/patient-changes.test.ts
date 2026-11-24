/**
 * Phase 6a: the patient moves or cancels from their private link. The rules
 * live in one place (patientChangeState) and every path re-checks them on the
 * server; the exclusion constraint has the last word on overlaps.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { appointments, auditLog, clinics } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const appts = await import("@/server/db/repositories/appointments");
const { createPublicBooking } = await import("@/server/services/booking");
const changes = await import("@/server/services/appointment-changes");
const { hashToken } = await import("@/server/services/tokens");
const { localToUtc } = await import("@/lib/time/zoned");
const { GET: slotsRoute } = await import("@/app/api/public/a/[token]/availability/route");

type Ctx = Parameters<typeof services.listServices>[0];
let ctx: Ctx;
let other: Ctx;
let cleaning: string;
let sara: string;
const NOW = Date.UTC(2027, 0, 1); // Friday 03:00 Riyadh
const DATE = "2027-01-03"; // Sunday
const at = (h: number, m = 0) => localToUtc(DATE, h * 60 + m, "Asia/Riyadh")!;

const book = async (startMs: number, phoneE164: string) => {
  const r = await createPublicBooking(ctx, { serviceId: cleaning, staffId: sara, startMs, fullName: "Noura Ali", phoneE164 }, NOW);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const row = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0]!;

beforeAll(async () => {
  const [a, b] = await db
    .insert(clinics)
    .values([
      { slug: "smile", nameEn: "Smile", nameAr: "ابتسامة", bookingEnabled: true },
      { slug: "other", nameEn: "Other", nameAr: "أخرى", bookingEnabled: true },
    ])
    .returning({ id: clinics.id });
  const base = { db, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "trial" } as const;
  ctx = { ...base, clinicId: a!.id };
  other = { ...base, clinicId: b!.id };
  await clinicsRepo.updateBookingRules(ctx, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 365, changeCutoffMinutes: 120, slotGranularityMinutes: 30 });
  cleaning = (await services.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  sara = (await staffRepo.createStaff(ctx, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  await hours.replaceStaffHours(ctx, sara, [{ dayOfWeek: 0, startMinute: 540, endMinute: 720 }]); // Sun 09:00–12:00
});

describe("what the link may do (patientChangeState)", () => {
  const facts = { status: "booked", startAt: new Date(at(10)), rescheduleCount: 0, clinic: { bookingEnabled: true, changeCutoffMinutes: 120 } };

  it("allows both well before the appointment", () => {
    expect(changes.patientChangeState(facts, NOW)).toEqual({ canCancel: true, reschedule: "allowed" });
  });

  it("closes rescheduling at the cutoff, but cancelling stays open until the start (D12)", () => {
    expect(changes.patientChangeState(facts, at(8))).toEqual({ canCancel: true, reschedule: "cutoff_passed" });
    expect(changes.patientChangeState(facts, at(10))).toEqual({ canCancel: false, reschedule: "unavailable" });
  });

  it("stops after two patient moves, and while online booking is off", () => {
    expect(changes.patientChangeState({ ...facts, rescheduleCount: 2 }, NOW).reschedule).toBe("limit_reached");
    expect(changes.patientChangeState({ ...facts, clinic: { ...facts.clinic, bookingEnabled: false } }, NOW)).toEqual({ canCancel: true, reschedule: "booking_closed" });
  });

  it("offers nothing on a cancelled or finished appointment", () => {
    for (const status of ["cancelled", "completed", "no_show"]) {
      expect(changes.patientChangeState({ ...facts, status }, NOW)).toEqual({ canCancel: false, reschedule: "unavailable" });
    }
  });
});

describe("patient reschedule (flows §7)", () => {
  let token: string;
  let id: string;

  beforeAll(async () => {
    const r = await book(at(9), "+966500000101");
    token = r.token;
    id = r.appointmentId;
    await book(at(10), "+966500000102"); // someone else at 10:00
  });

  it("offers the same dentist's open times, minus its own current time and other bookings", async () => {
    const slots = await changes.patientRescheduleSlots(hashToken(token), DATE, NOW);
    expect(slots).not.toContain(at(9)); // where it already is
    expect(slots).not.toContain(at(10)); // taken
    expect(slots).toContain(at(9, 30));
    expect(slots).toContain(at(11, 30));
  });

  it("the slot endpoint answers an unknown link with an empty list, not a 404", async () => {
    const req = (t: string) => slotsRoute(new Request(`http://x/api/public/a/${t}/availability?date=${DATE}`), { params: Promise.resolve({ token: t }) });
    const unknown = await req("x".repeat(43));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ slots: [] });
    expect(((await (await req(token)).json()) as { slots: number[] }).slots.length).toBeGreaterThan(0);
  });

  it("moves the appointment in place: same row, same link, new calendar revision, audited without PII", async () => {
    const r = await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(11), expectedSequence: 0 }, NOW);
    expect(r).toEqual({ ok: true });
    const moved = await row(id);
    expect(moved.startAt.getTime()).toBe(at(11));
    expect(moved.endAt.getTime()).toBe(at(11, 30));
    expect(moved).toMatchObject({ icsSequence: 1, rescheduleCount: 1, status: "booked", accessTokenHash: hashToken(token) });

    const [event] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "appointment.rescheduled")));
    expect(event).toMatchObject({ actorType: "patient", actorUserId: null });
    expect(event!.metadata).toMatchObject({ from: { startAt: new Date(at(9)).toISOString() }, to: { startAt: new Date(at(11)).toISOString() } });
    expect(JSON.stringify(event!.metadata)).not.toMatch(/Noura|966/);
  });

  it("the old time is free again for the next patient", async () => {
    await expect(book(at(9), "+966500000103")).resolves.toMatchObject({ ok: true });
  });

  it("refuses a stale page (old sequence) instead of overwriting the newer change", async () => {
    expect(await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(11, 30), expectedSequence: 0 }, NOW)).toEqual({ ok: false, reason: "changed" });
    expect((await row(id)).startAt.getTime()).toBe(at(11));
  });

  it("refuses a time that isn't open, and a time that isn't on the grid", async () => {
    expect(await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(10), expectedSequence: 1 }, NOW)).toEqual({ ok: false, reason: "slot_unavailable" });
    expect(await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(11, 10), expectedSequence: 1 }, NOW)).toEqual({ ok: false, reason: "slot_unavailable" });
    expect(await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(13), expectedSequence: 1 }, NOW)).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("refuses inside the change cutoff, even if the page still showed the button", async () => {
    expect(await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(11, 30), expectedSequence: 1 }, at(9, 30))).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("allows a second move, then sends the patient to the phone", async () => {
    expect(await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(11, 30), expectedSequence: 1 }, NOW)).toEqual({ ok: true });
    expect(await changes.reschedulePatientAppointment(hashToken(token), { startMs: at(9, 30), expectedSequence: 2 }, NOW)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await changes.patientRescheduleSlots(hashToken(token), DATE, NOW)).toEqual([]);
    expect((await row(id)).rescheduleCount).toBe(2);
  });

  it("the database still refuses an overlap that skipped every check (exclusion constraint on UPDATE)", async () => {
    const victim = await book(at(9, 30), "+966500000104");
    const r = await appts.moveAppointment(ctx, { appointmentId: victim.appointmentId, expectedSequence: 0, staffId: sara, serviceId: cleaning, startMs: at(11, 30), endMs: at(12), actor: { type: "patient" } });
    expect(r).toEqual({ ok: false, reason: "slot_taken" });
    expect((await row(victim.appointmentId)).startAt.getTime()).toBe(at(9, 30)); // rolled back
  });

  it("another clinic's scope can't move this appointment (tenant isolation)", async () => {
    const r = await appts.moveAppointment(other, { appointmentId: id, expectedSequence: 2, staffId: sara, serviceId: cleaning, startMs: at(9), endMs: at(9, 30), actor: { type: "patient" } });
    expect(r).toEqual({ ok: false, reason: "changed" });
    expect((await row(id)).startAt.getTime()).toBe(at(11, 30));
  });
});

describe("patient cancel (flows §8)", () => {
  let token: string;
  let id: string;

  beforeAll(async () => {
    const r = await book(at(10, 30), "+966500000201");
    token = r.token;
    id = r.appointmentId;
  });

  it("refuses a stale page, then cancels: status, who, when, new calendar revision, audit", async () => {
    expect(await changes.cancelPatientAppointment(hashToken(token), { expectedSequence: 5 }, NOW)).toEqual({ ok: false, reason: "changed" });
    // Inside the reschedule cutoff on purpose: cancelling has none (D12).
    const late = at(9, 45);
    expect(await changes.cancelPatientAppointment(hashToken(token), { expectedSequence: 0 }, late)).toEqual({ ok: true });
    const cancelled = await row(id);
    expect(cancelled).toMatchObject({ status: "cancelled", cancelledBy: "patient", cancelledByUserId: null, icsSequence: 1 });
    expect(cancelled.cancelledAt?.getTime()).toBe(late);
    const [event] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "appointment.cancelled")));
    expect(event).toMatchObject({ actorType: "patient" });
    expect(JSON.stringify(event!.metadata)).not.toMatch(/Noura|966/);
  });

  it("the link still opens and shows the cancelled state, with nothing left to change", async () => {
    const page = await changes.getPatientAppointment(hashToken(token), NOW);
    expect(page?.appt.status).toBe("cancelled");
    expect(page?.changes).toEqual({ canCancel: false, reschedule: "unavailable" });
    expect(await changes.cancelPatientAppointment(hashToken(token), { expectedSequence: 1 }, NOW)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("frees the slot immediately", async () => {
    await expect(book(at(10, 30), "+966500000202")).resolves.toMatchObject({ ok: true });
  });

  it("can't cancel once the appointment has started", async () => {
    const r = await book(at(9, 0) + 7 * 86_400_000, "+966500000203"); // next Sunday 09:00
    expect(await changes.cancelPatientAppointment(hashToken(r.token), { expectedSequence: 0 }, r.startMs)).toEqual({ ok: false, reason: "not_allowed" });
  });
});
