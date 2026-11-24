import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BookingRulesForm, BookingSwitch, ProfileForm } from "@/components/settings/settings-forms";
import { resolveLocale } from "@/lib/i18n/server";
import { requireClinicPage } from "@/server/auth/page-guards";
import { getOwnClinic } from "@/server/db/repositories/clinics";
import { getSetupChecklist } from "@/server/services/onboarding";

export default async function SettingsPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Settings");
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <SettingsBody locale={locale} />
      </Suspense>
    </main>
  );
}

async function SettingsBody({ locale }: { locale: Locale }) {
  const ctx = await requireClinicPage(locale, "clinic_owner");
  const t = await getTranslations({ locale, namespace: "Settings" });
  const [clinic, checklist] = await Promise.all([getOwnClinic(ctx), getSetupChecklist(ctx)]);
  if (!clinic) notFound();
  const suspended = ctx.clinicStatus === "suspended";

  return (
    <>
      {suspended && <p className="rounded-md border border-amber-600/40 bg-amber-600/5 p-3 text-sm">{t("suspended")}</p>}
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-semibold">{t("bookingTitle")}</h2>
        <BookingSwitch enabled={clinic.bookingEnabled} ready={checklist.readyToBook} />
      </section>
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-semibold">{t("profileTitle")}</h2>
        <ProfileForm clinic={clinic} />
      </section>
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-semibold">{t("rulesTitle")}</h2>
        <BookingRulesForm rules={clinic} />
      </section>
    </>
  );
}
