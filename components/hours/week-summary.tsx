import { clinicMinutes, weekdayName } from "@/lib/i18n/format";
import type { Interval } from "@/lib/validation/hours";

/** Read-only week, for staff and for collapsed rows. */
export function WeekSummary({ intervals, locale, closedLabel }: { intervals: Interval[]; locale: string; closedLabel: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {[0, 1, 2, 3, 4, 5, 6].map((day) => {
        const rows = intervals.filter((i) => i.dayOfWeek === day);
        return (
          <div key={day} className="contents">
            <dt className="opacity-70">{weekdayName(locale, day)}</dt>
            <dd dir="ltr" className="text-start">
              {rows.length === 0 ? (
                <span className="opacity-60">{closedLabel}</span>
              ) : (
                rows.map((r) => `${clinicMinutes(locale, r.startMinute)}–${clinicMinutes(locale, r.endMinute)}`).join(", ")
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
