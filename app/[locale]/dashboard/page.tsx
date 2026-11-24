import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Link, redirect } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { getViewer, requireClinicAccess } from "@/server/auth/guards";
import { getOwnClinic } from "@/server/db/repositories/clinics";

export default async function DashboardPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Dashboard");

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {/* Session-dependent: streams in behind the static shell. */}
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <DashboardBody locale={locale} />
      </Suspense>
    </main>
  );
}

async function DashboardBody({ locale }: { locale: Locale }) {
  const viewer = await getViewer();
  if (!viewer) {
    redirect({ href: "/sign-in", locale });
    return null; // unreachable: redirect throws
  }
  const t = await getTranslations({ locale, namespace: "Dashboard" });

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <p>
        {t("signedInAs")}{" "}
        <span dir="ltr" className="font-medium">
          {viewer.user.email}
        </span>
      </p>

      {viewer.isPlatformAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/5 px-3 py-2 text-sm">
          <span>{t("platformAdmin")}</span>
          <Link href="/admin" className="font-medium underline">
            {t("manageClinics")}
          </Link>
        </div>
      )}

      {viewer.membership ? (
        <ClinicSummary locale={locale} />
      ) : (
        !viewer.isPlatformAdmin && <p className="opacity-70">{t("noClinic")}</p>
      )}

      <SignOutButton />
    </section>
  );
}

async function ClinicSummary({ locale }: { locale: Locale }) {
  // The guard, not the viewer lookup, is what authorizes reading clinic data.
  const ctx = await requireClinicAccess();
  const clinic = await getOwnClinic(ctx);
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  if (!clinic) return null;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="opacity-70">{t("clinic")}</dt>
      <dd className="font-medium">{locale === "ar" ? clinic.nameAr : clinic.nameEn}</dd>
      <dt className="opacity-70">{t("role")}</dt>
      <dd>{t(`roles.${ctx.role}`)}</dd>
    </dl>
  );
}
