"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * A clinic's public booking link with Copy and Open. Built from the browser's
 * own origin, so it is right on localhost, previews and production alike.
 */
export function BookingLink({ path }: { path: string }) {
  const t = useTranslations("BookingLink");
  const [copied, setCopied] = useState(false);
  const absolute = () => `${window.location.origin}${path}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code dir="ltr" className="break-all rounded bg-black/5 px-2 py-1 text-xs">
        {path}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(absolute());
          setCopied(true);
        }}
        className="rounded-md border px-2 py-1 text-xs hover:bg-black/5"
      >
        {copied ? t("copied") : t("copy")}
      </button>
      <a href={path} target="_blank" rel="noopener" className="rounded-md border px-2 py-1 text-xs hover:bg-black/5">
        {t("open")}
      </a>
    </div>
  );
}
