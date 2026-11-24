import { z } from "zod";

/** Bump when the privacy notice changes; stored with each patient's consent (D8). */
export const CONSENT_POLICY_VERSION = "2026-11";

/**
 * Normalise a phone to E.164. Saudi local mobile numbers are accepted as typed
 * (05XXXXXXXX -> +9665XXXXXXXX), since that is how patients in the launch market
 * write them; anything else must already be international.
 */
export function normalisePhone(raw: string): string | null {
  const v = raw.replace(/[\s\-().]/g, "");
  const intl = v.startsWith("00") ? `+${v.slice(2)}` : v;
  if (/^05\d{8}$/.test(intl)) return `+966${intl.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(intl) ? intl : null;
}

export const bookingSchema = z.object({
  serviceId: z.uuid(),
  staffId: z.union([z.uuid(), z.literal("any")]),
  startMs: z.coerce.number().int().positive(),
  fullName: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .transform((v, ctx) => {
      const p = normalisePhone(v);
      if (!p) ctx.addIssue({ code: "custom", message: "phone" });
      return p ?? "";
    }),
  // Optional: used once to email the patient their link (Phase 8). Not stored —
  // the patients table deliberately has no email column.
  email: z.union([z.email(), z.literal("")]).optional(),
  consent: z.literal(true),
});
export type BookingInput = z.infer<typeof bookingSchema>;
