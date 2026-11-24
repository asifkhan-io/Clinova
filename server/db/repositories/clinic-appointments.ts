import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { appointments, auditLog, patients, services, staff } from "../../../db/schema";
import { isDoubleBooking } from "./appointments";
import type { ClinicContext } from "./context";

/**
 * The clinic's own view of its appointments (Phase 6b/7). Every query is
 * filtered by ctx.clinicId, which comes from the membership row — so another
 * clinic's appointment id simply isn't found.
 */
const appointmentFields = {
  id: appointments.id,
  startAt: appointments.startAt,
  endAt: appointments.endAt,
  status: appointments.status,
  source: appointments.source,
  icsSequence: appointments.icsSequence,
  rescheduleCount: appointments.rescheduleCount,
  cancelledBy: appointments.cancelledBy,
  createdAt: appointments.createdAt,
  staff: { id: staff.id, nameEn: staff.displayNameEn, nameAr: staff.displayNameAr },
  service: { id: services.id, nameEn: services.nameEn, nameAr: services.nameAr, durationMinutes: services.durationMinutes },
  patient: { id: patients.id, fullName: patients.fullName, phoneE164: patients.phoneE164 },
};

function joined(ctx: ClinicContext) {
  return ctx.db
    .select(appointmentFields)
    .from(appointments)
    .innerJoin(staff, and(eq(staff.id, appointments.staffId), eq(staff.clinicId, appointments.clinicId)))
    .innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.clinicId, appointments.clinicId)))
    .innerJoin(patients, and(eq(patients.id, appointments.patientId), eq(patients.clinicId, appointments.clinicId)));
}

export type ClinicAppointment = Awaited<ReturnType<typeof listAppointments>>[number];

/** Appointments starting in [fromMs, toMs), every status, soonest first. */
export async function listAppointments(ctx: ClinicContext, range: { fromMs: number; toMs: number; staffId?: string }) {
  return joined(ctx)
    .where(
      and(
        eq(appointments.clinicId, ctx.clinicId),
        gte(appointments.startAt, new Date(range.fromMs)),
        lt(appointments.startAt, new Date(range.toMs)),
        range.staffId ? eq(appointments.staffId, range.staffId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startAt), asc(staff.sortOrder));
}

export async function getAppointment(ctx: ClinicContext, appointmentId: string) {
  const [row] = await joined(ctx)
    .where(and(eq(appointments.clinicId, ctx.clinicId), eq(appointments.id, appointmentId)))
    .limit(1);
  return row ?? null;
}

export type InsertStaffBookingResult = { ok: true; appointmentId: string; patientId: string } | { ok: false; reason: "slot_taken" };

/**
 * A phone or walk-in booking. Same transaction shape as an online booking,
 * with three differences: source 'staff', the staff member recorded, and no
 * consent stamp — the patient didn't accept our online notice, the clinic took
 * their details itself. An existing patient keeps their stored name.
 */
export async function insertStaffBooking(
  ctx: ClinicContext,
  input: { staffId: string; serviceId: string; startMs: number; endMs: number; fullName: string; phoneE164: string; accessTokenHash: string },
): Promise<InsertStaffBookingResult> {
  try {
    return await ctx.db.transaction(async (tx) => {
      const [patient] = await tx
        .insert(patients)
        .values({ clinicId: ctx.clinicId, fullName: input.fullName, phoneE164: input.phoneE164 })
        .onConflictDoUpdate({ target: [patients.clinicId, patients.phoneE164], set: { updatedAt: sql`now()` } })
        .returning({ id: patients.id });
      if (!patient) throw new Error("patient upsert returned no row");

      const [appointment] = await tx
        .insert(appointments)
        .values({
          clinicId: ctx.clinicId,
          patientId: patient.id,
          staffId: input.staffId,
          serviceId: input.serviceId,
          startAt: new Date(input.startMs),
          endAt: new Date(input.endMs),
          status: "booked",
          source: "staff",
          accessTokenHash: input.accessTokenHash,
          createdByUserId: ctx.userId,
        })
        .returning({ id: appointments.id });
      if (!appointment) throw new Error("appointment insert returned no row");

      await tx.insert(auditLog).values({
        clinicId: ctx.clinicId,
        actorType: "member",
        actorUserId: ctx.userId,
        action: "appointment.created",
        entityType: "appointment",
        entityId: appointment.id,
        metadata: { patientId: patient.id, staffId: input.staffId, serviceId: input.serviceId, startAt: new Date(input.startMs).toISOString(), source: "staff" },
      });
      return { ok: true, appointmentId: appointment.id, patientId: patient.id } as const;
    });
  } catch (error) {
    if (isDoubleBooking(error)) return { ok: false, reason: "slot_taken" };
    throw error;
  }
}

export type OutcomeResult = { ok: true } | { ok: false; reason: "changed" | "not_started" };

/**
 * booked -> completed | no_show, only once the appointment has started
 * (flows §8). Both are terminal. A no-show stops blocking its range, which is
 * harmless: the range is already in the past.
 */
export async function setAppointmentOutcome(
  ctx: ClinicContext,
  input: { appointmentId: string; status: "completed" | "no_show"; nowMs: number },
): Promise<OutcomeResult> {
  return ctx.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: appointments.status, startAt: appointments.startAt })
      .from(appointments)
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, ctx.clinicId)))
      .for("update")
      .limit(1);
    if (!current || current.status !== "booked") return { ok: false, reason: "changed" } as const;
    if (current.startAt.getTime() > input.nowMs) return { ok: false, reason: "not_started" } as const;
    await tx
      .update(appointments)
      .set({ status: input.status, statusUpdatedAt: new Date(input.nowMs), updatedAt: sql`now()` })
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, ctx.clinicId)));
    await tx.insert(auditLog).values({
      clinicId: ctx.clinicId,
      actorType: "member",
      actorUserId: ctx.userId,
      action: "appointment.status_changed",
      entityType: "appointment",
      entityId: input.appointmentId,
      metadata: { from: "booked", to: input.status },
    });
    return { ok: true } as const;
  });
}
