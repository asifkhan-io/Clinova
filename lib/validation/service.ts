import { z } from "zod";

/**
 * Price is typed in riyals ("150" or "150.50") and stored in halalas (integer
 * minor units — never floats for money). Empty means "price on request" (NULL),
 * which is different from 0 (free).
 */
const priceRiyals = z
  .string()
  .trim()
  .regex(/^(\d{1,6}(\.\d{1,2})?)?$/)
  .transform((v) => (v === "" ? null : Math.round(Number(v) * 100)));

const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v));

export const serviceSchema = z.object({
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().min(2).max(120),
  descriptionEn: optionalText,
  descriptionAr: optionalText,
  // Same rule as the services_duration_* CHECK constraints in the database.
  durationMinutes: z.coerce.number().int().min(5).max(480).multipleOf(5),
  priceMinor: priceRiyals,
});
export type ServiceInput = z.infer<typeof serviceSchema>;

export const uuidSchema = z.uuid();
