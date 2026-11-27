import { and, asc, eq } from "drizzle-orm";
import { services, staff, staffServices } from "../../../db/schema";
import type { ClinicContext } from "./context";

type ServiceFields = {
  nameEn: string;
  nameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  durationMinutes: number;
  priceMinor: number | null;
};

export async function listServices(ctx: ClinicContext) {
  return ctx.db
    .select()
    .from(services)
    .where(eq(services.clinicId, ctx.clinicId))
    .orderBy(asc(services.sortOrder), asc(services.createdAt));
}

/**
 * New services are offered by every active dentist by default. A dentist with
 * no staff_services row for a service generates no slots for it — and shows no
 * error anywhere — so "on by default, switch off per dentist" is the safe side.
 */
export async function createService(ctx: ClinicContext, input: ServiceFields) {
  return ctx.db.transaction(async (tx) => {
    const [service] = await tx
      .insert(services)
      .values({ ...input, clinicId: ctx.clinicId })
      .returning({ id: services.id });
    if (!service) throw new Error("service insert returned no row");

    const dentists = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.clinicId, ctx.clinicId), eq(staff.isActive, true)));
    if (dentists.length > 0) {
      await tx.insert(staffServices).values(
        dentists.map((d) => ({ clinicId: ctx.clinicId, staffId: d.id, serviceId: service.id })),
      );
    }
    return service;
  });
}

/** Returns false when the service is not in the caller's clinic. */
export async function updateService(ctx: ClinicContext, id: string, input: ServiceFields) {
  const rows = await ctx.db
    .update(services)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(services.id, id), eq(services.clinicId, ctx.clinicId)))
    .returning({ id: services.id });
  return rows.length > 0;
}

/**
 * Services are deactivated, never deleted: existing appointments reference them
 * and their names must stay joinable (database-design.md §5.2).
 */
export async function setServiceActive(ctx: ClinicContext, id: string, isActive: boolean) {
  const rows = await ctx.db
    .update(services)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(services.id, id), eq(services.clinicId, ctx.clinicId)))
    .returning({ id: services.id });
  return rows.length > 0;
}
