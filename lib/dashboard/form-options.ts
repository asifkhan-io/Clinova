import "server-only";
import type { FormDentist, FormService } from "@/components/calendar/appointment-form";
import { COUNTRIES } from "@/lib/countries";
import { getClinicCountry } from "@/server/db/repositories/clinics";
import type { ClinicContext } from "@/server/db/repositories/context";
import { listServices } from "@/server/db/repositories/services";
import { listStaff } from "@/server/db/repositories/staff";

/**
 * Active services and dentists, named in the viewer's language, for the staff
 * booking form — plus how a local mobile number looks in the clinic's country.
 */
export async function bookingFormOptions(
  ctx: ClinicContext,
  locale: string,
): Promise<{ services: FormService[]; dentists: FormDentist[]; phoneExample: string }> {
  const ar = locale === "ar";
  const pick = (en: string, arText: string | null) => (ar ? arText || en : en);
  const [services, dentists, country] = await Promise.all([listServices(ctx), listStaff(ctx), getClinicCountry(ctx)]);
  return {
    phoneExample: COUNTRIES[country].localExample,
    services: services.filter((s) => s.isActive).map((s) => ({ id: s.id, name: pick(s.nameEn, s.nameAr) })),
    dentists: dentists.filter((d) => d.isActive).map((d) => ({ id: d.id, name: pick(d.displayNameEn, d.displayNameAr), serviceIds: d.serviceIds })),
  };
}
