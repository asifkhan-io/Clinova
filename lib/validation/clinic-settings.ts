import { z } from "zod";
import { optionalName } from "./optional-name";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

/** The markets we serve (scope §13). Stored as an IANA name; never a fixed offset. */
export const CLINIC_TIMEZONES = [
  "Asia/Karachi",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Muscat",
] as const;

export const clinicProfileSchema = z.object({
  nameEn: z.string().trim().min(2).max(120),
  nameAr: optionalName(),
  addressEn: optionalText(300),
  addressAr: optionalText(300),
  // Shown to patients; same E.164 shape the patients table will require.
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => v === "" || /^\+[1-9][0-9]{7,14}$/.test(v), "phone")
    .transform((v) => (v === "" ? null : v)),
  mapsUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "maps_url")
    .transform((v) => (v === "" ? null : v)),
  timezone: z.enum(CLINIC_TIMEZONES),
});

export const SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const;

/** Same ranges as the clinics_* CHECK constraints, so a typo can't empty a calendar. */
export const bookingRulesSchema = z.object({
  bufferMinutes: z.coerce.number().int().min(0).max(120).multipleOf(5),
  minLeadMinutes: z.coerce.number().int().min(0).max(20160),
  maxHorizonDays: z.coerce.number().int().min(1).max(365),
  changeCutoffMinutes: z.coerce.number().int().min(0).max(20160),
  slotGranularityMinutes: z.coerce
    .number()
    .int()
    .refine((v) => SLOT_STEPS.includes(v as (typeof SLOT_STEPS)[number])),
});
