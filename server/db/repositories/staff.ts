import { and, asc, eq, inArray } from "drizzle-orm";
import { clinicHours, services, staff, staffHours, staffServices } from "../../../db/schema";
import type { ClinicContext } from "./context";

type StaffFields = {
  displayNameEn: string;
  displayNameAr: string;
  titleEn: string | null;
  titleAr: string | null;
};

export async function listStaff(ctx: ClinicContext) {
  const [rows, links] = await Promise.all([
    ctx.db
      .select()
      .from(staff)
      .where(eq(staff.clinicId, ctx.clinicId))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt)),
    ctx.db
      .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
      .from(staffServices)
      .where(eq(staffServices.clinicId, ctx.clinicId)),
  ]);
  return rows.map((s) => ({
    ...s,
    serviceIds: links.filter((l) => l.staffId === s.id).map((l) => l.serviceId),
  }));
}

/**
 * A new dentist starts bookable for every active service (user-flows.md D5) and
 * with the clinic's hours copied in as their weekly hours. Both are what a
 * clinic means 9 times out of 10, and both can be changed afterwards. Without
 * them a new dentist silently generates no slots at all.
 */
export async function createStaff(ctx: ClinicContext, input: StaffFields) {
  return ctx.db.transaction(async (tx) => {
    const [member] = await tx
      .insert(staff)
      .values({ ...input, clinicId: ctx.clinicId })
      .returning({ id: staff.id });
    if (!member) throw new Error("staff insert returned no row");

    const active = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.clinicId, ctx.clinicId), eq(services.isActive, true)));
    if (active.length > 0) {
      await tx.insert(staffServices).values(
        active.map((s) => ({ clinicId: ctx.clinicId, staffId: member.id, serviceId: s.id })),
      );
    }

    const template = await tx
      .select({
        dayOfWeek: clinicHours.dayOfWeek,
        startMinute: clinicHours.startMinute,
        endMinute: clinicHours.endMinute,
      })
      .from(clinicHours)
      .where(eq(clinicHours.clinicId, ctx.clinicId));
    if (template.length > 0) {
      await tx.insert(staffHours).values(
        template.map((h) => ({ ...h, clinicId: ctx.clinicId, staffId: member.id })),
      );
    }
    return member;
  });
}

/** Returns false when the dentist is not in the caller's clinic. */
export async function updateStaff(ctx: ClinicContext, id: string, input: StaffFields) {
  const rows = await ctx.db
    .update(staff)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(staff.id, id), eq(staff.clinicId, ctx.clinicId)))
    .returning({ id: staff.id });
  return rows.length > 0;
}

/**
 * Deactivated, never deleted: appointments reference dentists (ON DELETE
 * RESTRICT). Deactivating stops new bookings; it does not revoke anyone's login,
 * which is a separate change to clinic_members (scope §3).
 */
export async function setStaffActive(ctx: ClinicContext, id: string, isActive: boolean) {
  const rows = await ctx.db
    .update(staff)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(staff.id, id), eq(staff.clinicId, ctx.clinicId)))
    .returning({ id: staff.id });
  return rows.length > 0;
}

/**
 * Replaces the set of services a dentist performs. Service ids that are not
 * this clinic's are dropped before the insert, so a forged id is ignored rather
 * than failing the composite foreign key with a 500.
 */
export async function setStaffServices(ctx: ClinicContext, staffId: string, serviceIds: string[]) {
  return ctx.db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.clinicId, ctx.clinicId)))
      .limit(1);
    if (!member) return false;

    const own =
      serviceIds.length === 0
        ? []
        : await tx
            .select({ id: services.id })
            .from(services)
            .where(and(eq(services.clinicId, ctx.clinicId), inArray(services.id, serviceIds)));

    await tx
      .delete(staffServices)
      .where(and(eq(staffServices.clinicId, ctx.clinicId), eq(staffServices.staffId, staffId)));
    if (own.length > 0) {
      await tx
        .insert(staffServices)
        .values(own.map((s) => ({ clinicId: ctx.clinicId, staffId, serviceId: s.id })));
    }
    return true;
  });
}
