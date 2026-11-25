"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { addDays, localDate } from "@/lib/time/zoned";
import { patientCancelAction, patientRescheduleAction } from "@/server/actions/patient-changes";
import type { RescheduleState } from "@/server/services/appointment-changes";

const DAYS_SHOWN = 14;
const picked = "border-black bg-black/5 dark:border-white";
const primary = "rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black";
const secondary = "rounded-md border px-4 py-2 disabled:opacity-50";

type Slots = { state: "idle" | "loading" | "error" } | { state: "ready"; starts: number[] };
type Panel = "none" | "reschedule" | "cancel";

/**
 * Move or cancel from the patient's private link. Every choice is a request:
 * the server re-checks the rules, and `seq` makes a stale page fail safely
 * ("changed") instead of overwriting a newer edit.
 */
export function AppointmentChanges({
  token,
  seq,
  timeZone,
  horizonDays,
  cutoffMinutes,
  reschedule,
  canCancel,
}: {
  token: string;
  seq: number;
  timeZone: string;
  horizonDays: number;
  cutoffMinutes: number;
  reschedule: RescheduleState;
  canCancel: boolean;
}) {
  const t = useTranslations("Appointment");
  const locale = useLocale();
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("none");
  const [date, setDate] = useState<string | null>(null);
  const [startMs, setStartMs] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slots>({ state: "idle" });
  const [done, setDone] = useState<"moved" | null>(null);

  const [moveState, move, moving] = useActionState(
    async (prev: Awaited<ReturnType<typeof patientRescheduleAction>> | null, form: FormData) => {
      const result = await patientRescheduleAction(prev, form);
      if (result.ok) { setPanel("none"); setDone("moved"); setStartMs(null); setDate(null); setSlots({ state: "idle" }); }
      // Success or a stale page: either way, show the latest server truth.
      if (result.ok || result.error === "changed") router.refresh();
      if (!result.ok && (result.error === "slot_taken" || result.error === "slot_unavailable")) { setStartMs(null); setSlots({ state: "loading" }); }
      return result;
    },
    null,
  );
  const [cancelState, cancel, cancelling] = useActionState(
    async (prev: Awaited<ReturnType<typeof patientCancelAction>> | null, form: FormData) => {
      const result = await patientCancelAction(prev, form);
      if (result.ok || result.error === "changed") router.refresh();
      if (result.ok) setPanel("none");
      return result;
    },
    null,
  );

  const [today] = useState(() => localDate(Date.now(), timeZone));
  const days = useMemo(() => Array.from({ length: Math.min(DAYS_SHOWN, horizonDays + 1) }, (_, i) => addDays(today, i)), [today, horizonDays]);
  const time = (ms: number) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone, numberingSystem: "latn" }).format(ms);
  const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC", calendar: "gregory", numberingSystem: "latn" }).format(new Date(`${d}T00:00:00Z`));

  // `seq` in the deps: after a move the server sends a new sequence, and the
  // grid must be refetched so the old time shows as free and the new as taken.
  useEffect(() => {
    if (panel !== "reschedule" || !date || slots.state !== "loading") return;
    const controller = new AbortController();
    fetch(`/api/public/a/${token}/availability?date=${date}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { slots: number[] }) => setSlots({ state: "ready", starts: body.slots }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setSlots({ state: "error" });
      });
    return () => controller.abort();
  }, [panel, date, token, seq, slots.state]);

  const duration = cutoffMinutes % 60 === 0 ? t("hours", { count: cutoffMinutes / 60 }) : t("minutes", { count: cutoffMinutes });
  const lockedReason =
    reschedule === "cutoff_passed" ? t("cutoffPassed", { duration })
    : reschedule === "limit_reached" ? t("limitReached")
    : reschedule === "booking_closed" ? t("bookingClosed")
    : null;
  const error = (moveState && !moveState.ok && moveState.error) || (cancelState && !cancelState.ok && cancelState.error) || null;

  return (
    <section className="flex flex-col gap-4" aria-label={t("manage")}>
      {done === "moved" && <p role="status" className="rounded-lg border border-green-700 p-3 text-green-800 dark:text-green-300">{t("moved")}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-700 p-3 text-red-700">{t(`errors.${error}`)}</p>}

      {panel === "none" && (
        <div className="flex flex-wrap gap-2">
          {reschedule === "allowed" && (
            <button type="button" className={secondary} onClick={() => { setPanel("reschedule"); setDone(null); }}>
              {t("changeTime")}
            </button>
          )}
          {canCancel && (
            <button type="button" className={`${secondary} text-red-700`} onClick={() => { setPanel("cancel"); setDone(null); }}>
              {t("cancel")}
            </button>
          )}
        </div>
      )}
      {panel === "none" && lockedReason && <p className="text-sm opacity-80">{lockedReason}</p>}

      {panel === "reschedule" && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">{t("pickNewDay")}</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <button key={d} type="button" aria-pressed={date === d} onClick={() => { setDate(d); setStartMs(null); setSlots({ state: "loading" }); }} className={`flex min-w-16 flex-col items-center rounded-lg border px-3 py-2 ${date === d ? picked : "hover:bg-black/5"}`}>
                <span className="text-xs opacity-70">{dayLabel(d, { weekday: "short" })}</span>
                <span className="text-lg font-medium">{dayLabel(d, { day: "numeric" })}</span>
                <span className="text-xs opacity-70">{dayLabel(d, { month: "short" })}</span>
              </button>
            ))}
          </div>
          {date && slots.state === "loading" && <p className="opacity-60">{t("loadingTimes")}</p>}
          {date && slots.state === "error" && <p role="alert" className="text-red-700">{t("timesError")}</p>}
          {date && slots.state === "ready" && slots.starts.length === 0 && <p className="opacity-70">{t("noTimes")}</p>}
          {date && slots.state === "ready" && slots.starts.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t("pickNewTime")}>
              {slots.starts.map((ms) => (
                <button key={ms} type="button" role="radio" aria-checked={startMs === ms} onClick={() => setStartMs(ms)} dir="ltr" className={`rounded-md border px-2 py-2 text-sm ${startMs === ms ? picked : "hover:bg-black/5"}`}>
                  {time(ms)}
                </button>
              ))}
            </div>
          )}
          <form action={move} className="flex flex-wrap gap-2">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="seq" value={seq} />
            <input type="hidden" name="startMs" value={startMs ?? ""} />
            <button type="submit" className={primary} disabled={startMs === null || moving}>
              {moving ? t("moving") : startMs === null ? t("pickNewTime") : t("moveTo", { time: time(startMs) })}
            </button>
            <button type="button" className={secondary} onClick={() => setPanel("none")}>{t("close")}</button>
          </form>
        </div>
      )}

      {panel === "cancel" && (
        <form action={cancel} className="flex flex-col gap-3 rounded-lg border border-red-700 p-4">
          <h2 className="font-semibold">{t("cancelConfirmTitle")}</h2>
          <p className="text-sm opacity-80">{t("cancelConfirmBody")}</p>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="seq" value={seq} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-md bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50" disabled={cancelling}>
              {cancelling ? t("cancelling") : t("cancelConfirm")}
            </button>
            <button type="button" className={secondary} onClick={() => setPanel("none")}>{t("keep")}</button>
          </div>
        </form>
      )}
    </section>
  );
}
