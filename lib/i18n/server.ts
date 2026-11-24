import type { Locale } from "next-intl";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "./routing";

/**
 * Call at the top of every [locale] layout and page.
 *
 * setRequestLocale is what keeps pages statically renderable under
 * cacheComponents: without it next-intl reads the locale from request headers,
 * which forces the whole route to request time.
 */
export async function resolveLocale(
  params: Promise<{ locale: string }>,
): Promise<Locale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
