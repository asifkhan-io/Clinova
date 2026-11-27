import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { resolveLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveLocale();
  const t = await getTranslations({ locale, namespace: "Legal.privacy" });
  return { title: `${t("title")} · Clinova` };
}

export default async function Page() {
  return <LegalPage locale={await resolveLocale()} doc="privacy" />;
}
