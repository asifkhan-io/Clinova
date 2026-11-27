import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { retryOnDeadlock } from "../retry";
import { appointments, auditLog, clinics, patients, services, staff } from "../../../db/schema";
import { type Database, db } from "../client";
import type { ClinicScope } from "./schedule";

const BLOCKING = ["booked", "completed"] as const;

/** Existing bookings that block time, per dentist, overlapping [fromMs, toMs). */
export async function loadBusy(
  scope: ClinicScope,
  staffIds: string[],
  fromMs: number,
  toMs: number,
  /** An appointment being MOVED must not block its own new time. */
  excludeAppointmentId?: string,
) {
  const busy = new Map<string, { startMs: number; endMs: number }[]>();
  if (staffIds.length === 0) return busy;
  const rows = await scope.db
    .select({ staffId: appointments.staffId, startAt: appointments.startAt, endAt: appointments.endAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, scope.clinicId),
        inArray(appointments.staffId, staffIds),
        inArray(appointments.status, [...BLOCKING]),
        lt(appointments.startAt, new Date(toMs)),
        gt(appointments.endAt, new Date(fromMs)),
        excludeAppointmentId ? ne(appointments.id, excludeAppointmentId) : undefined,
      ),
    );
  for (const r of rows) {
    busy.set(r.staffId, [...(busy.get(r.staffId) ?? []), { startMs: r.startAt.getTime(), endMs: r.endAt.getTime() }]);
  }
  return busy;
}

/** Postgres 23P01 on the no-overlap exclusion constraint: someone got there first. */
export function isDoubleBooking(error: unknown) {
  const e = ((error as { cause?: unknown })?.cause ?? error) as { code?: string; constraint?: string };
  return e?.code === "23P01" && e?.constraint === "appointments_no_overlap";
}

export type InsertBookingResult = { ok: true; appointmentId: string } | { ok: false; reason: "slot_taken" };

/**
 * Patient upsert + appointment + audit event, in ONE transaction. The database's
 * exclusion constraint is the final word on overlaps: if a concurrent booking
 * won the race, the insert fails and nothing (not even the patient row) is kept.
 */
export async function insertOnlineBooking(
  scope: ClinicScope,
  input: {
    staffId: string;
    serviceId: string;
    startMs: number;
    endMs: number;
    fullName: string;
    phoneE164: string;
    consentPolicyVersion: string;
    accessTokenHash: string;
  },
): Promise<InsertBookingResult> {
  try {
    return await retryOnDeadlock(() => scope.db.transaction(async (tx) => {
      // One record per phone per clinic. An existing record keeps its name:
      // knowing someone's phone number must not let you rename them.
      const [patient] = await tx
        .insert(patients)
        .values({
          clinicId: scope.clinicId,
          fullName: input.fullName,
          phoneE164: input.phoneE164,
          consentAt: sql`now()`,
          consentPolicyVersion: input.consentPolicyVersion,
        })
        .onConflictDoUpdate({
          target: [patients.clinicId, patients.phoneE164],
          targetWhere: sql`${patients.anonymizedAt} IS NULL`, // the partial unique index (erasure)
          set: { consentAt: sql`now()`, consentPolicyVersion: input.consentPolicyVersion, updatedAt: sql`now()` },
        })
        .returning({ id: patients.id });
      if (!patient) throw new Error("patient upsert returned no row");

      const [appointment] = await tx
        .insert(appointments)
        .values({
          clinicId: scope.clinicId,
          patientId: patient.id,
          staffId: input.staffId,
          serviceId: input.serviceId,
          startAt: new Date(input.startMs),
          endAt: new Date(input.endMs),
          status: "booked",
          source: "online",
          accessTokenHash: input.accessTokenHash,
        })
        .returning({ id: appointments.id });
      if (!appointment) throw new Error("appointment insert returned no row");

      // Ids and times only. Never the patient's name or phone (scope §8).
      await tx.insert(auditLog).values({
        clinicId: scope.clinicId,
        actorType: "patient",
        action: "appointment.created",
        entityType: "appointment",
        entityId: appointment.id,
        metadata: { patientId: patient.id, staffId: input.staffId, serviceId: input.serviceId, startAt: new Date(input.startMs).toISOString(), source: "online" },
      });
      return { ok: true, appointmentId: appointment.id } as const;
    }));
  } catch (error) {
    if (isDoubleBooking(error)) return { ok: false, reason: "slot_taken" };
    throw error;
  }
}

