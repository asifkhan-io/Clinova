import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingWizard } from "@/components/booking/booking-wizard";
import type { PublicDentist, PublicService } from "@/components/booking/types";
import { COUNTRIES, countryOf } from "@/lib/countries";
import { clinicMoney } from "@/lib/i18n/format";
import { resolveLocale } from "@/lib/i18n/server";
import { findPublicClinic, loadPublicCatalogue } from "@/server/db/repositories/public-clinic";

/** A clinic's public booking page: /{locale}/c/{slug}. No login. */
export default async function PublicClinicPage({ params }: PageProps<"/[locale]/c/[slug]">) {
  const locale = await resolveLocale();
  const t = await getTranslations("Booking");
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <ClinicBody params={params} locale={locale} />
      </Suspense>
    </main>
  );
}

async function ClinicBody({ params, locale }: { params: PageProps<"/[locale]/c/[slug]">["params"]; locale: Locale }) {
  const { slug } = await params;
  await connection(); // live data: open/closed and the catalogue can change any minute
  const found = await findPublicClinic(slug);
  if (!found) notFound();
  const { clinic, scope } = found;
  const country = countryOf(clinic.country);
  const t = await getTranslations({ locale, namespace: "Booking" });
  const ar = locale === "ar";
  const pick = (en: string | null, arText: string | null) => (ar ? arText || en : en);
  const name = pick(clinic.nameEn, clinic.nameAr)!;
  const address = pick(clinic.addressEn, clinic.addressAr);

  const header = (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{name}</h1>
      {address && <p className="opacity-80">{address}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {clinic.phone && <a href={`tel:${clinic.phone}`} dir="ltr" className="underline">{clinic.phone}</a>}
        {clinic.mapsUrl && <a href={clinic.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline">{t("map")}</a>}
      </div>
    </header>
  );

  if (!clinic.bookingEnabled) {
    return (
      <>
        {header}
        <p className="rounded-lg border p-4">{t("closedForBooking")}</p>
      </>
    );
  }

  const catalogue = await loadPublicCatalogue(scope);
  const services: PublicService[] = catalogue.services.map((s) => ({
    id: s.id,
    name: pick(s.nameEn, s.nameAr)!,
    description: pick(s.descriptionEn, s.descriptionAr),
    durationMinutes: s.durationMinutes,
    priceLabel: s.priceMinor == null ? t("priceOnRequest") : clinicMoney(locale, s.priceMinor, COUNTRIES[country].currency),
  }));
  const dentists: PublicDentist[] = catalogue.dentists.map((d) => ({
    id: d.id,
    name: pick(d.displayNameEn, d.displayNameAr)!,
    title: pick(d.titleEn, d.titleAr),
    serviceIds: d.serviceIds,
  }));

  return (
    <>
      {header}
      {services.length === 0 ? (
        <p className="rounded-lg border p-4">{t("noServices")}</p>
      ) : (
        <BookingWizard
          clinic={{ slug: clinic.slug, name, timeZone: clinic.timezone, horizonDays: clinic.maxHorizonDays, phoneExample: COUNTRIES[country].localExample }}
          services={services}
          dentists={dentists}
        />
      )}
    </>
  );
}
