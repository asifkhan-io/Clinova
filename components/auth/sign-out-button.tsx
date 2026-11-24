"use client";

import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/lib/i18n/navigation";

export function SignOutButton() {
  const t = useTranslations("Dashboard");
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="self-start rounded-md border px-3 py-1.5 text-sm hover:bg-black/5"
    >
      {t("signOut")}
    </button>
  );
}
