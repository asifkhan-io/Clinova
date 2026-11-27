import { randomBytes, randomInt } from "node:crypto";
import { and, asc, count, desc, eq, gt, ilike, isNull, like, max, or, sql } from "drizzle-orm";
import { appointments, auditLog, patients, services, staff } from "../../../db/schema";
import type { ClinicContext } from "./context";

/** %, _ and \ are LIKE wildcards; a search for "50%" must mean the text "50%". */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The clinic's patient list: name, phone, how many appointments, the latest.
 * Search matches part of the name, or digits anywhere in the phone number.
 * Listing is not "opening a record", so it isn't audited; getPatientRecord is.
 */
export async function searchPatients(ctx: ClinicContext, input: { query: string; limit: number }) {
  const q = input.query.trim();
  // Saudi numbers are typed locally ("0512…") but stored as +966512…: drop a leading 0.
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const match = q
    ? or(ilike(patients.fullName, `%${escapeLike(q)}%`), digits.length >= 3 ? like(patients.phoneE164, `%${digits}%`) : undefined)
    : undefined;
  return ctx.db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phoneE164: patients.phoneE164,
      appointmentCount: count(appointments.id),
      lastStartAt: max(appointments.startAt),
    })
    .from(patients)
    .leftJoin(appointments, and(eq(appointments.patientId, patients.id), eq(appointments.clinicId, patients.clinicId)))
    .where(and(eq(patients.clinicId, ctx.clinicId), match))
    .groupBy(patients.id)
    .orderBy(sql`max(${appointments.startAt}) DESC NULLS LAST`, asc(patients.fullName))
    .limit(input.limit);
}

/**
 * One patient's record and full history. Opening a record is a
 * patient-data access, so it is audited HERE (scope §5) — no page can read a
 * record without leaving a trace. The audit row holds ids only.
 */
export async function getPatientRecord(ctx: ClinicContext, patientId: string) {
  const [patient] = await ctx.db
    .select({ id: patients.id, fullName: patients.fullName, phoneE164: patients.phoneE164, createdAt: patients.createdAt })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.clinicId, ctx.clinicId)))
    .limit(1);
  if (!patient) return null;

  const history = await ctx.db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      status: appointments.status,
      service: { nameEn: services.nameEn, nameAr: services.nameAr },
      staff: { nameEn: staff.displayNameEn, nameAr: staff.displayNameAr },
    })
    .from(appointments)
    .innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.clinicId, appointments.clinicId)))
    .innerJoin(staff, and(eq(staff.id, appointments.staffId), eq(staff.clinicId, appointments.clinicId)))
    .where(and(eq(appointments.clinicId, ctx.clinicId), eq(appointments.patientId, patientId)))
    .orderBy(desc(appointments.startAt));

  await ctx.db.insert(auditLog).values({
    clinicId: ctx.clinicId,
    actorType: "member",
    actorUserId: ctx.userId,
    action: "patient.record_viewed",
    entityType: "patient",
    entityId: patientId,
  });
  return { patient, history };
}

export type UpdatePatientResult = { ok: true } | { ok: false; reason: "not_found" | "phone_taken" };

/** Fix a name or a number. Two records can't share a phone (one patient per phone, D7). */
export async function updatePatient(ctx: ClinicContext, patientId: string, input: { fullName: string; phoneE164: string }): Promise<UpdatePatientResult> {
  try {
    return await ctx.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ fullName: patients.fullName, phoneE164: patients.phoneE164 })
        .from(patients)
        .where(and(eq(patients.id, patientId), eq(patients.clinicId, ctx.clinicId), isNull(patients.anonymizedAt)))
        .for("update")
        .limit(1);
      // An erased record can't be given a name or number again (that would undo the erasure).
      if (!before) return { ok: false, reason: "not_found" } as const;
      await tx
        .update(patients)
        .set({ fullName: input.fullName, phoneE164: input.phoneE164, updatedAt: sql`now()` })
        .where(and(eq(patients.id, patientId), eq(patients.clinicId, ctx.clinicId)));
      // Which fields changed, never their values.
      const fields = [before.fullName !== input.fullName && "fullName", before.phoneE164 !== input.phoneE164 && "phone"].filter(Boolean);
      await tx.insert(auditLog).values({
        clinicId: ctx.clinicId,
        actorType: "member",
        actorUserId: ctx.userId,
        action: "patient.updated",
        entityType: "patient",
        entityId: patientId,
        metadata: { fields },
      });
      return { ok: true } as const;
    });
  } catch (error) {
    const e = ((error as { cause?: unknown })?.cause ?? error) as { code?: string; constraint?: string };
    if (e?.code === "23505" && e?.constraint === "patients_clinic_phone_key") return { ok: false, reason: "phone_taken" };
    throw error;
  }
}

