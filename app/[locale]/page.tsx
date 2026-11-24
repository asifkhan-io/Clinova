import { getTranslations } from "next-intl/server";
import { clinicDateTime } from "@/lib/i18n/format";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";

// Fixed on purpose. new Date() here would make the page request-time under
// cacheComponents, and Phase 1 only needs to prove the formatter's output.
const SAMPLE_APPOINTMENT = new Date("2026-12-01T06:30:00Z");
const DEMO_TIMEZONE = "Asia/Riyadh";

export default async function HomePage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Home");
  const otherLocale = locale === "en" ? "ar" : "en";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <nav className="flex items-center justify-end gap-2">
        <Link
          href="/sign-in"
          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          {t("signIn")}
        </Link>
        <Link
          href="/"
          locale={otherLocale}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/5"
        >
          {t("switchLanguage")}
        </Link>
      </nav>

      <header className="flex flex-col gap-3 text-start">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-lg opacity-80">{t("subtitle")}</p>
      </header>

      <section className="rounded-lg border p-4 text-start">
        <h2 className="text-sm font-medium opacity-70">{t("sampleLabel")}</h2>
        <time
          dateTime={SAMPLE_APPOINTMENT.toISOString()}
          className="mt-1 block text-lg"
        >
          {clinicDateTime(locale, DEMO_TIMEZONE).format(SAMPLE_APPOINTMENT)}
        </time>
      </section>
    </main>
  );
}
