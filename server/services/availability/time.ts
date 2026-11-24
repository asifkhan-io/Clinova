/**
 * Local wall-clock time <-> UTC, with no date library (ARCH7). Only Intl, which
 * asks the IANA database for the offset ON THAT DATE — the DST rule from
 * user-flows.md §5 made mechanical.
 */

/** Minutes the zone is ahead of UTC at a given instant (Riyadh: +180). */
export function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asIfUtc - utcMs) / 60_000);
}

/**
 * The UTC instant of `minutes` past local midnight on `date` in `timeZone`.
 * 1440 is midnight at the END of the day. Returns null for a wall time that
 * does not exist (the hour skipped when clocks spring forward); for the
 * repeated hour in autumn it returns the first occurrence.
 */
export function localToUtc(date: string, minutes: number, timeZone: string): number | null {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minutes); // the wall time, read as if it were UTC
  // The offsets in force 12h either side cover any single DST change. Each
  // gives one candidate instant; keep those that really show this wall time.
  const candidates = [wall - 12 * 3_600_000, wall + 12 * 3_600_000]
    .map((probe) => wall - zoneOffsetMinutes(probe, timeZone) * 60_000)
    .filter((t) => t + zoneOffsetMinutes(t, timeZone) * 60_000 === wall);
  // None: the time was skipped (spring forward). Two: it happened twice
  // (autumn) — take the first, so a 02:00 slot means the first 02:00.
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/** 0 = Sunday … 6 = Saturday for a calendar date (no zone involved). */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Today's calendar date in a zone, as YYYY-MM-DD. */
export function localDate(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(utcMs),
  );
}

/** date + n days, as YYYY-MM-DD. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