/** What an erased record holds instead of the patient's name and number. */
export const ERASED_NAME = "—";
/**
 * What an erased record holds instead of the phone number: +999 (not an
 * assigned country code, so it can never reach a real phone) and 11 random
 * digits, unique per record so the one-patient-per-phone index never collides.
 * Satisfies the E.164 check.
 */
export const ERASED_PHONE_PREFIX = "+999";
const erasedPhone = () => ERASED_PHONE_PREFIX + Array.from({ length: 11 }, () => randomInt(10)).join("");
export const isErasedPhone = (phoneE164: string) => phoneE164.startsWith(ERASED_PHONE_PREFIX);

export type AnonymizePatientResult =
  | { ok: true; cancelledUpcoming: number }
  | { ok: false; reason: "not_found" | "already_anonymized" };

/**
 * Erasure on the patient's request (scope §8): ANONYMIZE, NEVER DELETE.
 * In one transaction:
 * - the name and phone are overwritten and consent is cleared;
 * - upcoming bookings are cancelled, so the clinic isn't left holding slots for
 *   someone it can no longer contact (past history stays as it was);
 * - every private link the patient held stops working (fresh random hashes:
 *   nobody knows a token for them);
 * - one audit event, ids and counts only.
 * The appointment rows stay, so the clinic's history and the audit log remain
 * whole. Never "fix" this with DELETE or ON DELETE CASCADE.
 */
export async function anonymizePatient(ctx: ClinicContext, patientId: string, nowMs: number = Date.now()): Promise<AnonymizePatientResult> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ anonymizedAt: patients.anonymizedAt })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.clinicId, ctx.clinicId)))
      .for("update")
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" } as const;
    if (row.anonymizedAt) return { ok: false, reason: "already_anonymized" } as const;

    const now = new Date(nowMs);
    await tx
      .update(patients)
      .set({ fullName: ERASED_NAME, phoneE164: erasedPhone(), consentAt: null, consentPolicyVersion: null, anonymizedAt: now, updatedAt: now })
      .where(and(eq(patients.id, patientId), eq(patients.clinicId, ctx.clinicId)));

    const mine = and(eq(appointments.clinicId, ctx.clinicId), eq(appointments.patientId, patientId));
    const cancelled = await tx
      .update(appointments)
      .set({ status: "cancelled", cancelledAt: now, cancelledBy: "staff", cancelledByUserId: ctx.userId, updatedAt: now })
      .where(and(mine, eq(appointments.status, "booked"), gt(appointments.startAt, now)))
      .returning({ id: appointments.id });

    const all = await tx.select({ id: appointments.id }).from(appointments).where(mine);
    for (const { id } of all) {
      await tx
        .update(appointments)
        .set({ accessTokenHash: randomBytes(32).toString("hex") })
        .where(and(eq(appointments.id, id), eq(appointments.clinicId, ctx.clinicId)));
    }

    await tx.insert(auditLog).values({
      clinicId: ctx.clinicId,
      actorType: "member",
      actorUserId: ctx.userId,
      action: "patient.anonymized",
      entityType: "patient",
      entityId: patientId,
      metadata: { cancelledUpcoming: cancelled.length, appointmentIds: all.map((a) => a.id) },
    });
    return { ok: true, cancelledUpcoming: cancelled.length } as const;
  });
}
