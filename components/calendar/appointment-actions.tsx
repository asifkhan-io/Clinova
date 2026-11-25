"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { BookingLink } from "@/components/ui/booking-link";
import { useRouter } from "@/lib/i18n/navigation";
import { whatsappLink } from "@/lib/whatsapp";
import { type AppointmentActionError, cancelAppointmentAction, reissueLinkAction, setOutcomeAction, undoOutcomeAction } from "@/server/actions/appointments";

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

/** Both result shapes reach here: some actions return data, some return nothing. */
function ErrorLine({ state }: { state: { ok: true } | { ok: false; error: AppointmentActionError } | null }) {
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

/**
 * "Send a new link" (Phase 8b). The staff booking flow shows the private link
 * once, so a lost link used to mean cancelling and rebooking. The replacement
 * is shown once too — it only exists in this response — and the old link stops
 * working the moment this succeeds, which is why it asks first.
 */
export function ReissueLinkButton({
  appointmentId,
  phoneE164,
  clinicName,
  when,
}: {
  appointmentId: string;
  phoneE164: string;
  clinicName: string;
  when: { date: string; time: string };
}) {
  const t = useTranslations("AppointmentAdmin");
  const tf = useTranslations("AppointmentForm");
  const locale = useLocale();
  const [state, action, pending] = useActionState(reissueLinkAction, null);

  if (state?.ok) {
    const path = `/${locale}/a/${state.data.token}`;
    // The absolute URL needs the browser's origin; built on click, not in render.
    const message = () => tf("linkMessage", { clinic: clinicName, ...when, link: `${window.location.origin}${path}` });
    return (
      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="font-semibold">{t("newLinkTitle")}</h2>
        <p className="text-sm opacity-80">{t("newLinkHint")}</p>
        <BookingLink path={path} />
        <button
          type="button"
          onClick={() => window.open(whatsappLink(phoneE164, message()), "_blank", "noopener,noreferrer")}
          className="self-start rounded-md bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black"
        >
          {tf("sendWhatsApp")}
        </button>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => { if (!confirm(t("newLinkConfirm"))) e.preventDefault(); }}
        className="self-start rounded-md border px-4 py-2 disabled:opacity-50"
      >
        {pending ? t("issuingLink") : t("newLink")}
      </button>
      <ErrorLine state={state} />
    </form>
  );
}

/**
 * Undo a mis-tapped Completed or No-show (Phase 8c). The page renders this
 * only for the owner, and only while the appointment is still on its own day;
 * the action checks both again on the server.
 */
export function UndoOutcomeButton({ appointmentId }: { appointmentId: string }) {
  const t = useTranslations("AppointmentAdmin");
  const [state, action, pending] = useRefreshingAction(undoOutcomeAction);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <p className="text-sm opacity-80">{t("undoHint")}</p>
      <button type="submit" disabled={pending} className="self-start rounded-md border px-4 py-2 disabled:opacity-50">
        {pending ? t("undoing") : t("undo")}
      </button>
      <ErrorLine state={state} />
    </form>
  );
}
