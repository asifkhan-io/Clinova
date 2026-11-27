import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { type LegalDoc, LEGAL_SECTIONS } from "@/lib/legal";

/**
 * The privacy notice and the terms share one layout: a title, a "last updated"
 * line, and sections whose order lives in lib/legal.ts and whose words live in
 * the translation files, so English and Arabic can't drift apart in structure.
 */
export async function LegalPage({ locale, doc }: { locale: Locale; doc: LegalDoc }) {
  const tl = await getTranslations({ locale, namespace: "Legal" });
  // The key is built from LEGAL_SECTIONS, which TypeScript can't pair with the
  // right document, so it is typed loosely here. tests/legal.test.ts checks
  // that every listed section exists in both languages instead.
  const text = (key: string) => tl(key as Parameters<typeof tl>[0]);
  const other: LegalDoc = doc === "privacy" ? "terms" : "privacy";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{text(`${doc}.title`)}</h1>
        <p className="text-sm opacity-70">{tl("updated", { date: "2026-11-27" })}</p>
        <p>{text(`${doc}.intro`)}</p>
      </header>
      {LEGAL_SECTIONS[doc].map((key: string) => (
        <section key={key} className="flex flex-col gap-2">
          <h2 className="font-semibold">{text(`${doc}.sections.${key}.title`)}</h2>
          {text(`${doc}.sections.${key}.body`)
            .split("\n\n")
            .map((para, i) => (
              <p key={i} className="opacity-90">{para}</p>
            ))}
        </section>
      ))}
      <nav className="flex gap-4 border-t pt-4 text-sm">
        <Link href={`/${other}`} className="underline">{tl(`${other}Link`)}</Link>
        <Link href="/" className="underline">{tl("home")}</Link>
      </nav>
    </main>
  );
}
