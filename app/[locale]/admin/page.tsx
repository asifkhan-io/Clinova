import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CreateClinicForm } from "@/components/admin/create-clinic-form";
import { ReissueInviteButton } from "@/components/admin/reissue-invite-button";
import { Link, redirect } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { AuthError } from "@/server/auth/errors";
import { requirePlatformAdmin } from "@/server/auth/guards";
import { listClinics } from "@/server/db/repositories/admin-clinics";

export default async function AdminPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Admin");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Link href="/dashboard" className="text-sm underline">
          {t("backToDashboard")}
        </Link>
      </div>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <AdminBody locale={locale} />
      </Suspense>
    </main>
  );
}

async function AdminBody({ locale }: { locale: Locale }) {
  let ctx;
  try {
    ctx = await requirePlatformAdmin();
  } catch (e) {
    if (e instanceof AuthError && e.code === "unauthenticated") {
      redirect({ href: "/sign-in", locale });
    }
    notFound(); // don't reveal that an admin area exists
  }
  const t = await getTranslations({ locale, namespace: "Admin" });
  const clinics = await listClinics(ctx);

  return (
    <>
      <section className="flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="font-semibold">{t("newClinic")}</h2>
        <CreateClinicForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">
          {t("clinics")} ({clinics.length})
        </h2>
        {clinics.length === 0 && <p className="opacity-60">{t("noClinics")}</p>}
        <ul className="flex flex-col gap-3">
          {clinics.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{locale === "ar" ? c.nameAr : c.nameEn}</span>
                <span dir="ltr" className="font-mono text-xs opacity-60">
                  /{c.slug}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 opacity-80">
                <span>{t(`status.${c.status}`)}</span>
                {c.ownerEmail ? (
                  <span>
                    {t("owner")}: <span dir="ltr">{c.ownerEmail}</span>
                  </span>
                ) : c.pendingInviteEmail ? (
                  <span>
                    {t("invited")}: <span dir="ltr">{c.pendingInviteEmail}</span>
                  </span>
                ) : (
                  <span>{t("noOwner")}</span>
                )}
              </div>
              {!c.ownerEmail && <ReissueInviteButton clinicId={c.id} />}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
