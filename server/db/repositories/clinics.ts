import { eq } from "drizzle-orm";
import { clinics } from "../../../db/schema";
import type { ClinicContext } from "./context";

/** The signed-in member's own clinic. There is no "get clinic by id" for members. */
export async function getOwnClinic(ctx: ClinicContext) {
  const rows = await ctx.db
    .select({
      id: clinics.id,
      slug: clinics.slug,
      nameEn: clinics.nameEn,
      nameAr: clinics.nameAr,
      status: clinics.status,
      bookingEnabled: clinics.bookingEnabled,
      timezone: clinics.timezone,
    })
    .from(clinics)
    .where(eq(clinics.id, ctx.clinicId))
    .limit(1);
  return rows[0] ?? null;
}
