"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

/** Shows a freshly created invite link once, with a copy button. */
export function InviteLink({ url }: { url: string }) {
  const t = useTranslations("Admin");
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-green-600/40 bg-green-600/5 p-3">
      <p className="text-sm font-medium">{t("inviteReady")}</p>
      <code dir="ltr" className="break-all rounded bg-black/5 p-2 text-xs">
        {url}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
        className="self-start rounded-md border px-3 py-1 text-sm hover:bg-black/5"
      >
        {copied ? t("copied") : t("copy")}
      </button>
      <p className="text-xs opacity-70">{t("inviteOnce")}</p>
    </div>
  );
}
