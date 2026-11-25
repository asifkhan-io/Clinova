import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { clinicDay } from "@/lib/i18n/format";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { requireClinicPage } from "@/server/auth/page-guards";
import { getOwnClinic } from "@/server/db/repositories/clinics";
import { searchPatients } from "@/server/db/repositories/patients";

const LIMIT = 50;

/** The clinic's patients: name, phone, history count (scope §4). */
export default async function PatientsPage({ searchParams }: PageProps<"/[locale]/dashboard/patients">) {
  const locale = await resolveLocale();
  const t = await getTranslations("Patients");
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <PatientsBody locale={locale} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function PatientsBody({ locale, searchParams }: { locale: Locale; searchParams: PageProps<"/[locale]/dashboard/patients">["searchParams"] }) {
  const ctx = await requireClinicPage(locale);
  await connection();
  const t = await getTranslations({ locale, namespace: "Patients" });
  const raw = (await searchParams).q;
  const query = (typeof raw === "string" ? raw : "").slice(0, 100);
  const [rows, clinic] = await Promise.all([searchPatients(ctx, { query, limit: LIMIT }), getOwnClinic(ctx)]);
  const tz = clinic?.timezone ?? "Asia/Riyadh";

  return (
    <>
      <form method="get" role="search" className="flex flex-wrap gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="sr-only">{t("search")}</span>
          <input type="search" name="q" defaultValue={query} placeholder={t("search")} className="rounded-md border px-3 py-2 text-start" />
        </label>
        <button type="submit" className="rounded-md border px-4 py-2 hover:bg-black/5">{t("searchButton")}</button>
      </form>

      {rows.length === 0 && <p className="opacity-60">{query ? t("noMatch", { query }) : t("empty")}</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((p) => (
          <li key={p.id}>
            <Link href={`/dashboard/patients/${p.id}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3 hover:bg-black/5">
              <span className="font-medium">{p.fullName}</span>
              <span dir="ltr" className="text-sm opacity-80">{p.phoneE164}</span>
              <span className="w-full text-sm opacity-70">
                {t("appointments", { count: p.appointmentCount })}
                {p.lastStartAt && ` · ${t("lastVisit", { date: clinicDay(locale, tz, p.lastStartAt) })}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length === LIMIT && <p className="text-sm opacity-70">{t("showingFirst", { count: LIMIT })}</p>}
    </>
  );
}
