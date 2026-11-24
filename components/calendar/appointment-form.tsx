"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { BookingLink } from "@/components/ui/booking-link";
import { clinicDay, clinicTime, wallClock } from "@/lib/i18n/format";
import { Link, useRouter } from "@/lib/i18n/navigation";
import { whatsappLink } from "@/lib/whatsapp";
import { createAppointmentAction, rescheduleAppointmentAction } from "@/server/actions/appointments";

export type FormService = { id: string; name: string };
export type FormDentist = { id: string; name: string; serviceIds: string[] };

const field = "rounded-md border px-3 py-2 text-start";
const primary = "rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black";

type Suggestions = { state: "idle" | "loading" | "error" } | { state: "ready"; starts: number[] };

/**
 * Staff booking form, for new appointments and for changes. Free times are
 * SUGGESTIONS (working hours, no lead time or buffer); staff may type any time
 * and the server decides. Only the database's overlap rule is absolute.
 */
export function AppointmentForm({
  services,
  dentists,
  timeZone,
  clinicName,
  initial,
  edit,
}: {
  services: FormService[];
  dentists: FormDentist[];
  timeZone: string;
  clinicName: string;
  initial: { serviceId?: string; staffId?: string; date: string; time?: string };
  edit?: { appointmentId: string; seq: number };
}) {
  const t = useTranslations("AppointmentForm");
  const te = useTranslations("AppointmentErrors");
  const locale = useLocale();
  const router = useRouter();
  const [serviceId, setServiceId] = useState(initial.serviceId ?? services[0]?.id ?? "");
  const eligible = dentists.filter((d) => d.serviceIds.includes(serviceId));
  const [chosenStaff, setChosenStaff] = useState(initial.staffId ?? "");
  // Keep the chosen dentist if they do this service; otherwise the first who does.
  const staffId = eligible.some((d) => d.id === chosenStaff) ? chosenStaff : (eligible[0]?.id ?? "");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time ?? "");
  const [suggestions, setSuggestions] = useState<Suggestions>({ state: "idle" });

  const [created, create, creating] = useActionState(createAppointmentAction, null);
  const [saved, save, saving] = useActionState(
    async (prev: Awaited<ReturnType<typeof rescheduleAppointmentAction>> | null, form: FormData) => {
      const result = await rescheduleAppointmentAction(prev, form);
      if (result.ok || result.error === "changed") router.refresh();
      return result;
    },
    null,
  );

  const key = `${serviceId}|${staffId}|${date}`;
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    if (!serviceId || !staffId || !date || key === loadedKey) return;
    const controller = new AbortController();
    const q = new URLSearchParams({ serviceId, staffId, date, ...(edit ? { exclude: edit.appointmentId } : {}) });
    fetch(`/api/clinic/slots?${q}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { slots: number[] }) => { setSuggestions({ state: "ready", starts: body.slots }); setLoadedKey(key); })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setSuggestions({ state: "error" });
      });
    return () => controller.abort();
  }, [key, loadedKey, serviceId, staffId, date, edit]);
  const fresh = key === loadedKey;

  if (created?.ok) {
    const { token, startMs, phoneE164, appointmentId } = created.data;
    const path = `/${locale}/a/${token}`;
    const when = { date: clinicDay(locale, timeZone, startMs), time: clinicTime(locale, timeZone, startMs) };
    // The absolute URL needs the browser's origin; built on click, not in render.
    const message = () => t("linkMessage", { clinic: clinicName, ...when, link: `${window.location.origin}${path}` });
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-lg border border-green-700 p-3 font-medium text-green-800 dark:text-green-300">{t("created", when)}</p>
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-semibold">{t("sendLinkTitle")}</h2>
          <p className="text-sm opacity-80">{t("sendLinkHint")}</p>
          <BookingLink path={path} />
          <button type="button" className={`${primary} self-start`} onClick={() => window.open(whatsappLink(phoneE164, message()), "_blank", "noopener,noreferrer")}>
            {t("sendWhatsApp")}
          </button>
        </section>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/appointments/${appointmentId}`} className="rounded-md border px-4 py-2">{t("openAppointment")}</Link>
          <button type="button" className="rounded-md border px-4 py-2" onClick={() => window.location.reload()}>{t("another")}</button>
        </div>
      </div>
    );
  }

  const state = edit ? saved : created;
  const error = state && !state.ok ? state.error : null;
  const pending = edit ? saving : creating;
  const showSuggestions = fresh && suggestions.state === "ready";
  const outside = showSuggestions && time !== "" && !suggestions.starts.some((ms) => wallClock(timeZone, ms) === time);

  return (
    <form action={edit ? save : create} className="flex flex-col gap-4">
      {edit && (
        <>
          <input type="hidden" name="appointmentId" value={edit.appointmentId} />
          <input type="hidden" name="expectedSequence" value={edit.seq} />
        </>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-700 p-3 text-red-700">{te(error)}</p>}
      {edit && saved?.ok && <p role="status" className="text-green-700">{t("saved")}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("service")}</span>
          <select name="serviceId" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={field} required>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("dentist")}</span>
          <select name="staffId" value={staffId} onChange={(e) => setChosenStaff(e.target.value)} className={field} required disabled={eligible.length === 0}>
            {eligible.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {eligible.length === 0 && <p className="text-sm text-amber-700">{t("noDentist")}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("date")}</span>
          <input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} required dir="ltr" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("time")}</span>
          <input type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} required step={300} dir="ltr" />
        </label>
      </div>

      <div className="flex flex-col gap-2" aria-live="polite">
        <span className="text-sm font-medium">{t("suggested")}</span>
        {staffId && !fresh && suggestions.state !== "error" && <p className="text-sm opacity-60">{t("loadingTimes")}</p>}
        {suggestions.state === "error" && <p className="text-sm text-amber-700">{t("timesError")}</p>}
        {showSuggestions && suggestions.starts.length === 0 && <p className="text-sm opacity-70">{t("noSuggestions")}</p>}
        {showSuggestions && suggestions.starts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.starts.map((ms) => {
              const value = wallClock(timeZone, ms);
              return (
                <button key={ms} type="button" aria-pressed={time === value} onClick={() => setTime(value)} dir="ltr" className={`rounded-md border px-2 py-1 text-sm ${time === value ? "border-black bg-black/5 dark:border-white" : "hover:bg-black/5"}`}>
                  {clinicTime(locale, timeZone, ms)}
                </button>
              );
            })}
          </div>
        )}
        {outside && <p className="text-sm text-amber-700">{t("outsideSuggestions")}</p>}
      </div>

      {!edit && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("patientName")}</span>
            <input name="fullName" required minLength={2} maxLength={100} autoComplete="off" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("phone")}</span>
            <input name="phone" type="tel" required inputMode="tel" autoComplete="off" dir="ltr" className={field} />
            <span className="text-xs opacity-70">{t("phoneHint")}</span>
          </label>
        </div>
      )}

      <button type="submit" className={`${primary} self-start`} disabled={pending || !staffId}>
        {edit ? (saving ? t("saving") : t("save")) : creating ? t("creating") : t("create")}
      </button>
    </form>
  );
}
