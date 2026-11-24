import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CopyClinicHoursButton } from "@/components/hours/copy-clinic-hours-button";
import { WeekEditor } from "@/components/hours/week-editor";
import { WeekSummary } from "@/components/hours/week-summary";
import { resolveLocale } from "@/lib/i18n/server";
import { requireClinicPage } from "@/server/auth/page-guards";
import { listClinicHours, listStaffHours } from "@/server/db/repositories/hours";
import { listStaff } from "@/server/db/repositories/staff";

export default async function HoursPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Hours");

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <HoursBody locale={locale} />
      </Suspense>
    </main>
  );
}

async function HoursBody({ locale }: { locale: Locale }) {
  const ctx = await requireClinicPage(locale);
  const t = await getTranslations({ locale, namespace: "Hours" });
  const [clinicWeek, staffWeeks, dentists] = await Promise.all([
    listClinicHours(ctx),
    listStaffHours(ctx),
    listStaff(ctx),
  ]);
  const canEdit = ctx.role === "clinic_owner" && ctx.clinicStatus !== "suspended";
  const active = dentists.filter((d) => d.isActive);
  const ar = locale === "ar";

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("clinicTitle")}</h2>
        <p className="text-sm opacity-70">{t("clinicHint")}</p>
        {canEdit ? (
          <WeekEditor key={JSON.stringify(clinicWeek)} intervals={clinicWeek} />
        ) : (
          <WeekSummary intervals={clinicWeek} locale={locale} closedLabel={t("closed")} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("dentistsTitle")}</h2>
        <p className="text-sm opacity-70">{t("dentistsHint")}</p>
        {active.length === 0 && <p className="opacity-60">{t("noDentists")}</p>}
        {active.map((d) => {
          const week = staffWeeks.get(d.id) ?? [];
          const name = (ar ? d.displayNameAr : d.displayNameEn) || d.displayNameEn;
          return (
            <details key={d.id} className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium">
                {name}
                {week.length === 0 && <span className="ms-2 text-sm font-normal text-amber-700">{t("noHours")}</span>}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {canEdit ? (
                  <>
                    <CopyClinicHoursButton staffId={d.id} />
                    <WeekEditor key={JSON.stringify(week)} intervals={week} staffId={d.id} />
                  </>
                ) : (
                  <WeekSummary intervals={week} locale={locale} closedLabel={t("closed")} />
                )}
              </div>
            </details>
          );
        })}
      </section>
    </>
  );
}
