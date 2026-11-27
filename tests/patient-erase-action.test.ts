/**
 * Phase 9d — the "Erase patient data" action at the edge: the real guards
 * run. Owner only, the confirmation is checked on the server, and the clinic
 * comes from the session, so another clinic's patient id is simply not found.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clinicMembers, clinics, patients, users } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
let currentUserId: string | null = null;
vi.mock("@/server/auth/session", () => ({
  getSession: async () => (currentUserId ? { user: { id: currentUserId, email: "t@test.local" } } : null),
}));

const { erasePatientAction } = await import("@/server/actions/appointments");
const { isErasedPhone } = await import("@/server/db/repositories/patients");

const ids = {} as Record<"owner" | "staff" | "otherOwner" | "suspendedOwner" | "patient" | "suspendedPatient", string>;
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const erase = (patientId: string, confirm = "yes") => erasePatientAction(null, form({ patientId, ...(confirm ? { confirm } : {}) }));
const row = async (id: string) => (await db.select().from(patients).where(eq(patients.id, id)))[0]!;

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
  ids.owner = await mk("owner");
  ids.staff = await mk("staff");
  ids.otherOwner = await mk("other-owner");
  ids.suspendedOwner = await mk("suspended-owner");
  await db.insert(clinicMembers).values([
    { clinicId: a!.id, userId: ids.owner, role: "clinic_owner" },
    { clinicId: a!.id, userId: ids.staff, role: "clinic_staff" },
    { clinicId: b!.id, userId: ids.otherOwner, role: "clinic_owner" },
    { clinicId: s!.id, userId: ids.suspendedOwner, role: "clinic_owner" },
  ]);
  ids.patient = (await db.insert(patients).values({ clinicId: a!.id, fullName: "Noura Ali", phoneE164: "+966512345678" }).returning({ id: patients.id }))[0]!.id;
  ids.suspendedPatient = (await db.insert(patients).values({ clinicId: s!.id, fullName: "Hana", phoneE164: "+966512340001" }).returning({ id: patients.id }))[0]!.id;
});

beforeEach(() => {
  currentUserId = null;
});

describe("erasePatientAction", () => {
  it("refuses a signed-out caller", async () => {
    expect(await erase(ids.patient)).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("refuses clinic staff: erasing is the owner's call", async () => {
    currentUserId = ids.staff;
    expect(await erase(ids.patient)).toEqual({ ok: false, error: "forbidden" });
    expect((await row(ids.patient)).anonymizedAt).toBeNull();
  });

  it("refuses a suspended clinic", async () => {
    currentUserId = ids.suspendedOwner;
    expect(await erase(ids.suspendedPatient)).toEqual({ ok: false, error: "clinic_suspended" });
  });

  it("can't reach another clinic's patient", async () => {
    currentUserId = ids.otherOwner;
    expect(await erase(ids.patient)).toEqual({ ok: false, error: "not_found" });
    expect((await row(ids.patient)).anonymizedAt).toBeNull();
  });

  it("needs the confirmation ticked, checked on the server", async () => {
    currentUserId = ids.owner;
    expect(await erase(ids.patient, "")).toEqual({ ok: false, error: "invalid_input" });
    expect(await erase(ids.patient, "on")).toEqual({ ok: false, error: "invalid_input" });
    expect((await row(ids.patient)).anonymizedAt).toBeNull();
  });

  it("lets the owner erase, once", async () => {
    currentUserId = ids.owner;
    expect(await erase(ids.patient)).toEqual({ ok: true, data: { cancelledUpcoming: 0 } });
    const p = await row(ids.patient);
    expect(p.anonymizedAt).not.toBeNull();
    expect(isErasedPhone(p.phoneE164)).toBe(true);
    expect(await erase(ids.patient)).toEqual({ ok: false, error: "already_anonymized" });
  });
});
