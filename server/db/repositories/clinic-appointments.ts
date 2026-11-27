import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { retryOnDeadlock } from "../retry";
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
    return await retryOnDeadlock(() => ctx.db.transaction(async (tx) => {
      const [patient] = await tx
        .insert(patients)
        .values({ clinicId: ctx.clinicId, fullName: input.fullName, phoneE164: input.phoneE164 })
        .onConflictDoUpdate({
          target: [patients.clinicId, patients.phoneE164],
          set: { updatedAt: sql`now()` },
        })
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
    }));
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

export type ReissueLinkResult = { ok: true } | { ok: false; reason: "not_found" | "changed" };

/**
 * Point the appointment at a new private link and retire the old one, because
 * the link is shown once and staff lose it (Phase 8b).
 *
 * ics_sequence is deliberately NOT bumped. The event itself has not changed —
 * same time, same dentist, same service — so a calendar entry the patient
 * already saved is still correct, and a staff screen open elsewhere keeps its
 * optimistic-concurrency token instead of being invalidated by someone
 * re-sending a message.
 *
 * Only a booked appointment gets a new link: once it is cancelled or closed out
 * there is nothing for the patient to manage, and the old link expires on its
 * own 24h after the end.
 */
export async function reissueAccessToken(
  ctx: ClinicContext,
  input: { appointmentId: string; accessTokenHash: string },
): Promise<ReissueLinkResult> {
  return ctx.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: appointments.status })
      .from(appointments)
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, ctx.clinicId)))
      .for("update")
      .limit(1);
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (current.status !== "booked") return { ok: false, reason: "changed" } as const;
    await tx
      .update(appointments)
      .set({ accessTokenHash: input.accessTokenHash, updatedAt: sql`now()` })
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, ctx.clinicId)));
    // No token, not even its hash: an audit row says a link was replaced and
    // by whom, which is all an investigation needs.
    await tx.insert(auditLog).values({
      clinicId: ctx.clinicId,
      actorType: "member",
      actorUserId: ctx.userId,
      action: "appointment.link_reissued",
      entityType: "appointment",
      entityId: input.appointmentId,
    });
    return { ok: true } as const;
  });
}

export type UndoOutcomeResult = { ok: true } | { ok: false; reason: "changed" | "too_late" | "slot_taken" };

/**
 * completed | no_show -> booked, for a mis-tap (Phase 8c). The window closes at
 * `allowedUntilMs`, which the service computes from the clinic's own day.
 *
 * The two directions are NOT symmetric, because the no-overlap constraint only
 * counts 'booked' and 'completed' rows:
 *  - completed -> booked keeps blocking the same range, so it cannot conflict.
 *  - no_show -> booked re-asserts a range the no-show had freed. If anyone took
 *    that time in the meantime the UPDATE raises 23P01 and this returns
 *    slot_taken, which is the honest answer: the slot really is gone.
 */
export async function undoAppointmentOutcome(
  ctx: ClinicContext,
  input: { appointmentId: string; nowMs: number; allowedUntilMs: number },
): Promise<UndoOutcomeResult> {
  try {
    return await retryOnDeadlock(() => ctx.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: appointments.status })
        .from(appointments)
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, ctx.clinicId)))
        .for("update")
        .limit(1);
      if (!current || (current.status !== "completed" && current.status !== "no_show")) {
        return { ok: false, reason: "changed" } as const;
      }
      if (input.nowMs >= input.allowedUntilMs) return { ok: false, reason: "too_late" } as const;
      await tx
        .update(appointments)
        .set({ status: "booked", statusUpdatedAt: new Date(input.nowMs), updatedAt: sql`now()` })
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, ctx.clinicId)));
      await tx.insert(auditLog).values({
        clinicId: ctx.clinicId,
        actorType: "member",
        actorUserId: ctx.userId,
        action: "appointment.status_changed",
        entityType: "appointment",
        entityId: input.appointmentId,
        // `undo` marks this apart from the original outcome in the same action name.
        metadata: { from: current.status, to: "booked", undo: true },
      });
      return { ok: true } as const;
    }));
  } catch (error) {
    if (isDoubleBooking(error)) return { ok: false, reason: "slot_taken" };
    throw error;
  }
}
