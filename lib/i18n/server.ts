import type { Locale } from "next-intl";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { routing } from "./routing";

/**
 * Call at the top of every [locale] layout and page.
 *
 * Reads the locale through next/root-params, not the `params` prop. [locale] is
 * the root segment and generateStaticParams lists every value, so Next can put
 * it in the static shell. Awaiting `params` instead counts as "URL data" and
 * makes Next 16.4 flag the route as non-instant.
 *
 * setRequestLocale keeps next-intl's own APIs off request headers, which would
 * otherwise push the whole route to request time under cacheComponents.
 */
export async function resolveLocale(): Promise<Locale> {
  const locale = await rootLocale();
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
