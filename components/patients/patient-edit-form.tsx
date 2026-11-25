"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { updatePatientAction } from "@/server/actions/appointments";

const field = "rounded-md border px-3 py-2 text-start";

export function PatientEditForm({ patientId, fullName, phone }: { patientId: string; fullName: string; phone: string }) {
  const t = useTranslations("Patients");
  const te = useTranslations("AppointmentErrors");
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof updatePatientAction>> | null, form: FormData) => {
    const result = await updatePatientAction(prev, form);
    if (result.ok) router.refresh();
    return result;
  }, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="patientId" value={patientId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("name")}</span>
          <input name="fullName" defaultValue={fullName} required minLength={2} maxLength={100} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("phone")}</span>
          <input name="phone" type="tel" defaultValue={phone} required dir="ltr" className={field} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black">
          {pending ? t("saving") : t("save")}
        </button>
        {state?.ok && <span role="status" className="text-sm text-green-700">{t("saved")}</span>}
        {state && !state.ok && <span role="alert" className="text-sm text-red-700">{te(state.error)}</span>}
      </div>
    </form>
  );
}
