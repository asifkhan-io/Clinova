import { z } from "zod";
import { COUNTRIES, type CountryCode } from "@/lib/countries";

/** Bump when the privacy notice changes; stored with each patient's consent (D8). */
export const CONSENT_POLICY_VERSION = "2026-11";

/**
 * Normalise a phone to E.164. A local mobile number is accepted as people in
 * the clinic's country type it (Saudi 05XXXXXXXX -> +9665XXXXXXXX, Pakistan
 * 03XXXXXXXXX -> +923XXXXXXXXX); anything else must already be international.
 * The country is the clinic's, never the caller's: it comes from the database.
 */
export function normalisePhone(raw: string, country: CountryCode): string | null {
  const v = raw.replace(/[\s\-().]/g, "");
  const intl = v.startsWith("00") ? `+${v.slice(2)}` : v;
  const { localMobile, dialCode } = COUNTRIES[country];
  if (localMobile.test(intl)) return `+${dialCode}${intl.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(intl) ? intl : null;
}

/**
 * The clinic's own number (Settings), which is often a landline: Islamabad
 * 051 1234567, Riyadh 011 1234567. Both markets write national numbers with a
 * leading 0 (trunk prefix), so a single 0 is replaced by the clinic's dial
 * code; "00" and "+" mean international. Shown to patients, never a lookup key,
 * so this is deliberately looser than the patient mobile rule above.
 */
export function normaliseClinicPhone(raw: string, country: CountryCode): string | null {
  const v = raw.replace(/[\s\-().]/g, "");
  const intl = v.startsWith("00") ? `+${v.slice(2)}` : /^0[1-9]/.test(v) ? `+${COUNTRIES[country].dialCode}${v.slice(1)}` : v;
  return /^\+[1-9]\d{7,14}$/.test(intl) ? intl : null;
}

/** A phone as typed by a patient or a receptionist; parses to E.164 or fails with "phone". */
export const phoneFieldFor = (country: CountryCode) =>
  z.string().transform((v, ctx) => {
    const p = normalisePhone(v, country);
    if (!p) ctx.addIssue({ code: "custom", message: "phone" });
    return p ?? "";
  });

export const bookingSchemaFor = (country: CountryCode) =>
  z.object({
    serviceId: z.uuid(),
    staffId: z.union([z.uuid(), z.literal("any")]),
    startMs: z.coerce.number().int().positive(),
    fullName: z.string().trim().min(2).max(100),
    phone: phoneFieldFor(country),
    // Optional: used once to email the patient their link (Phase 8). Not stored —
    // the patients table deliberately has no email column.
    email: z.union([z.email(), z.literal("")]).optional(),
    consent: z.literal(true),
  });
export type BookingInput = z.infer<ReturnType<typeof bookingSchemaFor>>;
