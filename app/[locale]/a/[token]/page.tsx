import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { resolveLocale } from "@/lib/i18n/server";
import { findAppointmentByToken } from "@/server/db/repositories/appointments";
import { hashToken } from "@/server/services/tokens";

// The URL itself is the key to this page: keep it out of search engines and
// out of the Referer header sent to the maps link.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

/** The patient's private appointment page: /{locale}/a/{token}. */
export default async function AppointmentPage({ params }: PageProps<"/[locale]/a/[token]">) {
  const locale = await resolveLocale();
  const t = await getTranslations("Appointment");
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <AppointmentBody params={params} locale={locale} />
      </Suspense>
    </main>
  );
}

async function AppointmentBody({ params, locale }: { params: PageProps<"/[locale]/a/[token]">["params"]; locale: Locale }) {
  const { token } = await params;
  await connection();
  const t = await getTranslations({ locale, namespace: "Appointment" });
  const appt = await findAppointmentByToken(hashToken(token));
  if (!appt) {
    // Same message for unknown, expired and suspended: don't help anyone probe links.
    return <p className="rounded-lg border p-4">{t("invalid")}</p>;
  }

  const ar = locale === "ar";
  const pick = (en: string | null, arText: string | null) => (ar ? arText || en : en || arText);
  const tz = appt.clinic.timezone;
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz, calendar: "gregory", numberingSystem: "latn" }).format(appt.startAt);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz, numberingSystem: "latn" }).format(d);
  const cancelled = appt.status === "cancelled";

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className={`text-sm font-medium ${cancelled ? "text-red-700" : "text-green-700"}`}>{t(`status.${appt.status}`)}</p>
        <h1 className="text-2xl font-semibold">{pick(appt.service.nameEn, appt.service.nameAr)}</h1>
        <p className="opacity-80">{pick(appt.clinic.nameEn, appt.clinic.nameAr)}</p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border p-4">
        <dt className="opacity-70">{t("date")}</dt>
        <dd className="font-medium">{date}</dd>
        <dt className="opacity-70">{t("time")}</dt>
        <dd className="font-medium" dir="ltr">
          <span className="inline-block text-start">{time(appt.startAt)} – {time(appt.endAt)}</span>
        </dd>
        <dt className="opacity-70">{t("dentist")}</dt>
        <dd>{pick(appt.dentist.nameEn, appt.dentist.nameAr)}</dd>
        {pick(appt.clinic.addressEn, appt.clinic.addressAr) && (
          <>
            <dt className="opacity-70">{t("address")}</dt>
            <dd>{pick(appt.clinic.addressEn, appt.clinic.addressAr)}</dd>
          </>
        )}
      </dl>

      {!cancelled && (
        <div className="flex flex-wrap gap-2">
          <a href={`/api/public/a/${token}/ics?lang=${locale}`} className="rounded-md bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black">
            {t("addToCalendar")}
          </a>
          {appt.clinic.mapsUrl && (
            <a href={appt.clinic.mapsUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border px-4 py-2">
              {t("directions")}
            </a>
          )}
          {appt.clinic.phone && (
            <a href={`tel:${appt.clinic.phone}`} className="rounded-md border px-4 py-2" dir="ltr">
              {t("call")}
            </a>
          )}
        </div>
      )}

      <p className="text-sm opacity-70">{t("keepPrivate")}</p>
      <p className="text-sm opacity-70">{t("changeHint")}</p>
    </>
  );
}
