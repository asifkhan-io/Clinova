import { z } from "zod";
import type { CountryCode } from "@/lib/countries";
import { normaliseClinicPhone } from "./booking";
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

/** The clinic profile. The phone is read in the clinic's country (local or international). */
/** Each zone's label key in messages (Settings.timezones); "/" can't be part of a key path. */
const TIMEZONE_KEYS = {
  "Asia/Karachi": "Asia_Karachi",
  "Asia/Riyadh": "Asia_Riyadh",
  "Asia/Dubai": "Asia_Dubai",
  "Asia/Kuwait": "Asia_Kuwait",
  "Asia/Qatar": "Asia_Qatar",
  "Asia/Bahrain": "Asia_Bahrain",
  "Asia/Muscat": "Asia_Muscat",
} as const satisfies Record<(typeof CLINIC_TIMEZONES)[number], string>;
export const timezoneKey = (tz: (typeof CLINIC_TIMEZONES)[number]) => TIMEZONE_KEYS[tz];

export const clinicProfileSchemaFor = (country: CountryCode) =>
  z.object({
    nameEn: z.string().trim().min(2).max(120),
    nameAr: optionalName(),
    addressEn: optionalText(300),
    addressAr: optionalText(300),
    // Shown to patients; stored in the same E.164 shape as patient numbers.
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || normaliseClinicPhone(v, country) !== null, "phone")
      .transform((v) => (v === "" ? null : normaliseClinicPhone(v, country))),
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
