"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { deleteOverrideAction } from "@/server/actions/overrides";

type Result = Awaited<ReturnType<typeof deleteOverrideAction>>;

export function DeleteOverrideButton({ id }: { id: string }) {
  const t = useTranslations("Closures");
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Result | null, form: FormData) => {
    const result = await deleteOverrideAction(prev, form);
    if (result.ok) router.refresh();
    return result;
  }, null);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (!confirm(t("deleteConfirm"))) e.preventDefault();
        }}
        className="rounded-md border px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-60"
      >
        {t("delete")}
      </button>
      {state && !state.ok && <span role="alert" className="ms-2 text-sm text-red-600">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}
