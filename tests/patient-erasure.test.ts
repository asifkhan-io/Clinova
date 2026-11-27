/**
 * Phase 9 — erasure on the patient's request (scope §8): anonymize, never
 * delete. The clinic keeps its history; the person disappears from it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { appointments, auditLog, clinics, patients, users } from "@/db/schema";
import { createTestDb } from "./helpers/db";
import { expectNoPii } from "./helpers/pii";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const patientsRepo = await import("@/server/db/repositories/patients");
const { createPublicBooking } = await import("@/server/services/booking");
const { getPatientAppointment } = await import("@/server/services/appointment-changes");
const { hashToken } = await import("@/server/services/tokens");
const { localToUtc } = await import("@/lib/time/zoned");

type Ctx = Parameters<typeof services.listServices>[0];
let ctx: Ctx;
let other: Ctx;
let cleaning: string;
let sara: string;
const PHONE = "+966512345678";
const PAST = Date.UTC(2027, 0, 1); // when the bookings are made
const DATE = "2027-01-03"; // Sunday
const at = (h: number, m = 0, date = DATE) => localToUtc(date, h * 60 + m, "Asia/Riyadh")!;
const ERASE_AT = at(10, 30); // between the 09:00 visit and the 11:00 one

const book = (startMs: number, phoneE164 = PHONE, fullName = "Noura Ali") =>
  createPublicBooking(ctx, { serviceId: cleaning, staffId: sara, startMs, fullName, phoneE164 }, PAST);
const patientRow = async (id: string) => (await db.select().from(patients).where(eq(patients.id, id)))[0]!;
const apptRow = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0]!;

let nouraId: string;
let earlier: { id: string; token: string };
let later: { id: string; token: string };

beforeAll(async () => {
  const [u, u2] = await db.insert(users).values([{ name: "Owner", email: "owner@smile.test" }, { name: "Other", email: "owner@other.test" }]).returning({ id: users.id });
  const [a, b] = await db
    .insert(clinics)
    .values([
      { slug: "smile", nameEn: "Smile", nameAr: "ابتسامة", bookingEnabled: true },
      { slug: "other", nameEn: "Other", nameAr: "أخرى" },
    ])
    .returning({ id: clinics.id });
  ctx = { db, clinicId: a!.id, userId: u!.id, role: "clinic_owner", clinicStatus: "active" };
  other = { db, clinicId: b!.id, userId: u2!.id, role: "clinic_owner", clinicStatus: "active" };
  await clinicsRepo.updateBookingRules(ctx, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 365, changeCutoffMinutes: 0, slotGranularityMinutes: 30 });
  cleaning = (await services.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  sara = (await staffRepo.createStaff(ctx, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  await hours.replaceStaffHours(ctx, sara, [{ dayOfWeek: 0, startMinute: 480, endMinute: 1080 }]);

  const r1 = await book(at(9));
  const r2 = await book(at(11));
  if (!r1.ok || !r2.ok) throw new Error("setup bookings failed");
  earlier = { id: r1.appointmentId, token: r1.token };
  later = { id: r2.appointmentId, token: r2.token };
  nouraId = (await apptRow(earlier.id)).patientId;
  await book(at(12), "+966500000009", "Someone Else");
});

describe("erasing a patient", () => {
  it("can't reach another clinic's patient", async () => {
    expect(await patientsRepo.anonymizePatient(other, nouraId, ERASE_AT)).toEqual({ ok: false, reason: "not_found" });
    expect((await patientRow(nouraId)).anonymizedAt).toBeNull();
  });

  it("overwrites name and phone, clears consent, and keeps the row", async () => {
    expect(await patientsRepo.anonymizePatient(ctx, nouraId, ERASE_AT)).toEqual({ ok: true, cancelledUpcoming: 1 });
    const p = await patientRow(nouraId);
    expect(p).toMatchObject({ fullName: patientsRepo.ERASED_NAME, phoneE164: patientsRepo.ERASED_PHONE, consentAt: null, consentPolicyVersion: null });
    expect(p.anonymizedAt?.getTime()).toBe(ERASE_AT);
    expect(JSON.stringify(p)).not.toMatch(/Noura|512345678/);
  });

  it("keeps the clinic's history: past visits untouched, upcoming ones cancelled, no rows deleted", async () => {
    expect(await apptRow(earlier.id)).toMatchObject({ status: "booked", patientId: nouraId });
    expect(await apptRow(later.id)).toMatchObject({ status: "cancelled", cancelledBy: "staff", cancelledByUserId: ctx.userId, patientId: nouraId });
    expect(await db.select().from(appointments).where(eq(appointments.patientId, nouraId))).toHaveLength(2);
    // Cancelling frees the slot for the next patient.
    expect((await book(at(11), "+966511111111", "Next Patient")).ok).toBe(true);
  });

  it("kills every private link the patient held", async () => {
    expect(await getPatientAppointment(hashToken(earlier.token), PAST)).toBeNull();
    expect(await getPatientAppointment(hashToken(later.token), PAST)).toBeNull();
  });

  it("audits once, with ids and counts only", async () => {
    const events = await db.select().from(auditLog).where(and(eq(auditLog.entityId, nouraId), eq(auditLog.action, "patient.anonymized")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: "member", actorUserId: ctx.userId, clinicId: ctx.clinicId });
    expect(events[0]!.metadata).toMatchObject({ cancelledUpcoming: 1, appointmentIds: expect.arrayContaining([earlier.id, later.id]) });
    expectNoPii(events[0]!.metadata, "Noura");
  });

  it("can't be repeated, and the record can't be given a name or number again", async () => {
    expect(await patientsRepo.anonymizePatient(ctx, nouraId, ERASE_AT)).toEqual({ ok: false, reason: "already_anonymized" });
    expect(await patientsRepo.updatePatient(ctx, nouraId, { fullName: "Noura Ali", phoneE164: PHONE })).toEqual({ ok: false, reason: "not_found" });
  });

  it("leaves other patients alone", async () => {
    const [someone] = await db.select().from(patients).where(eq(patients.phoneE164, "+966500000009"));
    expect(someone).toMatchObject({ fullName: "Someone Else", anonymizedAt: null });
  });

  it("a returning person gets a fresh record, never the erased one", async () => {
    const r = await book(at(14), PHONE, "Noura Ali");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fresh = (await apptRow(r.appointmentId)).patientId;
    expect(fresh).not.toBe(nouraId);
    expect(await patientRow(fresh)).toMatchObject({ fullName: "Noura Ali", phoneE164: PHONE, anonymizedAt: null });
    expect((await patientRow(nouraId)).fullName).toBe(patientsRepo.ERASED_NAME);
  });

  it("several erased patients can coexist (the phone rule ignores erased records)", async () => {
    const [someone] = await db.select({ id: patients.id }).from(patients).where(eq(patients.phoneE164, "+966500000009"));
    expect((await patientsRepo.anonymizePatient(ctx, someone!.id, ERASE_AT)).ok).toBe(true);
    const erased = await db.select().from(patients).where(and(eq(patients.clinicId, ctx.clinicId), eq(patients.phoneE164, patientsRepo.ERASED_PHONE)));
    expect(erased.length).toBeGreaterThanOrEqual(2);
  });

  it("the database still refuses two live records with one phone", async () => {
    await expect(db.insert(patients).values({ clinicId: ctx.clinicId, fullName: "Dup", phoneE164: PHONE })).rejects.toThrow();
  });
});
