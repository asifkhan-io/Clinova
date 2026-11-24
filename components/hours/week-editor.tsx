"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { clinicMinutes, weekdayName } from "@/lib/i18n/format";
import { useRouter } from "@/lib/i18n/navigation";
import { formatTimeInput, type Interval, parseTime } from "@/lib/validation/hours";
import { saveHoursAction } from "@/server/actions/hours";

type Row = { start: string; end: string };
type Week = Row[][]; // index 0 = Sunday
type SaveResult = Awaited<ReturnType<typeof saveHoursAction>>;

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const timeField = "w-28 rounded-md border px-2 py-1 text-start";

function toWeek(intervals: Interval[]): Week {
  const week: Week = DAYS.map(() => []);
  for (const i of intervals) {
    week[i.dayOfWeek]!.push({ start: formatTimeInput(i.startMinute), end: formatTimeInput(i.endMinute) });
  }
  return week;
}

function toIntervals(week: Week): Interval[] | null {
  const out: Interval[] = [];
  for (const day of DAYS) {
    for (const row of week[day]!) {
      const startMinute = parseTime(row.start);
      const endMinute = parseTime(row.end, true);
      if (startMinute === null || endMinute === null || startMinute >= endMinute) return null;
      out.push({ dayOfWeek: day, startMinute, endMinute });
    }
  }
  return out;
}

/**
 * Edits one full week. Several rows per day = a split shift (10:00–14:00 and
 * 17:00–22:00). The whole week is saved at once and replaces what was there.
 * Parent passes a `key` derived from the saved data, so a server refresh
 * remounts this with fresh values.
 */
export function WeekEditor({ intervals, staffId }: { intervals: Interval[]; staffId?: string }) {
  const t = useTranslations("Hours");
  const locale = useLocale();
  const router = useRouter();
  const [week, setWeek] = useState<Week>(() => toWeek(intervals));
  const [clientError, setClientError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [state, action, pending] = useActionState(async (prev: SaveResult | null, form: FormData) => {
    const result = await saveHoursAction(prev, form);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    }
    return result;
  }, null);

  const update = (day: number, fn: (rows: Row[]) => Row[]) => {
    setSaved(false);
    setWeek((w) => w.map((rows, d) => (d === day ? fn(rows) : rows)));
  };
  const serialized = toIntervals(week);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!serialized) {
          e.preventDefault();
          setClientError(t("errors.invalid_input"));
        } else {
          setClientError(null);
        }
      }}
      className="flex flex-col gap-3"
    >
      {staffId && <input type="hidden" name="staffId" value={staffId} />}
      <input type="hidden" name="intervals" value={JSON.stringify(serialized ?? [])} />

      <ul className="flex flex-col divide-y rounded-lg border">
        {DAYS.map((day) => {
          const rows = week[day]!;
          return (
            <li key={day} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <span className="w-28 shrink-0 pt-1 text-sm font-medium">{weekdayName(locale, day)}</span>
              <div className="flex flex-1 flex-col gap-2">
                {rows.length === 0 && <span className="pt-1 text-sm opacity-60">{t("closed")}</span>}
                {rows.map((row, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      dir="ltr"
                      aria-label={t("from")}
                      value={row.start}
                      onChange={(e) => update(day, (r) => r.map((x, i) => (i === idx ? { ...x, start: e.target.value } : x)))}
                      className={timeField}
                    />
                    <span aria-hidden>–</span>
                    <input
                      type="time"
                      dir="ltr"
                      aria-label={t("to")}
                      value={row.end}
                      onChange={(e) => update(day, (r) => r.map((x, i) => (i === idx ? { ...x, end: e.target.value } : x)))}
                      className={timeField}
                    />
                    <button
                      type="button"
                      onClick={() => update(day, (r) => r.filter((_, i) => i !== idx))}
                      className="rounded-md px-2 py-1 text-sm hover:bg-black/5"
                      aria-label={t("remove")}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      update(day, (r) => [...r, r.length === 0 ? { start: "09:00", end: "17:00" } : { start: "17:00", end: "21:00" }])
                    }
                    className="rounded-md border px-2 py-0.5 text-xs hover:bg-black/5"
                  >
                    {rows.length === 0 ? t("open") : t("addShift")}
                  </button>
                  {rows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSaved(false);
                        setWeek((w) => w.map(() => rows.map((x) => ({ ...x }))));
                      }}
                      className="rounded-md px-2 py-0.5 text-xs underline opacity-70 hover:opacity-100"
                    >
                      {t("copyToAll")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs opacity-60">
        {t("midnightHint", { midnight: clinicMinutes(locale, 1440) })}
      </p>

      {(clientError || (state && !state.ok)) && (
        <p role="alert" className="text-sm text-red-600">
          {clientError ?? (state && !state.ok ? t(`errors.${state.error}`) : null)}
        </p>
      )}
      {saved && !pending && <p className="text-sm text-green-700">{t("saved")}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
