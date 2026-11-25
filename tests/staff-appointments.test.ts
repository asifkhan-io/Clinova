/**
 * Phases 6b + 7, clinic side: manual booking, staff reschedule/cancel,
 * outcomes, patient records. Staff bend the SOFT rules (hours, lead time,
 * buffer, cutoff); nobody bends the no-overlap constraint or tenant isolation.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { appointments, auditLog, clinics, patients, users } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const clinicAppts = await import("@/server/db/repositories/clinic-appointments");
const patientsRepo = await import("@/server/db/repositories/patients");
const staffSvc = await import("@/server/services/staff-appointments");
const { createPublicBooking } = await import("@/server/services/booking");
const { getPatientAppointment } = await import("@/server/services/appointment-changes");
const { hashToken } = await import("@/server/services/tokens");
const { localToUtc } = await import("@/lib/time/zoned");

type Ctx = Parameters<typeof services.listServices>[0];
let ctx: Ctx;
let other: Ctx;
let cleaning: string;
let filling: string;
let sara: string;
let omar: string;
let otherDentist: string;
const NOW = Date.UTC(2027, 0, 1); // Friday 03:00 Riyadh
const DATE = "2027-01-03"; // Sunday
const at = (h: number, m = 0, date = DATE) => localToUtc(date, h * 60 + m, "Asia/Riyadh")!;
const row = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0]!;
const walkIn = (o: Partial<Parameters<typeof staffSvc.createStaffAppointment>[1]> = {}, nowMs = NOW) =>
  staffSvc.createStaffAppointment(ctx, { serviceId: cleaning, staffId: sara, startMs: at(9), fullName: "Fahad Saleh", phoneE164: "+966533333333", ...o }, nowMs);

beforeAll(async () => {
  const [u1, u2] = await db
    .insert(users)
    .values([
      { name: "Reception", email: "desk@smile.test" },
      { name: "Other", email: "desk@other.test" },
    ])
    .returning({ id: users.id });
  const [a, b] = await db
    .insert(clinics)
    .values([
      { slug: "smile", nameEn: "Smile", nameAr: "ابتسامة" }, // online booking OFF on purpose
      { slug: "other", nameEn: "Other", nameAr: "أخرى", bookingEnabled: true },
    ])
    .returning({ id: clinics.id });
  ctx = { db, clinicId: a!.id, userId: u1!.id, role: "clinic_staff", clinicStatus: "active" };
  other = { db, clinicId: b!.id, userId: u2!.id, role: "clinic_owner", clinicStatus: "active" };
  const owner = { ...ctx, role: "clinic_owner" } as const;
  await clinicsRepo.updateBookingRules(owner, { bufferMinutes: 15, minLeadMinutes: 120, maxHorizonDays: 7, changeCutoffMinutes: 1440, slotGranularityMinutes: 30 });
  cleaning = (await services.createService(owner, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  sara = (await staffRepo.createStaff(owner, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  omar = (await staffRepo.createStaff(owner, { displayNameEn: "Omar", displayNameAr: "عمر", titleEn: null, titleAr: null })).id;
  filling = (await services.createService(owner, { nameEn: "Filling", nameAr: "حشوة", descriptionEn: null, descriptionAr: null, durationMinutes: 45, priceMinor: null })).id;
  for (const id of [sara, omar]) await hours.replaceStaffHours(owner, id, [{ dayOfWeek: 0, startMinute: 540, endMinute: 720 }]);
  otherDentist = (await staffRepo.createStaff(other, { displayNameEn: "X", displayNameAr: "س", titleEn: null, titleAr: null })).id;
});

describe("manual booking (scope §4)", () => {
  it("books while online booking is off, records who did it, and returns a private link", async () => {
    const r = await walkIn();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await row(r.appointmentId)).toMatchObject({ source: "staff", createdByUserId: ctx.userId, status: "booked", accessTokenHash: hashToken(r.token) });
    expect((await getPatientAppointment(hashToken(r.token), NOW))?.appt.status).toBe("booked"); // the link works
    const [event] = await db.select().from(auditLog).where(eq(auditLog.entityId, r.appointmentId));
    expect(event).toMatchObject({ action: "appointment.created", actorType: "member", actorUserId: ctx.userId });
    expect(JSON.stringify(event!.metadata)).not.toMatch(/Fahad|966/);
  });

  it("stores no online-consent stamp for a patient the clinic registered itself", async () => {
    const [p] = await db.select().from(patients).where(eq(patients.phoneE164, "+966533333333"));
    expect(p!.consentAt).toBeNull();
  });

  it("bends the soft rules: outside working hours, back to back despite the buffer", async () => {
    expect((await walkIn({ startMs: at(20), phoneE164: "+966533333334", fullName: "Late Walk-in" })).ok).toBe(true); // 8 pm
    expect((await walkIn({ startMs: at(9, 30), phoneE164: "+966533333335", fullName: "Back To Back" })).ok).toBe(true); // straight after 09:00 (D13)
  });

  it("never bends the overlap rule", async () => {
    expect(await walkIn({ startMs: at(9, 15), phoneE164: "+966533333336", fullName: "Overlap" })).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("refuses yesterday, a time off the minute, and a dentist who doesn't do the service", async () => {
    await staffRepo.setStaffServices({ ...ctx, role: "clinic_owner" }, sara, [cleaning]);
    expect(await walkIn({ startMs: at(10) }, at(9, 0, "2027-01-04"))).toEqual({ ok: false, reason: "invalid_time" });
    expect(await walkIn({ startMs: at(10) + 30_000 })).toEqual({ ok: false, reason: "invalid_time" });
    expect(await walkIn({ serviceId: filling, startMs: at(11) })).toEqual({ ok: false, reason: "not_bookable" });
  });

  it("can't book another clinic's dentist (tenant isolation)", async () => {
    expect(await walkIn({ staffId: otherDentist, startMs: at(11) })).toEqual({ ok: false, reason: "not_bookable" });
  });

  it("an existing patient keeps their stored name", async () => {
    await walkIn({ startMs: at(11), staffId: omar, fullName: "Someone Else" });
    const [p] = await db.select().from(patients).where(eq(patients.phoneE164, "+966533333333"));
    expect(p!.fullName).toBe("Fahad Saleh");
  });
});

describe("suggested times for staff", () => {
  it("ignore lead time, buffer and the online horizon, but follow working hours", async () => {
    const now = at(9, 50); // 10 minutes before 10:00; online lead time is 2 hours
    const slots = await staffSvc.staffSlotSuggestions(ctx, { serviceId: cleaning, staffId: sara, date: DATE }, now);
    expect(slots).toContain(at(10)); // no lead time, and right after the 09:30 (no buffer)
    expect(slots).not.toContain(at(9, 30)); // taken
    expect(slots).not.toContain(at(20)); // outside hours: staff type it in instead
    const far = await staffSvc.staffSlotSuggestions(ctx, { serviceId: cleaning, staffId: sara, date: "2027-03-07" }, NOW);
    expect(far.length).toBeGreaterThan(0); // 2 months out, past the 7-day online horizon
  });
});

describe("staff reschedule and cancel (flows §7–8)", () => {
  let id: string;
  beforeAll(async () => {
    const r = await walkIn({ startMs: at(10, 30), phoneE164: "+966544444444", fullName: "Huda" });
    if (!r.ok) throw new Error(r.reason);
    id = r.appointmentId;
  });

  it("moves time AND dentist inside the patient cutoff, without using up the patient's moves", async () => {
    const r = await staffSvc.staffRescheduleAppointment(ctx, { appointmentId: id, expectedSequence: 0, serviceId: cleaning, staffId: omar, startMs: at(10) }, at(9));
    expect(r).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ staffId: omar, icsSequence: 1, rescheduleCount: 0 });
    const [event] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "appointment.rescheduled")));
    expect(event).toMatchObject({ actorType: "member", actorUserId: ctx.userId });
    expect(event!.metadata).toMatchObject({ from: { staffId: sara }, to: { staffId: omar } });
  });

  it("can change the service too; the end time follows the new service", async () => {
    await staffRepo.setStaffServices({ ...ctx, role: "clinic_owner" }, omar, [cleaning, filling]);
    expect(await staffSvc.staffRescheduleAppointment(ctx, { appointmentId: id, expectedSequence: 1, serviceId: filling, staffId: omar, startMs: at(10) }, NOW)).toEqual({ ok: true });
    const moved = await row(id);
    expect(moved.endAt.getTime() - moved.startAt.getTime()).toBe(45 * 60_000);
  });

  it("refuses a stale screen and a real overlap", async () => {
    expect(await staffSvc.staffRescheduleAppointment(ctx, { appointmentId: id, expectedSequence: 0, serviceId: cleaning, staffId: omar, startMs: at(11, 30) }, NOW)).toEqual({ ok: false, reason: "changed" });
    expect(await staffSvc.staffRescheduleAppointment(ctx, { appointmentId: id, expectedSequence: 2, serviceId: cleaning, staffId: sara, startMs: at(9) }, NOW)).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("cancels as staff, recording who", async () => {
    expect(await staffSvc.staffCancelAppointment(ctx, { appointmentId: id, expectedSequence: 2 }, NOW)).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ status: "cancelled", cancelledBy: "staff", cancelledByUserId: ctx.userId, icsSequence: 3 });
  });

  it("can't cancel once it has started — that's an outcome, not a cancellation", async () => {
    const r = await walkIn({ startMs: at(11, 30), phoneE164: "+966544444445", fullName: "Started" });
    if (!r.ok) throw new Error(r.reason);
    expect(await staffSvc.staffCancelAppointment(ctx, { appointmentId: r.appointmentId, expectedSequence: 0 }, at(11, 35))).toEqual({ ok: false, reason: "started" });
  });
});

describe("outcomes: completed / no-show", () => {
  let id: string;
  beforeAll(async () => {
    const r = await walkIn({ startMs: at(11, 0), staffId: sara, phoneE164: "+966555555555", fullName: "Outcome" });
    if (!r.ok) throw new Error(r.reason);
    id = r.appointmentId;
  });

  it("only after the start, then the status is final", async () => {
    expect(await staffSvc.staffSetOutcome(ctx, { appointmentId: id, status: "completed" }, at(10, 59))).toEqual({ ok: false, reason: "not_started" });
    expect(await staffSvc.staffSetOutcome(ctx, { appointmentId: id, status: "no_show" }, at(11, 20))).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ status: "no_show" });
    expect((await row(id)).statusUpdatedAt?.getTime()).toBe(at(11, 20));
    expect(await staffSvc.staffSetOutcome(ctx, { appointmentId: id, status: "completed" }, at(11, 30))).toEqual({ ok: false, reason: "changed" });
  });
});

describe("tenant isolation on the clinic side", () => {
  it("another clinic sees none of these appointments and can change none of them", async () => {
    const [mine] = await clinicAppts.listAppointments(ctx, { fromMs: at(0), toMs: at(23) });
    expect(mine).toBeDefined();
    expect(await clinicAppts.listAppointments(other, { fromMs: at(0), toMs: at(23) })).toEqual([]);
    expect(await clinicAppts.getAppointment(other, mine!.id)).toBeNull();
    expect(await staffSvc.staffRescheduleAppointment(other, { appointmentId: mine!.id, expectedSequence: mine!.icsSequence, serviceId: cleaning, staffId: sara, startMs: at(11) }, NOW)).toEqual({ ok: false, reason: "not_found" });
    expect(await staffSvc.staffCancelAppointment(other, { appointmentId: mine!.id, expectedSequence: mine!.icsSequence }, NOW)).toEqual({ ok: false, reason: "changed" });
    expect(await staffSvc.staffSetOutcome(other, { appointmentId: mine!.id, status: "completed" }, at(23))).toEqual({ ok: false, reason: "changed" });
    expect(await row(mine!.id)).toMatchObject({ status: mine!.status, icsSequence: mine!.icsSequence });
  });

  it("another clinic can't open, find or edit these patients", async () => {
    const [p] = await patientsRepo.searchPatients(ctx, { query: "Fahad", limit: 10 });
    expect(p).toBeDefined();
    expect(await patientsRepo.searchPatients(other, { query: "Fahad", limit: 10 })).toEqual([]);
    expect(await patientsRepo.getPatientRecord(other, p!.id)).toBeNull();
    expect(await patientsRepo.updatePatient(other, p!.id, { fullName: "Hacked", phoneE164: "+966500000000" })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("patient records", () => {
  it("search matches part of a name, or a phone typed the local way", async () => {
    expect((await patientsRepo.searchPatients(ctx, { query: "fah", limit: 10 })).map((p) => p.fullName)).toEqual(["Fahad Saleh"]);
    expect((await patientsRepo.searchPatients(ctx, { query: "0533 333 333", limit: 10 })).map((p) => p.fullName)).toEqual(["Fahad Saleh"]);
    expect(await patientsRepo.searchPatients(ctx, { query: "%", limit: 10 })).toEqual([]); // a wildcard is just text
  });

  it("opening a record is audited, with ids only", async () => {
    const [p] = await patientsRepo.searchPatients(ctx, { query: "Fahad", limit: 1 });
    const record = await patientsRepo.getPatientRecord(ctx, p!.id);
    expect(record?.history.length).toBe(2); // 09:00 with Sara, 11:00 with Omar
    const events = await db.select().from(auditLog).where(and(eq(auditLog.entityId, p!.id), eq(auditLog.action, "patient.record_viewed")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: "member", actorUserId: ctx.userId, metadata: null });
  });

  it("edits a name; refuses a phone that belongs to another record", async () => {
    const [p] = await patientsRepo.searchPatients(ctx, { query: "Fahad", limit: 1 });
    expect(await patientsRepo.updatePatient(ctx, p!.id, { fullName: "Fahad Al-Saleh", phoneE164: "+966533333333" })).toEqual({ ok: true });
    expect(await patientsRepo.updatePatient(ctx, p!.id, { fullName: "Fahad Al-Saleh", phoneE164: "+966544444444" })).toEqual({ ok: false, reason: "phone_taken" });
    const [event] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, p!.id), eq(auditLog.action, "patient.updated")));
    expect(event!.metadata).toEqual({ fields: ["fullName"] });
  });
});

describe("online and staff bookings share one calendar", () => {
  it("an online booking can't take a time a staff booking holds", async () => {
    const owner = { ...ctx, role: "clinic_owner" } as const;
    await clinicsRepo.setBookingEnabled(owner, true);
    const r = await createPublicBooking(ctx, { serviceId: cleaning, staffId: sara, startMs: at(9), fullName: "Online", phoneE164: "+966566666666" }, NOW);
    expect(r).toEqual({ ok: false, reason: "slot_unavailable" });
  });
});
