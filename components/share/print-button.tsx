"use client";

import { useTranslations } from "next-intl";

/** Prints the poster; the dashboard menu and these buttons hide themselves in print (print:hidden). */
export function PrintButton() {
  const t = useTranslations("Share");
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
    >
      {t("print")}
    </button>
  );
}
