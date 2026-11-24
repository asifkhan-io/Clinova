import { and, asc, eq } from "drizzle-orm";
import { clinicHours, staff, staffHours } from "../../../db/schema";
import type { ClinicContext } from "./context";

type Interval = { dayOfWeek: number; startMinute: number; endMinute: number };

const byDayThenStart = [asc(clinicHours.dayOfWeek), asc(clinicHours.startMinute)];

export async function listClinicHours(ctx: ClinicContext): Promise<Interval[]> {
  return ctx.db
    .select({
      dayOfWeek: clinicHours.dayOfWeek,
      startMinute: clinicHours.startMinute,
      endMinute: clinicHours.endMinute,
    })
    .from(clinicHours)
    .where(eq(clinicHours.clinicId, ctx.clinicId))
    .orderBy(...byDayThenStart);
}

/** Every dentist's weekly hours in the caller's clinic, keyed by staff id. */
export async function listStaffHours(ctx: ClinicContext) {
  const rows = await ctx.db
    .select({
      staffId: staffHours.staffId,
      dayOfWeek: staffHours.dayOfWeek,
      startMinute: staffHours.startMinute,
      endMinute: staffHours.endMinute,
    })
    .from(staffHours)
    .where(eq(staffHours.clinicId, ctx.clinicId))
    .orderBy(asc(staffHours.dayOfWeek), asc(staffHours.startMinute));
  const byStaff = new Map<string, Interval[]>();
  for (const { staffId, ...i } of rows) {
    byStaff.set(staffId, [...(byStaff.get(staffId) ?? []), i]);
  }
  return byStaff;
}

/**
 * Saving a week replaces it whole, in one transaction: the editor always holds
 * the complete week, and replace-all leaves no half-saved state if any interval
 * is rejected by the no-overlap constraint.
 */
export async function replaceClinicHours(ctx: ClinicContext, intervals: Interval[]) {
  await ctx.db.transaction(async (tx) => {
    await tx.delete(clinicHours).where(eq(clinicHours.clinicId, ctx.clinicId));
    if (intervals.length > 0) {
      await tx.insert(clinicHours).values(intervals.map((i) => ({ ...i, clinicId: ctx.clinicId })));
    }
  });
}

/** Returns false when the dentist is not in the caller's clinic. */
export async function replaceStaffHours(ctx: ClinicContext, staffId: string, intervals: Interval[]) {
  return ctx.db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.clinicId, ctx.clinicId)))
      .limit(1);
    if (!member) return false;

    await tx
      .delete(staffHours)
      .where(and(eq(staffHours.clinicId, ctx.clinicId), eq(staffHours.staffId, staffId)));
    if (intervals.length > 0) {
      await tx
        .insert(staffHours)
        .values(intervals.map((i) => ({ ...i, clinicId: ctx.clinicId, staffId })));
    }
    return true;
  });
}
