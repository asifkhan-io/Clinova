import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AppointmentForm } from "@/components/calendar/appointment-form";
import { bookingFormOptions } from "@/lib/dashboard/form-options";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { todayIn } from "@/lib/time/zoned";
import { requireClinicPage } from "@/server/auth/page-guards";
import { getOwnClinic } from "@/server/db/repositories/clinics";

const params = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  staff: z.uuid().optional().catch(undefined),
});

/** Manual booking for walk-ins and phone calls (scope §4). */
export default async function NewAppointmentPage({ searchParams }: PageProps<"/[locale]/dashboard/calendar/new">) {
  const locale = await resolveLocale();
  const t = await getTranslations("Calendar");
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/dashboard/calendar" className="text-sm underline">{t("title")}</Link>
        <h1 className="text-2xl font-semibold">{t("newAppointment")}</h1>
      </div>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <NewAppointmentBody locale={locale} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function NewAppointmentBody({ locale, searchParams }: { locale: Locale; searchParams: PageProps<"/[locale]/dashboard/calendar/new">["searchParams"] }) {
  const ctx = await requireClinicPage(locale);
  await connection();
  const [clinic, options] = await Promise.all([getOwnClinic(ctx), bookingFormOptions(ctx, locale)]);
  if (!clinic) return null;
  const sp = params.parse(await searchParams);
  return (
    <AppointmentForm
      {...options}
      timeZone={clinic.timezone}
      clinicName={(locale === "ar" ? clinic.nameAr : clinic.nameEn) || clinic.nameEn}
      initial={{ date: sp.date ?? todayIn(clinic.timezone), staffId: sp.staff }}
    />
  );
}
