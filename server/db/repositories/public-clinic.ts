import { and, asc, eq, inArray } from "drizzle-orm";
import { clinics, services, staff, staffServices } from "../../../db/schema";
import { db } from "../client";
import type { ClinicScope } from "./schedule";

/**
 * The public side: no session, the clinic comes from the URL slug. Only fields
 * a patient may see are selected — never booking internals, never other
 * patients. A suspended clinic is invisible (404), not merely closed (D4).
 */
export async function findPublicClinic(slug: string) {
  const [row] = await db
    .select({
      id: clinics.id,
      slug: clinics.slug,
      nameEn: clinics.nameEn,
      nameAr: clinics.nameAr,
      addressEn: clinics.addressEn,
      addressAr: clinics.addressAr,
      phone: clinics.phone,
      mapsUrl: clinics.mapsUrl,
      timezone: clinics.timezone,
      status: clinics.status,
      bookingEnabled: clinics.bookingEnabled,
      maxHorizonDays: clinics.maxHorizonDays,
    })
    .from(clinics)
    .where(eq(clinics.slug, slug))
    .limit(1);
  if (!row || row.status === "suspended") return null;
  const scope: ClinicScope = { db, clinicId: row.id };
  return { clinic: row, scope };
}

/**
 * Bookable catalogue: active services that at least one active dentist
 * performs, and those dentists with the services each offers. A service nobody
 * performs is hidden — it would only ever show "no times".
 */
export async function loadPublicCatalogue(scope: ClinicScope) {
  const [svc, dentists] = await Promise.all([
    scope.db
      .select({
        id: services.id,
        nameEn: services.nameEn,
        nameAr: services.nameAr,
        descriptionEn: services.descriptionEn,
        descriptionAr: services.descriptionAr,
        durationMinutes: services.durationMinutes,
        priceMinor: services.priceMinor,
      })
      .from(services)
      .where(and(eq(services.clinicId, scope.clinicId), eq(services.isActive, true)))
      .orderBy(asc(services.sortOrder), asc(services.createdAt)),
    scope.db
      .select({
        id: staff.id,
        displayNameEn: staff.displayNameEn,
        displayNameAr: staff.displayNameAr,
        titleEn: staff.titleEn,
        titleAr: staff.titleAr,
      })
      .from(staff)
      .where(and(eq(staff.clinicId, scope.clinicId), eq(staff.isActive, true)))
      .orderBy(asc(staff.sortOrder), asc(staff.createdAt)),
  ]);
  const links =
    dentists.length === 0
      ? []
      : await scope.db
          .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
          .from(staffServices)
          .where(and(eq(staffServices.clinicId, scope.clinicId), inArray(staffServices.staffId, dentists.map((d) => d.id))));

  const dentistsWithServices = dentists
    .map((d) => ({ ...d, serviceIds: links.filter((l) => l.staffId === d.id).map((l) => l.serviceId) }))
    .filter((d) => d.serviceIds.length > 0);
  const offered = new Set(dentistsWithServices.flatMap((d) => d.serviceIds));
  return { services: svc.filter((s) => offered.has(s.id)), dentists: dentistsWithServices };
}
