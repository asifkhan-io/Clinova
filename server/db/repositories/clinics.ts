import { type CountryCode, countryOf } from "../../../lib/countries";
import { and, count, eq, notExists, sql } from "drizzle-orm";
import { clinicHours, clinics, services, staff, staffHours, staffServices } from "../../../db/schema";
import type { ClinicContext } from "./context";

/** The signed-in member's own clinic. There is no "get clinic by id" for members. */
export async function getOwnClinic(ctx: ClinicContext) {
  const rows = await ctx.db
    .select()
    .from(clinics)
    .where(eq(clinics.id, ctx.clinicId))
    .limit(1);
  return rows[0] ?? null;
}

/** The clinic's market: how its local phone numbers are read, which currency it prices in. */
export async function getClinicCountry(ctx: ClinicContext): Promise<CountryCode> {
  const [row] = await ctx.db.select({ country: clinics.country }).from(clinics).where(eq(clinics.id, ctx.clinicId)).limit(1);
  return countryOf(row?.country);
}

type ProfileFields = {
  nameEn: string;
  nameAr: string | null;
  addressEn: string | null;
  addressAr: string | null;
  phone: string | null;
  mapsUrl: string | null;
  timezone: string;
};

type BookingRules = {
  bufferMinutes: number;
  minLeadMinutes: number;
  maxHorizonDays: number;
  changeCutoffMinutes: number;
  slotGranularityMinutes: number;
};

// slug and status are deliberately absent: the public address and the
// commercial status belong to the platform admin, not the clinic.

export async function updateClinicProfile(ctx: ClinicContext, input: ProfileFields) {
  await ctx.db
    .update(clinics)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(clinics.id, ctx.clinicId));
}

export async function updateBookingRules(ctx: ClinicContext, input: BookingRules) {
  await ctx.db
    .update(clinics)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(clinics.id, ctx.clinicId));
}

export async function setBookingEnabled(ctx: ClinicContext, enabled: boolean) {
  await ctx.db
    .update(clinics)
    .set({ bookingEnabled: enabled, updatedAt: new Date() })
    .where(eq(clinics.id, ctx.clinicId));
}

/**
 * Raw counts the setup checklist is derived from. The checklist is computed,
 * never stored: a stored "step done" flag goes stale the moment someone
 * deactivates the last dentist.
 */
export async function getSetupFacts(ctx: ClinicContext) {
  const activeStaff = and(eq(staff.clinicId, ctx.clinicId), eq(staff.isActive, true));
  const [clinicHoursRows, activeServices, activeDentists, dentistsWithoutServices, dentistsWithoutHours] =
    await Promise.all([
      ctx.db.select({ n: count() }).from(clinicHours).where(eq(clinicHours.clinicId, ctx.clinicId)),
      ctx.db
        .select({ n: count() })
        .from(services)
        .where(and(eq(services.clinicId, ctx.clinicId), eq(services.isActive, true))),
      ctx.db.select({ n: count() }).from(staff).where(activeStaff),
      ctx.db
        .select({ n: count() })
        .from(staff)
        .where(
          and(
            activeStaff,
            notExists(
              ctx.db
                .select({ one: sql`1` })
                .from(staffServices)
                .innerJoin(services, eq(services.id, staffServices.serviceId))
                .where(and(eq(staffServices.staffId, staff.id), eq(services.isActive, true))),
            ),
          ),
        ),
      ctx.db
        .select({ n: count() })
        .from(staff)
        .where(
          and(
            activeStaff,
            notExists(ctx.db.select({ one: sql`1` }).from(staffHours).where(eq(staffHours.staffId, staff.id))),
          ),
        ),
    ]);
  return {
    clinicHours: clinicHoursRows[0]?.n ?? 0,
    activeServices: activeServices[0]?.n ?? 0,
    activeDentists: activeDentists[0]?.n ?? 0,
    dentistsWithoutServices: dentistsWithoutServices[0]?.n ?? 0,
    dentistsWithoutHours: dentistsWithoutHours[0]?.n ?? 0,
  };
}
