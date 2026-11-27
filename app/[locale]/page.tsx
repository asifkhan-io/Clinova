import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";

/**
 * Clinova's own front door. Patients never book from here (there is no
 * cross-clinic directory in the MVP): they use the link their clinic shares.
 * This page says so, and sends clinics to sign in.
 */
export default async function HomePage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Home");
  const tl = await getTranslations("Legal");
  const otherLocale = locale === "en" ? "ar" : "en";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <nav className="flex items-center justify-end gap-2">
        <Link href="/" locale={otherLocale} className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/5">
          {t("switchLanguage")}
        </Link>
      </nav>

      <header className="flex flex-col gap-3 text-start">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-lg opacity-80">{t("subtitle")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-lg border p-5">
          <h2 className="font-semibold">{t("patientsTitle")}</h2>
          <p className="text-sm opacity-80">{t("patientsBody")}</p>
          <p dir="ltr" className="text-start font-mono text-xs opacity-60">…/{locale}/c/your-clinic</p>
        </section>
        <section className="flex flex-col gap-3 rounded-lg border p-5">
          <h2 className="font-semibold">{t("clinicsTitle")}</h2>
          <p className="text-sm opacity-80">{t("clinicsBody")}</p>
          <Link href="/sign-in" className="self-start rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black">
            {t("signIn")}
          </Link>
        </section>
      </div>

      <footer className="mt-auto flex gap-4 border-t pt-4 text-xs opacity-70">
        <Link href="/privacy" className="underline">{tl("privacyLink")}</Link>
        <Link href="/terms" className="underline">{tl("termsLink")}</Link>
      </footer>
    </main>
  );
}
