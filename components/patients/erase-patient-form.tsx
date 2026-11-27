"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { type AppointmentActionError, erasePatientAction } from "@/server/actions/appointments";

/**
 * "Erase patient data" (Phase 9d). Owner only — the page renders it only for
 * the owner and the action checks again. It can't be undone, so it sits closed
 * in a <details>, needs a ticked box, and asks once more before sending.
 */
export function ErasePatientForm({ patientId }: { patientId: string }) {
  const t = useTranslations("Patients");
  const te = useTranslations("AppointmentErrors");
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof erasePatientAction>> | null, form: FormData) => {
    const result = await erasePatientAction(prev, form);
    if (result.ok) router.refresh();
    return result;
  }, null);

  // The record's own wording for its own failures; everything else is shared.
  const errorText = (code: AppointmentActionError) =>
    code === "not_found" || code === "already_anonymized" ? t(`eraseErrors.${code}`) : te(code);

  return (
    <details className="rounded-lg border border-red-300 p-4 dark:border-red-900">
      <summary className="cursor-pointer font-semibold text-red-800 dark:text-red-300">{t("eraseTitle")}</summary>
      <form action={action} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="patientId" value={patientId} />
        <p className="text-sm">{t("eraseExplain")}</p>
        <ul className="list-disc ps-5 text-sm">
          <li>{t("eraseEffectName")}</li>
          <li>{t("eraseEffectUpcoming")}</li>
          <li>{t("eraseEffectLinks")}</li>
          <li>{t("eraseEffectHistory")}</li>
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
          <span>{t("eraseCheckbox")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            onClick={(e) => { if (!confirm(t("eraseConfirm"))) e.preventDefault(); }}
            className="rounded-md bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? t("erasing") : t("eraseButton")}
          </button>
          {state && !state.ok && <span role="alert" className="text-sm text-red-700">{errorText(state.error)}</span>}
        </div>
      </form>
    </details>
  );
}
