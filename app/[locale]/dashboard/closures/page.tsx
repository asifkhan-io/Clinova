import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeleteOverrideButton } from "@/components/closures/delete-override-button";
import { OverrideForm } from "@/components/closures/override-form";
import { clinicDate, clinicMinutes } from "@/lib/i18n/format";
import { redirect } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { AuthError } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import { getOwnClinic } from "@/server/db/repositories/clinics";
import { listOverrides } from "@/server/db/repositories/overrides";
import { listStaff } from "@/server/db/repositories/staff";

export default async function ClosuresPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Closures");

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <ClosuresBody locale={locale} />
      </Suspense>
    </main>
  );
}

/** Today in the clinic's own timezone, as YYYY-MM-DD. */
function clinicToday(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function ClosuresBody({ locale }: { locale: Locale }) {
  let ctx;
  try {
    ctx = await requireClinicAccess();
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    if (e.code === "unauthenticated") redirect({ href: "/sign-in", locale });
    notFound();
  }
  await connection(); // "today" is request-time by definition
  const t = await getTranslations({ locale, namespace: "Closures" });
  const [overrides, dentists, clinic] = await Promise.all([listOverrides(ctx), listStaff(ctx), getOwnClinic(ctx)]);
  const canEdit = ctx.role === "clinic_owner" && ctx.clinicStatus !== "suspended";
  const ar = locale === "ar";
  const nameOf = (id: string | null) => {
    if (!id) return t("wholeClinic");
    const d = dentists.find((x) => x.id === id);
    return d ? (ar ? d.displayNameAr : d.displayNameEn) || d.displayNameEn : "—";
  };
  const today = clinicToday(clinic?.timezone ?? "Asia/Riyadh");
  const upcoming = overrides.filter((o) => o.endDate >= today).reverse(); // soonest first
  const past = overrides.filter((o) => o.endDate < today);

  const render = (o: (typeof overrides)[number]) => {
    const label = (ar ? o.labelAr : o.labelEn) ?? (ar ? o.labelEn : o.labelAr);
    return (
      <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="font-medium">
            {label ?? (o.type === "closed" ? t("closed") : t("specialHours"))}
            <span className="ms-2 rounded bg-black/10 px-1.5 py-0.5 text-xs font-normal">{nameOf(o.staffId)}</span>
          </span>
          <span>
            {clinicDate(locale, o.startDate)}
            {o.endDate !== o.startDate && ` – ${clinicDate(locale, o.endDate)}`}
          </span>
          <span className="opacity-80">
            {o.type === "closed"
              ? t("closedAllDay")
              : o.intervals.map((i) => `${clinicMinutes(locale, i.startMinute)}–${clinicMinutes(locale, i.endMinute)}`).join(", ")}
          </span>
        </div>
        {canEdit && <DeleteOverrideButton id={o.id} />}
      </li>
    );
  };

  return (
    <>
      {canEdit && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">{t("addTitle")}</h2>
          <p className="text-sm opacity-70">{t("addHint")}</p>
          <OverrideForm
            dentists={dentists.filter((d) => d.isActive).map((d) => ({ id: d.id, name: (ar ? d.displayNameAr : d.displayNameEn) || d.displayNameEn }))}
          />
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("upcoming")}</h2>
        {upcoming.length === 0 && <p className="opacity-60">{t("noneUpcoming")}</p>}
        <ul className="flex flex-col gap-2">{upcoming.map(render)}</ul>
      </section>
      {past.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer font-semibold">{t("past", { count: past.length })}</summary>
          <ul className="mt-3 flex flex-col gap-2 opacity-70">{past.map(render)}</ul>
        </details>
      )}
    </>
  );
}
