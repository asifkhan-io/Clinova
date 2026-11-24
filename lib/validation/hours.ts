import { z } from "zod";

/**
 * A week of opening hours. Minutes from midnight, 0 = Sunday (the Saudi week
 * starts on Sunday, and Postgres EXTRACT(DOW) agrees). 1440 = 24:00, which is
 * how a late Ramadan shift ends.
 */
export const intervalSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((i) => i.startMinute < i.endMinute, { message: "end_before_start" });

export const weekSchema = z
  .array(intervalSchema)
  .max(70)
  .superRefine((intervals, ctx) => {
    // Checked here for a friendly message; the exclusion constraint in the
    // database is the guarantee.
    for (let day = 0; day < 7; day++) {
      const sorted = intervals
        .filter((i) => i.dayOfWeek === day)
        .sort((a, b) => a.startMinute - b.startMinute);
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k]!.startMinute < sorted[k - 1]!.endMinute) {
          ctx.addIssue({ code: "custom", message: "overlap" });
          return;
        }
      }
    }
  });

export type Interval = z.infer<typeof intervalSchema>;

/** "13:30" -> 810. An end time of "00:00" means midnight at the END of the day (1440). */
export function parseTime(value: string, asEnd = false): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return asEnd && minutes === 0 ? 1440 : minutes;
}

/** 810 -> "13:30"; 1440 -> "00:00" (an end of day, see parseTime). */
export function formatTimeInput(minutes: number): string {
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
