import { z } from "zod";

// Shared by the admin form (client) and the Server Action (server). The server
// copy is the one that counts; the client copy is only for faster feedback.

export const createClinicSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(60)
    // Same rule as the clinics_slug_format CHECK constraint in the database.
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().min(2).max(120),
  ownerEmail: z.email().trim().toLowerCase(),
});
export type CreateClinicInput = z.infer<typeof createClinicSchema>;

export const acceptInviteSchema = z
  .object({
    token: z.string().min(20).max(200),
    name: z.string().trim().min(2).max(120),
    password: z.string().min(10).max(128),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
  });
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
