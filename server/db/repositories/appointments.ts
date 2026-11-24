import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { appointments, auditLog, clinics, patients, services, staff } from "../../../db/schema";
import { db } from "../client";
import type { ClinicScope } from "./schedule";

const BLOCKING = ["booked", "completed"] as const;

/** Existing bookings that block time, per dentist, overlapping [fromMs, toMs). */
export async function loadBusy(scope: ClinicScope, staffIds: string[], fromMs: number, toMs: number) {
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
      ),
    );
  for (const r of rows) {
    busy.set(r.staffId, [...(busy.get(r.staffId) ?? []), { startMs: r.startAt.getTime(), endMs: r.endAt.getTime() }]);
  }
  return busy;
}

/** Postgres 23P01 on the no-overlap exclusion constraint: someone got there first. */
function isDoubleBooking(error: unknown) {
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
    return await scope.db.transaction(async (tx) => {
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
    });
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
