import { z } from "zod";

/**
 * An optional translated name (the Arabic name of a clinic, service or
 * dentist; scope §13). Blank means "not translated" and is stored as NULL, so
 * the Arabic page shows the English name instead of an empty line. When given,
 * the same 2-character minimum as the required name applies.
 */
export const optionalName = (max = 120) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === "" || v.length >= 2)
    .transform((v) => (v === "" ? null : v));
