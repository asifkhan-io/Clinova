import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(120)
  .transform((v) => (v === "" ? null : v));

export const staffSchema = z.object({
  displayNameEn: z.string().trim().min(2).max(120),
  displayNameAr: z.string().trim().min(2).max(120),
  // About the dentist ("Orthodontist"), never about a patient.
  titleEn: optionalText,
  titleAr: optionalText,
});
export type StaffInput = z.infer<typeof staffSchema>;