/**
 * The patient's view of their booking, found ONLY by the hash of their link's
 * token. The link stops working 24h after the appointment ends (computed, not
 * stored — database-design §5.2), so old links can't be replayed forever.
 * Patient name and phone are deliberately not selected.
 */
export async function findAppointmentByToken(tokenHash: string, nowMs: number = Date.now()) {
  const [row] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      icsSequence: appointments.icsSequence,
      rescheduleCount: appointments.rescheduleCount,
      clinic: {
        slug: clinics.slug,
        nameEn: clinics.nameEn,
        nameAr: clinics.nameAr,
        addressEn: clinics.addressEn,
        addressAr: clinics.addressAr,
        phone: clinics.phone,
        mapsUrl: clinics.mapsUrl,
        timezone: clinics.timezone,
        status: clinics.status,
        bookingEnabled: clinics.bookingEnabled,
        changeCutoffMinutes: clinics.changeCutoffMinutes,
        maxHorizonDays: clinics.maxHorizonDays,
      },
      service: { nameEn: services.nameEn, nameAr: services.nameAr, durationMinutes: services.durationMinutes },
      dentist: { nameEn: staff.displayNameEn, nameAr: staff.displayNameAr },
    })
    .from(appointments)
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(staff, eq(staff.id, appointments.staffId))
    .where(eq(appointments.accessTokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (row.endAt.getTime() + 24 * 3_600_000 < nowMs) return null;
  if (row.clinic.status === "suspended") return null;
  return row;
}

/* --------------------------- changes (Phase 6) --------------------------- */

/**
 * Everything a patient-side change needs, found ONLY by the link's hash. Same
 * expiry and suspension rules as findAppointmentByToken. Returns the scope the
 * service layer uses for availability, so no caller builds one from user input.
 */
export async function findAppointmentForChange(tokenHash: string, nowMs: number = Date.now()) {
  const [row] = await db
    .select({
      id: appointments.id,
      clinicId: appointments.clinicId,
      staffId: appointments.staffId,
      serviceId: appointments.serviceId,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      rescheduleCount: appointments.rescheduleCount,
      icsSequence: appointments.icsSequence,
      clinic: {
        status: clinics.status,
        timezone: clinics.timezone,
        bookingEnabled: clinics.bookingEnabled,
        changeCutoffMinutes: clinics.changeCutoffMinutes,
        maxHorizonDays: clinics.maxHorizonDays,
      },
    })
    .from(appointments)
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .where(eq(appointments.accessTokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (row.endAt.getTime() + 24 * 3_600_000 < nowMs) return null;
  if (row.clinic.status === "suspended") return null;
  const scope: ClinicScope = { db, clinicId: row.clinicId };
  return { appointment: row, scope };
}

/** Who made a change. Staff changes carry the user id; patient changes can't. */
export type ChangeActor = { type: "patient" } | { type: "staff"; userId: string };

const actorColumns = (actor: ChangeActor) =>
  actor.type === "patient"
    ? { actorType: "patient" as const, actorUserId: null }
    : { actorType: "member" as const, actorUserId: actor.userId };

/** Lock one appointment of this clinic for the rest of the transaction. */
async function lockAppointment(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], clinicId: string, appointmentId: string) {
  const [row] = await tx
    .select({
      status: appointments.status,
      startAt: appointments.startAt,
      staffId: appointments.staffId,
      serviceId: appointments.serviceId,
      icsSequence: appointments.icsSequence,
    })
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
    .for("update")
    .limit(1);
  return row ?? null;
}

export type MoveResult = { ok: true } | { ok: false; reason: "changed" | "slot_taken" };

/**
 * Reschedule IN PLACE (D11): one row, one token, one history. The exclusion
 * constraint checks UPDATE exactly like INSERT, so the new range is validated
 * and the old one frees itself in the same statement.
 *
 * `expectedSequence` is the ics_sequence the caller's screen was built from.
 * Every change bumps it, so a second tab, a double click or a staff edit in
 * between makes this return "changed" instead of silently overwriting.
 */
export async function moveAppointment(
  scope: ClinicScope,
  input: {
    appointmentId: string;
    expectedSequence: number;
    staffId: string;
    serviceId: string;
    startMs: number;
    endMs: number;
    actor: ChangeActor;
  },
): Promise<MoveResult> {
  try {
    return await retryOnDeadlock(() => scope.db.transaction(async (tx) => {
      const current = await lockAppointment(tx, scope.clinicId, input.appointmentId);
      if (!current || current.status !== "booked" || current.icsSequence !== input.expectedSequence) {
        return { ok: false, reason: "changed" } as const;
      }
      await tx
        .update(appointments)
        .set({
          staffId: input.staffId,
          serviceId: input.serviceId,
          startAt: new Date(input.startMs),
          endAt: new Date(input.endMs),
          icsSequence: sql`${appointments.icsSequence} + 1`,
          // Only the patient's own moves count towards their limit (flows §7).
          ...(input.actor.type === "patient" ? { rescheduleCount: sql`${appointments.rescheduleCount} + 1` } : {}),
          updatedAt: sql`now()`,
        })
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, scope.clinicId)));
      await tx.insert(auditLog).values({
        clinicId: scope.clinicId,
        ...actorColumns(input.actor),
        action: "appointment.rescheduled",
        entityType: "appointment",
        entityId: input.appointmentId,
        metadata: {
          from: { startAt: current.startAt.toISOString(), staffId: current.staffId, serviceId: current.serviceId },
          to: { startAt: new Date(input.startMs).toISOString(), staffId: input.staffId, serviceId: input.serviceId },
        },
      });
      return { ok: true } as const;
    }));
  } catch (error) {
    if (isDoubleBooking(error)) return { ok: false, reason: "slot_taken" };
    throw error;
  }
}

