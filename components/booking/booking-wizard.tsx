"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { addDays, localDate } from "@/lib/time/zoned";
import { publicBookAction } from "@/server/actions/public-booking";
import type { PublicClinicInfo, PublicDentist, PublicService } from "./types";

const DAYS_SHOWN = 14;
const card =
  "flex flex-col gap-1 rounded-lg border p-3 text-start hover:bg-black/5";
const picked = "border-black bg-black/5 dark:border-white";
const field = "rounded-md border px-3 py-2 text-start";

type Slots =
  | { state: "idle" | "loading" | "error" }
  | { state: "ready"; starts: number[] };

/**
 * Service -> dentist (or any) -> date -> time -> details. Every choice is only
 * a request: the server re-checks availability when the patient presses Book.
 */
export function BookingWizard({
  clinic,
  services,
  dentists,
}: {
  clinic: PublicClinicInfo;
  services: PublicService[];
  dentists: PublicDentist[];
}) {
  const t = useTranslations("Booking");
  const locale = useLocale();
  const [serviceId, setServiceId] = useState<string | null>(
    services.length === 1 ? services[0]!.id : null,
  );
  const [staffId, setStaffId] = useState<string>("any");
  const [date, setDate] = useState<string | null>(null);
  const [startMs, setStartMs] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slots>({ state: "idle" });
  const [reload, setReload] = useState(0);
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (
      prev: Awaited<ReturnType<typeof publicBookAction>> | null,
      form: FormData,
    ) => {
      const result = await publicBookAction(prev, form);
      // The private page is the confirmation; replace() so Back can't resubmit.
      if (result.ok) router.replace(`/a/${result.data.token}`);
      return result;
    },
    null,
  );

  const service = services.find((s) => s.id === serviceId) ?? null;
  const eligible = dentists.filter(
    (d) => serviceId && d.serviceIds.includes(serviceId),
  );
  // Read the clock once, when the wizard mounts — never during re-renders.
  const [today] = useState(() => localDate(Date.now(), clinic.timeZone));
  const days = useMemo(
    () =>
      Array.from(
        { length: Math.min(DAYS_SHOWN, clinic.horizonDays + 1) },
        (_, i) => addDays(today, i),
      ),
    [today, clinic.horizonDays],
  );

  const time = (ms: number) =>
    new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: clinic.timeZone,
      numberingSystem: "latn",
    }).format(ms);
  const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, {
      ...opts,
      timeZone: "UTC",
      calendar: "gregory",
      numberingSystem: "latn",
    }).format(new Date(`${d}T00:00:00Z`));
  useEffect(() => {
    if (!serviceId || !date) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("timeout", "TimeoutError")),
      12_000,
    );
    const q = new URLSearchParams({ serviceId, staffId, date });
    fetch(`/api/public/c/${clinic.slug}/availability?${q}`, {
      signal: controller.signal,
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((body: { slots: number[] }) =>
        setSlots({ state: "ready", starts: body.slots }),
      )
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setSlots({ state: "error" });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [clinic.slug, serviceId, staffId, date, reload]);

  const choose = {
    service: (id: string) => {
      setServiceId(id);
      setStaffId("any");
      setStartMs(null);
      setSlots(date ? { state: "loading" } : { state: "idle" });
    },
    dentist: (id: string) => {
      setStaffId(id);
      setStartMs(null);
      setSlots(date ? { state: "loading" } : { state: "idle" });
    },
    date: (d: string) => {
      setDate(d);
      setStartMs(null);
      setSlots({ state: "loading" });
    },
  };

  if (state?.ok) {
    return (
      <p role='status' className='rounded-lg border p-5 font-medium'>
        {t("confirmed")}
      </p>
    );
  }

  const taken =
    state &&
    !state.ok &&
    (state.error === "slot_taken" || state.error === "slot_unavailable");

  return (
    <div className='flex flex-col gap-8'>
      <section className='flex flex-col gap-3' aria-labelledby='step-service'>
        <h2 id='step-service' className='font-semibold'>
          {t("step1")}
        </h2>
        <div className='grid gap-2 sm:grid-cols-2'>
          {services.map((s) => (
            <button
              key={s.id}
              type='button'
              aria-pressed={serviceId === s.id}
              onClick={() => choose.service(s.id)}
              className={`${card} ${serviceId === s.id ? picked : ""}`}
            >
              <span className='font-medium'>{s.name}</span>
              {s.description && (
                <span className='text-sm opacity-70'>{s.description}</span>
              )}
              <span className='text-sm'>
                {t("minutes", { count: s.durationMinutes })} · {s.priceLabel}
              </span>
            </button>
          ))}
        </div>
      </section>

      {service && (
        <section className='flex flex-col gap-3' aria-labelledby='step-dentist'>
          <h2 id='step-dentist' className='font-semibold'>
            {t("step2")}
          </h2>
          <div className='grid gap-2 sm:grid-cols-2'>
            <button
              type='button'
              aria-pressed={staffId === "any"}
              onClick={() => choose.dentist("any")}
              className={`${card} ${staffId === "any" ? picked : ""}`}
            >
              <span className='font-medium'>{t("anyDentist")}</span>
              <span className='text-sm opacity-70'>{t("anyDentistHint")}</span>
            </button>
            {eligible.map((d) => (
              <button
                key={d.id}
                type='button'
                aria-pressed={staffId === d.id}
                onClick={() => choose.dentist(d.id)}
                className={`${card} ${staffId === d.id ? picked : ""}`}
              >
                <span className='font-medium'>{d.name}</span>
                {d.title && (
                  <span className='text-sm opacity-70'>{d.title}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {service && (
        <section className='flex flex-col gap-3' aria-labelledby='step-date'>
          <h2 id='step-date' className='font-semibold'>
            {t("step3")}
          </h2>
          <div className='flex gap-2 overflow-x-auto pb-1'>
            {days.map((d) => (
              <button
                key={d}
                type='button'
                aria-pressed={date === d}
                onClick={() => choose.date(d)}
                className={`flex min-w-16 flex-col items-center rounded-lg border px-3 py-2 ${date === d ? picked : "hover:bg-black/5"}`}
              >
                <span className='text-xs opacity-70'>
                  {dayLabel(d, { weekday: "short" })}
                </span>
                <span className='text-lg font-medium'>
                  {dayLabel(d, { day: "numeric" })}
                </span>
                <span className='text-xs opacity-70'>
                  {dayLabel(d, { month: "short" })}
                </span>
              </button>
            ))}
          </div>

          {date && slots.state === "loading" && (
            <p className='opacity-60'>{t("loadingTimes")}</p>
          )}
          {date && slots.state === "error" && (
            <p role='alert' className='text-red-600'>
              {t("timesError")}
            </p>
          )}
          {date && slots.state === "ready" && slots.starts.length === 0 && (
            <p className='opacity-70'>{t("noTimes")}</p>
          )}
          {date && slots.state === "ready" && slots.starts.length > 0 && (
            <div
              className='grid grid-cols-3 gap-2 sm:grid-cols-5'
              role='radiogroup'
              aria-label={t("pickTime")}
            >
              {slots.starts.map((ms) => (
                <button
                  key={ms}
                  type='button'
                  role='radio'
                  aria-checked={startMs === ms}
                  onClick={() => setStartMs(ms)}
                  dir='ltr'
                  className={`rounded-md border px-2 py-2 text-sm ${startMs === ms ? picked : "hover:bg-black/5"}`}
                >
                  {time(ms)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {service && startMs !== null && (
        <form
          action={action}
          className='flex flex-col gap-3 rounded-lg border p-4'
          aria-labelledby='step-details'
        >
          <h2 id='step-details' className='font-semibold'>
            {t("step4")}
          </h2>
          <input type='hidden' name='slug' value={clinic.slug} />
          {/* Which language the confirmation email is written in. */}
          <input type='hidden' name='locale' value={locale} />
          <input type='hidden' name='serviceId' value={service.id} />
          <input type='hidden' name='staffId' value={staffId} />
          <input type='hidden' name='startMs' value={startMs} />
          <label className='flex flex-col gap-1'>
            <span className='text-sm font-medium'>{t("fullName")}</span>
            <input
              name='fullName'
              required
              minLength={2}
              autoComplete='name'
              className={field}
            />
          </label>
          <label className='flex flex-col gap-1'>
            <span className='text-sm font-medium'>{t("phone")}</span>
            <input
              name='phone'
              type='tel'
              required
              autoComplete='tel'
              dir='ltr'
              placeholder={clinic.phoneExample}
              className={field}
            />
          </label>
          <label className='flex flex-col gap-1'>
            <span className='text-sm font-medium'>{t("email")}</span>
            <input
              name='email'
              type='email'
              autoComplete='email'
              dir='ltr'
              className={field}
            />
            <span className='text-xs opacity-60'>{t("emailHint")}</span>
          </label>
          <label className='flex items-start gap-2 text-sm'>
            <input type='checkbox' name='consent' required className='mt-1' />
            <span>
              {t("consent", { clinic: clinic.name })}{" "}
              {/* New tab: following the link must not throw away the half-filled booking. */}
              <a href={`/${locale}/privacy`} target='_blank' rel='noopener' className='underline'>
                {t("privacyLink")}
              </a>
            </span>
          </label>

          {state && !state.ok && (
            <div
              role='alert'
              className='flex flex-col gap-2 text-sm text-red-600'
            >
              <span>{t(`errors.${state.error}`)}</span>
              {taken && (
                <button
                  type='button'
                  onClick={() => {
                    setStartMs(null);
                    setSlots({ state: "loading" });
                    setReload((n) => n + 1);
                  }}
                  className='self-start underline'
                >
                  {t("pickAnother")}
                </button>
              )}
            </div>
          )}

          <button
            type='submit'
            disabled={pending}
            className='rounded-md bg-black px-4 py-3 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black'
          >
            {pending ? t("booking") : t("book", { time: time(startMs) })}
          </button>
        </form>
      )}
    </div>
  );
}
