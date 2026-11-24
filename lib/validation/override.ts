import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const rangeSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.startMinute < r.endMinute);

const optionalLabel = z
  .string()
  .trim()
  .max(80)
  .transform((v) => (v === "" ? null : v));

/**
 * A closure or a special-hours period, for the whole clinic (staffId null) or
 * one dentist. Labels name the period ("Eid al-Fitr", "Annual leave") — never
 * anything clinical about a patient.
 */
export const overrideSchema = z
  .object({
    staffId: z.union([z.uuid(), z.literal("").transform(() => null)]),
    type: z.enum(["closed", "custom_hours"]),
    startDate: isoDate,
    endDate: isoDate,
    labelEn: optionalLabel,
    labelAr: optionalLabel,
    intervals: z.array(rangeSchema).max(10),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", message: "date_order" });
    const days = (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000;
    if (!Number.isFinite(days) || days > 366) ctx.addIssue({ code: "custom", message: "too_long" });
    // DB4: "custom_hours ⇒ at least one interval" spans two tables, so it lives here.
    if (v.type === "custom_hours" && v.intervals.length === 0) {
      ctx.addIssue({ code: "custom", message: "no_intervals" });
    }
    const sorted = [...v.intervals].sort((a, b) => a.startMinute - b.startMinute);
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k]!.startMinute < sorted[k - 1]!.endMinute) {
        ctx.addIssue({ code: "custom", message: "overlap_intervals" });
        break;
      }
    }
  })
  // A closure has no intervals, whatever the form sent.
  .transform((v) => (v.type === "closed" ? { ...v, intervals: [] } : v));

export type OverrideInput = z.infer<typeof overrideSchema>;
