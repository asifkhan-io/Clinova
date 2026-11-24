import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { scheduleOverrideIntervals, scheduleOverrides, staff } from "../../../db/schema";
import type { ClinicContext } from "./context";

type OverrideFields = {
  staffId: string | null;
  type: "closed" | "custom_hours";
  startDate: string;
  endDate: string;
  labelEn: string | null;
  labelAr: string | null;
  intervals: { startMinute: number; endMinute: number }[];
};

export type CreateOverrideResult = { ok: true } | { ok: false; reason: "not_found" | "overlap" };

export async function listOverrides(ctx: ClinicContext) {
  const rows = await ctx.db
    .select()
    .from(scheduleOverrides)
    .where(eq(scheduleOverrides.clinicId, ctx.clinicId))
    .orderBy(desc(scheduleOverrides.startDate));
  if (rows.length === 0) return [];
  const intervals = await ctx.db
    .select()
    .from(scheduleOverrideIntervals)
    .where(inArray(scheduleOverrideIntervals.overrideId, rows.map((r) => r.id)))
    .orderBy(asc(scheduleOverrideIntervals.startMinute));
  return rows.map((r) => ({
    ...r,
    intervals: intervals
      .filter((i) => i.overrideId === r.id)
      .map(({ startMinute, endMinute }) => ({ startMinute, endMinute })),
  }));
}

/** Exclusion-constraint violation (Postgres 23P01) on the overlap rule. */
function isOverlap(error: unknown) {
  const e = ((error as { cause?: unknown })?.cause ?? error) as { code?: string; constraint?: string };
  return e?.code === "23P01" && e?.constraint === "schedule_overrides_no_overlap";
}

export async function createOverride(ctx: ClinicContext, input: OverrideFields): Promise<CreateOverrideResult> {
  try {
    return await ctx.db.transaction(async (tx) => {
      if (input.staffId) {
        const [member] = await tx
          .select({ id: staff.id })
          .from(staff)
          .where(and(eq(staff.id, input.staffId), eq(staff.clinicId, ctx.clinicId)))
          .limit(1);
        if (!member) return { ok: false, reason: "not_found" } as const;
      }
      const { intervals, ...fields } = input;
      const [override] = await tx
        .insert(scheduleOverrides)
        .values({ ...fields, clinicId: ctx.clinicId })
        .returning({ id: scheduleOverrides.id });
      if (!override) throw new Error("override insert returned no row");
      if (intervals.length > 0) {
        await tx
          .insert(scheduleOverrideIntervals)
          .values(intervals.map((i) => ({ ...i, overrideId: override.id })));
      }
      return { ok: true } as const;
    });
  } catch (error) {
    // Two closures of the same scope on overlapping dates: say so, don't 500.
    if (isOverlap(error)) return { ok: false, reason: "overlap" };
    throw error;
  }
}

/**
 * Overrides are deleted outright: no appointment references them. Deleting a
 * closure makes its dates bookable again on the next availability query.
 */
export async function deleteOverride(ctx: ClinicContext, id: string) {
  const rows = await ctx.db
    .delete(scheduleOverrides)
    .where(and(eq(scheduleOverrides.id, id), eq(scheduleOverrides.clinicId, ctx.clinicId)))
    .returning({ id: scheduleOverrides.id });
  return rows.length > 0;
}
