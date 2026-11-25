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

/**
 * Phase 8b. The private link is shown once, so losing it used to mean
 * cancelling and rebooking. Reissuing must kill the old link immediately,
 * stay inside the clinic, and leave the appointment itself untouched.
 */
describe("reissuing a private link", () => {
  const FREE = "2027-01-05";

  it("issues a working link and kills the old one", async () => {
    const booked = await walkIn({ startMs: at(9, 0, FREE) });
    if (!booked.ok) throw new Error("setup: booking failed");

    const again = await staffSvc.reissueAppointmentLink(ctx, booked.appointmentId);
    if (!again.ok) throw new Error(`setup: reissue failed (${again.reason})`);

    expect(again.token).not.toBe(booked.token);
    expect(await getPatientAppointment(hashToken(booked.token), NOW)).toBeNull();
    expect(await getPatientAppointment(hashToken(again.token), NOW)).not.toBeNull();
  });

  it("leaves the appointment itself alone, so a calendar entry and an open screen stay valid", async () => {
    const booked = await walkIn({ startMs: at(10, 0, FREE) });
    if (!booked.ok) throw new Error("setup: booking failed");
    const before = await row(booked.appointmentId);

    await staffSvc.reissueAppointmentLink(ctx, booked.appointmentId);
    const after = await row(booked.appointmentId);

    expect(after.icsSequence).toBe(before.icsSequence);
    expect(after.startAt).toEqual(before.startAt);
    expect(after.staffId).toBe(before.staffId);
    expect(after.status).toBe("booked");
    expect(after.accessTokenHash).not.toBe(before.accessTokenHash);
  });

  it("records who replaced the link, and never the link itself", async () => {
    const booked = await walkIn({ startMs: at(11, 0, FREE) });
    if (!booked.ok) throw new Error("setup: booking failed");
    const again = await staffSvc.reissueAppointmentLink(ctx, booked.appointmentId);
    if (!again.ok) throw new Error("setup: reissue failed");

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, booked.appointmentId), eq(auditLog.action, "appointment.link_reissued")));

    expect(entry?.actorUserId).toBe(ctx.userId);
    expect(entry?.clinicId).toBe(ctx.clinicId);
    const recorded = JSON.stringify(entry?.metadata ?? {});
    expect(recorded).not.toContain(again.token);
    expect(recorded).not.toContain(hashToken(again.token));
  });

  it("refuses an appointment that belongs to another clinic", async () => {
    const booked = await walkIn({ startMs: at(12, 0, FREE) });
    if (!booked.ok) throw new Error("setup: booking failed");

    expect(await staffSvc.reissueAppointmentLink(other, booked.appointmentId)).toEqual({ ok: false, reason: "not_found" });
    // The real link still works: the refusal changed nothing.
    expect(await getPatientAppointment(hashToken(booked.token), NOW)).not.toBeNull();
  });

  it("refuses once there is nothing left to manage", async () => {
    const booked = await walkIn({ startMs: at(13, 0, FREE) });
    if (!booked.ok) throw new Error("setup: booking failed");
    const current = await row(booked.appointmentId);
    await staffSvc.staffCancelAppointment(ctx, { appointmentId: booked.appointmentId, expectedSequence: current.icsSequence }, NOW);

    expect(await staffSvc.reissueAppointmentLink(ctx, booked.appointmentId)).toEqual({ ok: false, reason: "changed" });
  });
});

/**
 * Phase 8c. Completed and No-show stay final, except on the appointment's own
 * day and only for the owner. The two directions are not symmetric: a no-show
 * frees its slot, so undoing one can find the time already gone.
 */
describe("undoing an outcome", () => {
  const DAY = "2027-01-06";
  const DURING = at(14, 0, DAY); // same clinic day, after the appointment
  const NEXT_DAY = at(1, 0, "2027-01-07");
  const owner = () => ({ ...ctx, role: "clinic_owner" }) as Ctx;

  // The appointment must already have started before an outcome can be set,
  // so every start time here is earlier in the clinic day than DURING.
  const settled = async (startMs: number, status: "completed" | "no_show") => {
    const booked = await walkIn({ startMs });
    if (!booked.ok) throw new Error("setup: booking failed");
    const outcome = await staffSvc.staffSetOutcome(ctx, { appointmentId: booked.appointmentId, status }, DURING);
    if (!outcome.ok) throw new Error(`setup: outcome failed (${outcome.reason})`);
    return booked.appointmentId;
  };

  it("puts a mis-tapped no-show back to booked on the same day", async () => {
    const id = await settled(at(9, 0, DAY), "no_show");
    expect(await staffSvc.staffUndoOutcome(owner(), id, DURING)).toEqual({ ok: true });
    expect((await row(id)).status).toBe("booked");
  });

  it("puts a mis-tapped completed back to booked, which can never clash", async () => {
    const id = await settled(at(10, 0, DAY), "completed");
    expect(await staffSvc.staffUndoOutcome(owner(), id, DURING)).toEqual({ ok: true });
    expect((await row(id)).status).toBe("booked");
  });

  it("says the slot is gone when a no-show's freed time was taken", async () => {
    const id = await settled(at(11, 0, DAY), "no_show");
    // A no-show stops blocking, so this second booking is allowed to land.
    const replacement = await walkIn({ startMs: at(11, 0, DAY), phoneE164: "+966544444444" });
    expect(replacement.ok).toBe(true);

    expect(await staffSvc.staffUndoOutcome(owner(), id, DURING)).toEqual({ ok: false, reason: "slot_taken" });
    expect((await row(id)).status).toBe("no_show");
  });

  it("closes the window at the end of the appointment's own day", async () => {
    const id = await settled(at(12, 0, DAY), "no_show");
    expect(await staffSvc.staffUndoOutcome(owner(), id, NEXT_DAY)).toEqual({ ok: false, reason: "too_late" });
    expect((await row(id)).status).toBe("no_show");
  });

  it("refuses an appointment belonging to another clinic", async () => {
    const id = await settled(at(13, 0, DAY), "no_show");
    expect(await staffSvc.staffUndoOutcome({ ...other, role: "clinic_owner" } as Ctx, id, DURING)).toEqual({ ok: false, reason: "not_found" });
    expect((await row(id)).status).toBe("no_show");
  });

  it("records the correction, naming who made it and what it reversed", async () => {
    const id = await settled(at(13, 30, DAY), "no_show");
    await staffSvc.staffUndoOutcome(owner(), id, DURING);
    const entries = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, "appointment.status_changed")));
    const undone = entries.find((e) => (e.metadata as { undo?: boolean } | null)?.undo === true);
    expect(undone?.actorUserId).toBe(ctx.userId);
    expect(undone?.metadata).toMatchObject({ from: "no_show", to: "booked" });
  });

  it("offers the button only to an owner, and only on the day", async () => {
    const appointment = { status: "no_show", startAt: new Date(at(16, 0, DAY)) };
    expect(staffSvc.canUndoOutcome(appointment, "clinic_owner", "Asia/Riyadh", DURING)).toBe(true);
    expect(staffSvc.canUndoOutcome(appointment, "clinic_staff", "Asia/Riyadh", DURING)).toBe(false);
    expect(staffSvc.canUndoOutcome(appointment, "clinic_owner", "Asia/Riyadh", NEXT_DAY)).toBe(false);
    expect(staffSvc.canUndoOutcome({ status: "booked", startAt: new Date(at(16, 0, DAY)) }, "clinic_owner", "Asia/Riyadh", DURING)).toBe(false);
  });
});