export type CancelResult = { ok: true } | { ok: false; reason: "changed" | "started" };

/**
 * booked -> cancelled, before the appointment starts. Past appointments are
 * completed or no-show instead (flows §8). The partial exclusion constraint
 * stops counting the row, so the slot is free again immediately.
 */
export async function cancelAppointment(
  scope: ClinicScope,
  input: { appointmentId: string; expectedSequence: number; actor: ChangeActor; nowMs: number },
): Promise<CancelResult> {
  return scope.db.transaction(async (tx) => {
    const current = await lockAppointment(tx, scope.clinicId, input.appointmentId);
    if (!current || current.status !== "booked" || current.icsSequence !== input.expectedSequence) {
      return { ok: false, reason: "changed" } as const;
    }
    if (current.startAt.getTime() <= input.nowMs) return { ok: false, reason: "started" } as const;
    await tx
      .update(appointments)
      .set({
        status: "cancelled",
        cancelledAt: new Date(input.nowMs),
        cancelledBy: input.actor.type,
        cancelledByUserId: input.actor.type === "staff" ? input.actor.userId : null,
        statusUpdatedAt: new Date(input.nowMs),
        // RFC 5545: a cancellation is a new revision of the event.
        icsSequence: sql`${appointments.icsSequence} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(appointments.id, input.appointmentId), eq(appointments.clinicId, scope.clinicId)));
    await tx.insert(auditLog).values({
      clinicId: scope.clinicId,
      ...actorColumns(input.actor),
      action: "appointment.cancelled",
      entityType: "appointment",
      entityId: input.appointmentId,
      metadata: { startAt: current.startAt.toISOString(), staffId: current.staffId, by: input.actor.type },
    });
    return { ok: true } as const;
  });
}
