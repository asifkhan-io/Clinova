import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { appointments, clinicMembers, clinics, notificationRuns, services, staff, users } from "../../../db/schema";
import type { Database } from "../client";

/**
 * Reads for outgoing email (Phase 8d).
 *
 * These run as the platform, not as a signed-in member: inside after() once a
 * booking has committed, or from the cron route. Every clinic id here comes
 * from our own rows (an appointment we just wrote, or the clinics table), never
 * from a request, so taking it as a plain argument does not weaken tenancy.
 *
 * Nothing here selects a patient's name or phone. The emails are built without
 * them on purpose; see server/services/notifications.ts.
 */

/** Everyone at the clinic who should hear about bookings: active members only. */
export async function clinicRecipients(database: Database, clinicId: string): Promise<string[]> {
  const rows = await database
    .select({ email: users.email })
    .from(clinicMembers)
    .innerJoin(users, eq(users.id, clinicMembers.userId))
    .where(and(eq(clinicMembers.clinicId, clinicId), eq(clinicMembers.isActive, true)));
  return [...new Set(rows.map((r) => r.email))];
}

export type AppointmentNotice = {
  id: string;
  clinicId: string;
  clinicNameEn: string;
  clinicNameAr: string;
  timeZone: string;
  startAt: Date;
  staffNameEn: string;
  staffNameAr: string;
  serviceNameEn: string;
  serviceNameAr: string;
};

const noticeColumns = {
  id: appointments.id,
  clinicId: appointments.clinicId,
  clinicNameEn: clinics.nameEn,
  clinicNameAr: clinics.nameAr,
  timeZone: clinics.timezone,
  startAt: appointments.startAt,
  staffNameEn: staff.displayNameEn,
  staffNameAr: staff.displayNameAr,
  serviceNameEn: services.nameEn,
  serviceNameAr: services.nameAr,
};

function noticeQuery(database: Database) {
  return database
    .select(noticeColumns)
    .from(appointments)
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .innerJoin(staff, and(eq(staff.id, appointments.staffId), eq(staff.clinicId, appointments.clinicId)))
    .innerJoin(services, and(eq(services.id, appointments.serviceId), eq(services.clinicId, appointments.clinicId)));
}

export async function appointmentNotice(database: Database, appointmentId: string): Promise<AppointmentNotice | null> {
  const [row] = await noticeQuery(database).where(eq(appointments.id, appointmentId)).limit(1);
  return row ?? null;
}

/** For the patient change actions, which only ever hold the link's hash. */
export async function appointmentNoticeByTokenHash(database: Database, tokenHash: string): Promise<AppointmentNotice | null> {
  const [row] = await noticeQuery(database).where(eq(appointments.accessTokenHash, tokenHash)).limit(1);
  return row ?? null;
}

/** Clinics that could get a digest: anyone not suspended. */
export async function digestClinics(database: Database) {
  return database
    .select({ id: clinics.id, nameEn: clinics.nameEn, nameAr: clinics.nameAr, timeZone: clinics.timezone })
    .from(clinics)
    .where(ne(clinics.status, "suspended"));
}

/** The day's booked appointments, in start order, without any patient detail. */
export async function bookedBetween(database: Database, clinicId: string, from: Date, to: Date) {
  return noticeQuery(database)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.status, ["booked"]),
        gte(appointments.startAt, from),
        lt(appointments.startAt, to),
      ),
    )
    .orderBy(asc(appointments.startAt));
}

/**
 * Claim one scheduled send. True exactly once per (clinic, kind, key): the
 * caller sends only when it wins, so a repeated cron run sends nothing.
 */
export async function claimNotificationRun(
  database: Database,
  run: { clinicId: string; kind: string; runKey: string },
): Promise<boolean> {
  const inserted = await database
    .insert(notificationRuns)
    .values(run)
    .onConflictDoNothing()
    .returning({ clinicId: notificationRuns.clinicId });
  return inserted.length > 0;
}
