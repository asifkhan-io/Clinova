import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { StaffForm } from "@/components/staff/staff-form";
import { StaffRow } from "@/components/staff/staff-row";
import { resolveLocale } from "@/lib/i18n/server";
import { requireClinicPage } from "@/server/auth/page-guards";
import { listServices } from "@/server/db/repositories/services";
import { listStaff } from "@/server/db/repositories/staff";

export default async function DentistsPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Dentists");

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <DentistsBody locale={locale} />
      </Suspense>
    </main>
  );
}

async function DentistsBody({ locale }: { locale: Locale }) {
  const ctx = await requireClinicPage(locale);
  const t = await getTranslations({ locale, namespace: "Dentists" });
  const [members, services] = await Promise.all([listStaff(ctx), listServices(ctx)]);
  const canEdit = ctx.role === "clinic_owner" && ctx.clinicStatus !== "suspended";
  const ar = locale === "ar";
  const serviceOptions = services.map((s) => ({
    id: s.id,
    name: (ar ? s.nameAr : s.nameEn) || s.nameEn,
    isActive: s.isActive,
  }));

  return (
    <>
      {canEdit && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">{t("addTitle")}</h2>
          <p className="text-sm opacity-70">{t("addHint")}</p>
          <StaffForm />
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("listTitle", { count: members.length })}</h2>
        {members.length === 0 && <p className="opacity-60">{t("empty")}</p>}
        <ul className="flex flex-col gap-3">
          {members.map((m) => (
            <StaffRow
              key={m.id}
              member={m}
              name={(ar ? m.displayNameAr : m.displayNameEn) || m.displayNameEn}
              title={(ar ? m.titleAr : m.titleEn) ?? (ar ? m.titleEn : m.titleAr)}
              services={serviceOptions}
              canEdit={canEdit}
            />
          ))}
        </ul>
      </section>
    </>
  );
}
