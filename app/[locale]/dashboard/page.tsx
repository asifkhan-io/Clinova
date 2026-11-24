import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { redirect } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { getSession } from "@/server/auth/session";

// Placeholder until step 2d. It proves the session works; it is NOT the clinic
// guard. requireClinicAccess() replaces getSession() here in step 2c.
export default async function DashboardPage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Dashboard");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {/* The session is read per request, so it streams in behind the static shell. */}
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <Account locale={locale} />
      </Suspense>
    </main>
  );
}

async function Account({ locale }: { locale: Locale }) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return null; // unreachable: redirect throws. Keeps the type checker honest.
  }
  const t = await getTranslations({ locale, namespace: "Dashboard" });

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <p>
        {t("signedInAs")}{" "}
        <span dir="ltr" className="font-medium">
          {session.user.email}
        </span>
      </p>
      <SignOutButton />
    </section>
  );
}
