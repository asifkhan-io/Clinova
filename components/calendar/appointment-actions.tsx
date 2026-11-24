"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { cancelAppointmentAction, setOutcomeAction } from "@/server/actions/appointments";

type Result = Awaited<ReturnType<typeof cancelAppointmentAction>>;

/** Wraps an action so success (or a stale screen) re-renders the page from the server. */
function useRefreshingAction(action: (prev: Result | null, form: FormData) => Promise<Result>) {
  const router = useRouter();
  return useActionState(async (prev: Result | null, form: FormData) => {
    const result = await action(prev, form);
    if (result.ok || result.error === "changed") router.refresh();
    return result;
  }, null);
}

function ErrorLine({ state }: { state: Result | null }) {
  const te = useTranslations("AppointmentErrors");
  return state && !state.ok ? <p role="alert" className="text-sm text-red-700">{te(state.error)}</p> : null;
}

export function CancelAppointmentButton({ appointmentId, seq }: { appointmentId: string; seq: number }) {
  const t = useTranslations("AppointmentAdmin");
  const [state, action, pending] = useRefreshingAction(cancelAppointmentAction);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="expectedSequence" value={seq} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => { if (!confirm(t("cancelConfirm"))) e.preventDefault(); }}
        className="self-start rounded-md border border-red-700 px-4 py-2 text-red-700 disabled:opacity-50"
      >
        {pending ? t("cancelling") : t("cancel")}
      </button>
      <ErrorLine state={state} />
    </form>
  );
}

/** Completed / No-show. Final once recorded (flows §8), hence the confirm. */
export function OutcomeButtons({ appointmentId }: { appointmentId: string }) {
  const t = useTranslations("AppointmentAdmin");
  const [state, action, pending] = useRefreshingAction(setOutcomeAction);
  const confirmFirst = (e: React.MouseEvent) => { if (!confirm(t("outcomeConfirm"))) e.preventDefault(); };
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="status" value="completed" disabled={pending} onClick={confirmFirst} className="rounded-md bg-green-700 px-4 py-2 font-medium text-white disabled:opacity-50">
          {t("completed")}
        </button>
        <button type="submit" name="status" value="no_show" disabled={pending} onClick={confirmFirst} className="rounded-md border border-amber-700 px-4 py-2 text-amber-800 disabled:opacity-50 dark:text-amber-300">
          {t("noShow")}
        </button>
      </div>
      <ErrorLine state={state} />
    </form>
  );
}
