"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { copyClinicHoursAction } from "@/server/actions/hours";

type CopyResult = Awaited<ReturnType<typeof copyClinicHoursAction>>;

export function CopyClinicHoursButton({ staffId }: { staffId: string }) {
  const t = useTranslations("Hours");
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: CopyResult | null, form: FormData) => {
    const result = await copyClinicHoursAction(prev, form);
    if (result.ok) router.refresh();
    return result;
  }, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="staffId" value={staffId} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (!confirm(t("copyConfirm"))) e.preventDefault();
        }}
        className="rounded-md border px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-60"
      >
        {t("useClinicHours")}
      </button>
      {state && !state.ok && <span role="alert" className="text-sm text-red-600">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}
