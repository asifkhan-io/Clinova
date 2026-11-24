"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { createClinicAction } from "@/server/actions/admin";
import { InviteLink } from "./invite-link";

const field = "rounded-md border px-3 py-2 text-start";

export function CreateClinicForm() {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const [state, action, pending] = useActionState(createClinicAction, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("nameEn")}</span>
        <input name="nameEn" required dir="ltr" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("nameAr")}</span>
        <input name="nameAr" required dir="rtl" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("slug")}</span>
        <input
          name="slug"
          required
          dir="ltr"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="smile-dental-riyadh"
          className={field}
        />
        <span className="text-xs opacity-60">{t("slugHint")}</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("ownerEmail")}</span>
        <input name="ownerEmail" type="email" required dir="ltr" className={field} />
      </label>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-600">
          {t(`errors.${state.error}`)}
        </p>
      )}
      {state?.ok && <InviteLink url={state.data.inviteUrl} />}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? t("creating") : t("create")}
      </button>
    </form>
  );
}
