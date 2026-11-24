"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { acceptInviteAction } from "@/server/actions/invites";

const field = "rounded-md border px-3 py-2 text-start";

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("Invite");
  const router = useRouter();
  const [state, action, pending] = useActionState(acceptInviteAction, null);

  useEffect(() => {
    if (state?.ok) {
      router.replace("/dashboard");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("email")}</span>
        <input value={email} readOnly dir="ltr" className={`${field} opacity-70`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("name")}</span>
        <input name="name" required autoComplete="name" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("password")}</span>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" dir="ltr" className={field} />
        <span className="text-xs opacity-60">{t("passwordHint")}</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("confirmPassword")}</span>
        <input name="confirmPassword" type="password" required autoComplete="new-password" dir="ltr" className={field} />
      </label>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-600">
          {t(`errors.${state.error}`)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || state?.ok}
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
