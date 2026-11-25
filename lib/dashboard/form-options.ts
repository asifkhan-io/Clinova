import "server-only";
import type { FormDentist, FormService } from "@/components/calendar/appointment-form";
import type { ClinicContext } from "@/server/db/repositories/context";
import { listServices } from "@/server/db/repositories/services";
import { listStaff } from "@/server/db/repositories/staff";

/** Active services and dentists, named in the viewer's language, for the staff booking form. */
export async function bookingFormOptions(ctx: ClinicContext, locale: string): Promise<{ services: FormService[]; dentists: FormDentist[] }> {
  const ar = locale === "ar";
  const pick = (en: string, arText: string) => (ar ? arText || en : en || arText);
  const [services, dentists] = await Promise.all([listServices(ctx), listStaff(ctx)]);
  return {
    services: services.filter((s) => s.isActive).map((s) => ({ id: s.id, name: pick(s.nameEn, s.nameAr) })),
    dentists: dentists.filter((d) => d.isActive).map((d) => ({ id: d.id, name: pick(d.displayNameEn, d.displayNameAr), serviceIds: d.serviceIds })),
  };
}
