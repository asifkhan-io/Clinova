"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { reissueInviteAction } from "@/server/actions/admin";
import { InviteLink } from "./invite-link";

export function ReissueInviteButton({ clinicId }: { clinicId: string }) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const [state, action, pending] = useActionState(reissueInviteAction, null);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="clinicId" value={clinicId} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border px-2 py-1 text-xs hover:bg-black/5"
      >
        {t("newInviteLink")}
      </button>
      {state && !state.ok && (
        <p role="alert" className="text-xs text-red-600">{t(`errors.${state.error}`)}</p>
      )}
      {state?.ok && <InviteLink url={state.data.inviteUrl} />}
    </form>
  );
}
