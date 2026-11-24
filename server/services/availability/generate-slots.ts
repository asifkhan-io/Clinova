import type { Interval } from "./resolve-intervals";
import { localToUtc } from "./time";

export type BookingRules = {
  bufferMinutes: number;
  minLeadMinutes: number;
  maxHorizonDays: number;
  slotGranularityMinutes: number;
};

export type Busy = { startMs: number; endMs: number }; // UTC, an existing booking

/**
 * Turns one day's working intervals into bookable slots (UTC ms, start and end).
 *
 * - Starts align to the START OF EACH INTERVAL, not the clock (DB2): a
 *   10:10–14:00 shift offers 10:10, 10:25, … at 15-minute granularity.
 * - The whole appointment must fit inside one interval.
 * - The buffer is a soft gap around existing bookings, applied here only. The
 *   database's no-overlap constraint (Phase 5) enforces the hard rule without it,
 *   so staff can still squeeze a walk-in in back to back (D13).
 * - Lead time and horizon are measured from `nowMs`.
 * - A start time that doesn't exist (DST spring-forward) is skipped.
 */
export function generateSlots(input: {
  date: string;
  timeZone: string;
  intervals: Interval[];
  serviceMinutes: number;
  rules: BookingRules;
  busy: Busy[];
  nowMs: number;
}): { startMs: number; endMs: number }[] {
  const { rules } = input;
  const earliest = input.nowMs + rules.minLeadMinutes * 60_000;
  const latest = input.nowMs + rules.maxHorizonDays * 86_400_000;
  const bufferMs = rules.bufferMinutes * 60_000;
  const slots = new Map<number, number>(); // start -> end; dedupes overlapping intervals

  for (const interval of input.intervals) {
    for (
      let m = interval.startMinute;
      m + input.serviceMinutes <= interval.endMinute;
      m += rules.slotGranularityMinutes
    ) {
      const start = localToUtc(input.date, m, input.timeZone);
      const end = localToUtc(input.date, m + input.serviceMinutes, input.timeZone);
      if (start === null || end === null) continue;
      if (start < earliest || start >= latest) continue;
      const clashes = input.busy.some((b) => start < b.endMs + bufferMs && end > b.startMs - bufferMs);
      if (!clashes) slots.set(start, end);
    }
  }
  return [...slots].map(([startMs, endMs]) => ({ startMs, endMs })).sort((a, b) => a.startMs - b.startMs);
}
