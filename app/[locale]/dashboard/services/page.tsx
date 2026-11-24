import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ServiceForm } from "@/components/services/service-form";
import { ServiceRow } from "@/components/services/service-row";
import { clinicMoney } from "@/lib/i18n/format";
import { resolveLocale } from "@/lib/i18n/server";
import { requireClinicPage } from "@/server/auth/page-guards";
import { listServices } from "@/server/db/repositories/services";

export default async function ServicesPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Services");

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <ServicesBody locale={locale} />
      </Suspense>
    </main>
  );
}

async function ServicesBody({ locale }: { locale: Locale }) {
  const ctx = await requireClinicPage(locale);
  const t = await getTranslations({ locale, namespace: "Services" });
  const services = await listServices(ctx);
  const canEdit = ctx.role === "clinic_owner" && ctx.clinicStatus !== "suspended";
  const ar = locale === "ar";

  return (
    <>
      {canEdit && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">{t("addTitle")}</h2>
          <ServiceForm />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("listTitle", { count: services.length })}</h2>
        {services.length === 0 && <p className="opacity-60">{t("empty")}</p>}
        <ul className="flex flex-col gap-3">
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              service={s}
              // Bilingual data: fall back to the other language rather than a blank.
              name={(ar ? s.nameAr : s.nameEn) || s.nameEn}
              description={(ar ? s.descriptionAr : s.descriptionEn) ?? (ar ? s.descriptionEn : s.descriptionAr)}
              priceLabel={s.priceMinor == null ? t("priceOnRequest") : clinicMoney(locale, s.priceMinor)}
              canEdit={canEdit}
            />
          ))}
        </ul>
      </section>
    </>
  );
}
