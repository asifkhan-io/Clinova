/**
 * D6 — CONFIRMED 2026-11-24. For any date exactly ONE rule decides a dentist's
 * working intervals; the first that applies wins:
 *
 *   0. clinic override `closed`        -> nothing (Eid: the building is shut)
 *   1. dentist override `closed`       -> nothing (leave)
 *   2. dentist override `custom_hours` -> its intervals
 *   3. clinic override `custom_hours`  -> its intervals (one Ramadan row moves everyone)
 *   4. dentist weekly hours            -> that weekday's intervals
 *
 * Precedence, not intersection: intersecting a Ramadan 20:00–24:00 shift with a
 * 09:00–17:00 week would silently delete the evening shift.
 * Pure: no database, no clock. That is what makes the rule matrix testable.
 */

export type Interval = { startMinute: number; endMinute: number };
export type WeeklyInterval = Interval & { dayOfWeek: number };
export type Override = {
  staffId: string | null; // null = whole clinic
  type: "closed" | "custom_hours";
  startDate: string; // inclusive, YYYY-MM-DD
  endDate: string; // inclusive
  intervals: Interval[];
};

export type ResolvedDay = {
  rule: "clinic_closed" | "staff_closed" | "staff_custom" | "clinic_custom" | "weekly";
  intervals: Interval[];
};

const covers = (o: Override, date: string) => o.startDate <= date && date <= o.endDate;
const sorted = (xs: Interval[]) => [...xs].sort((a, b) => a.startMinute - b.startMinute);

export function resolveDay(input: {
  date: string;
  dayOfWeek: number;
  staffId: string;
  weekly: WeeklyInterval[]; // this dentist's
  overrides: Override[]; // clinic-wide and this dentist's; others are ignored
}): ResolvedDay {
  const today = input.overrides.filter((o) => covers(o, input.date));
  const clinic = today.filter((o) => o.staffId === null);
  const mine = today.filter((o) => o.staffId === input.staffId);

  if (clinic.some((o) => o.type === "closed")) return { rule: "clinic_closed", intervals: [] };
  if (mine.some((o) => o.type === "closed")) return { rule: "staff_closed", intervals: [] };

  const myCustom = mine.find((o) => o.type === "custom_hours");
  if (myCustom) return { rule: "staff_custom", intervals: sorted(myCustom.intervals) };

  const clinicCustom = clinic.find((o) => o.type === "custom_hours");
  if (clinicCustom) return { rule: "clinic_custom", intervals: sorted(clinicCustom.intervals) };

  return {
    rule: "weekly",
    intervals: sorted(
      input.weekly
        .filter((w) => w.dayOfWeek === input.dayOfWeek)
        .map(({ startMinute, endMinute }) => ({ startMinute, endMinute })),
    ),
  };
}
