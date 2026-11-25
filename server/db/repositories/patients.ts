import { and, asc, count, desc, eq, ilike, like, max, or, sql } from "drizzle-orm";
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
        .where(and(eq(patients.id, patientId), eq(patients.clinicId, ctx.clinicId)))
        .for("update")
        .limit(1);
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
