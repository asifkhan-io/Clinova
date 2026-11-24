import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  clinics,
  scheduleOverrideIntervals,
  scheduleOverrides,
  services,
  staff,
  staffHours,
  staffServices,
} from "../../../db/schema";
import type { Database } from "../client";

/**
 * The narrowest thing availability needs: a database and ONE clinic. Staff
 * screens pass their ClinicContext; the public booking page (Phase 5) will pass
 * a scope resolved from the clinic's slug. Either way every query below is
 * filtered by this clinicId.
 */
export type ClinicScope = { db: Database; clinicId: string };

export async function loadClinicRules(scope: ClinicScope) {
  const [row] = await scope.db
    .select({
      timezone: clinics.timezone,
      status: clinics.status,
      bookingEnabled: clinics.bookingEnabled,
      bufferMinutes: clinics.bufferMinutes,
      minLeadMinutes: clinics.minLeadMinutes,
      maxHorizonDays: clinics.maxHorizonDays,
      slotGranularityMinutes: clinics.slotGranularityMinutes,
    })
    .from(clinics)
    .where(eq(clinics.id, scope.clinicId))
    .limit(1);
  return row ?? null;
}

/** An active service and the active dentists who perform it. */
export async function loadServiceProviders(scope: ClinicScope, serviceId: string) {
  const [service] = await scope.db
    .select({ id: services.id, durationMinutes: services.durationMinutes })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.clinicId, scope.clinicId), eq(services.isActive, true)))
    .limit(1);
  if (!service) return null;
  const dentists = await scope.db
    .select({ id: staff.id })
    .from(staffServices)
    .innerJoin(staff, eq(staff.id, staffServices.staffId))
    .where(
      and(
        eq(staffServices.clinicId, scope.clinicId),
        eq(staffServices.serviceId, serviceId),
        eq(staff.isActive, true),
      ),
    );
  return { service, staffIds: dentists.map((d) => d.id) };
}

/** Weekly hours and the overrides touching [fromDate, toDate], for some dentists. */
export async function loadSchedules(scope: ClinicScope, staffIds: string[], fromDate: string, toDate: string) {
  if (staffIds.length === 0) return { weekly: new Map(), overrides: [] };

  const [hours, overrideRows] = await Promise.all([
    scope.db
      .select({
        staffId: staffHours.staffId,
        dayOfWeek: staffHours.dayOfWeek,
        startMinute: staffHours.startMinute,
        endMinute: staffHours.endMinute,
      })
      .from(staffHours)
      .where(and(eq(staffHours.clinicId, scope.clinicId), inArray(staffHours.staffId, staffIds))),
    scope.db
      .select({
        id: scheduleOverrides.id,
        staffId: scheduleOverrides.staffId,
        type: scheduleOverrides.type,
        startDate: scheduleOverrides.startDate,
        endDate: scheduleOverrides.endDate,
      })
      .from(scheduleOverrides)
      .where(
        and(
          eq(scheduleOverrides.clinicId, scope.clinicId),
          lte(scheduleOverrides.startDate, toDate),
          gte(scheduleOverrides.endDate, fromDate),
        ),
      ),
  ]);

  const relevant = overrideRows.filter((o) => o.staffId === null || staffIds.includes(o.staffId));
  const intervals =
    relevant.length === 0
      ? []
      : await scope.db
          .select()
          .from(scheduleOverrideIntervals)
          .where(inArray(scheduleOverrideIntervals.overrideId, relevant.map((o) => o.id)));

  const weekly = new Map<string, { dayOfWeek: number; startMinute: number; endMinute: number }[]>();
  for (const { staffId, ...h } of hours) weekly.set(staffId, [...(weekly.get(staffId) ?? []), h]);

  const overrides = relevant.map((o) => ({
    staffId: o.staffId,
    type: o.type,
    startDate: o.startDate,
    endDate: o.endDate,
    intervals: intervals
      .filter((i) => i.overrideId === o.id)
      .map(({ startMinute, endMinute }) => ({ startMinute, endMinute })),
  }));
  return { weekly, overrides };
}
