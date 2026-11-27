"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

/**
 * The fallback for any page under /[locale] that throws while rendering — in
 * practice almost always the database: a Neon compute waking from sleep, or a
 * slow network, can push one query past the pool's deadline (server/db/client.ts).
 * Before this file a patient saw Next's bare crash screen. Now they see a calm
 * message and "Try again", which re-renders the page (usually fine by then).
 *
 * Never show error.message: in production it is a generic string anyway, and
 * in development it can contain SQL. The digest is a log reference only.
 */
export default function LocaleError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("Errors");
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-16" role="alert">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="opacity-80">{t("body")}</p>
      <button
        type="button"
        onClick={() => retry()}
        className="self-start rounded-md bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black"
      >
        {t("retry")}
      </button>
      {digest && <p dir="ltr" className="text-start text-xs opacity-50">{t("reference", { digest })}</p>}
    </main>
  );
}
