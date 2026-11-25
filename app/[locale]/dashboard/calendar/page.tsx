import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/calendar/status-badge";
import { clinicDate, clinicTime } from "@/lib/i18n/format";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { addDays, dayOfWeek, localDate, localToUtc, todayIn } from "@/lib/time/zoned";
import { whatsappLink } from "@/lib/whatsapp";
import { requireClinicPage } from "@/server/auth/page-guards";
import { type ClinicAppointment, listAppointments } from "@/server/db/repositories/clinic-appointments";
import { getOwnClinic } from "@/server/db/repositories/clinics";
import { listStaff } from "@/server/db/repositories/staff";

const params = z.object({
  view: z.enum(["day", "week"]).catch("day"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  staff: z.uuid().optional().catch(undefined),
});

/** Day and week calendar, per dentist or combined (scope §4). */
export default async function CalendarPage({ searchParams }: PageProps<"/[locale]/dashboard/calendar">) {
  const locale = await resolveLocale();
  const t = await getTranslations("Calendar");
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <CalendarBody locale={locale} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function CalendarBody({ locale, searchParams }: { locale: Locale; searchParams: PageProps<"/[locale]/dashboard/calendar">["searchParams"] }) {
  const ctx = await requireClinicPage(locale);
  await connection(); // "today" and the appointments are request-time (ARCH8)
  const t = await getTranslations({ locale, namespace: "Calendar" });
  const [clinic, dentists] = await Promise.all([getOwnClinic(ctx), listStaff(ctx)]);
  if (!clinic) return null;
  const tz = clinic.timezone;
  const sp = params.parse(await searchParams);
  const today = todayIn(tz);
  const date = sp.date ?? today;
  const staffId = dentists.some((d) => d.id === sp.staff) ? sp.staff : undefined;

  // Weeks start on Sunday: the Saudi working week is Sunday–Thursday.
  const first = sp.view === "week" ? addDays(date, -dayOfWeek(date)) : date;
  const days = sp.view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(first, i)) : [date];
  const fromMs = localToUtc(first, 0, tz) ?? 0;
  const toMs = localToUtc(addDays(first, days.length), 0, tz) ?? 0;
  const appointments = await listAppointments(ctx, { fromMs, toMs, staffId });

  const ar = locale === "ar";
  const pick = (en: string, arText: string) => (ar ? arText || en : en || arText);
  const href = (o: { view?: string; date?: string }) => {
    const q = new URLSearchParams({ view: o.view ?? sp.view, date: o.date ?? date, ...(staffId ? { staff: staffId } : {}) });
    return `/dashboard/calendar?${q}`;
  };
  const step = sp.view === "week" ? 7 : 1;
  const newHref = `/dashboard/calendar/new?${new URLSearchParams({ date: date < today ? today : date, ...(staffId ? { staff: staffId } : {}) })}`;
  const tab = (active: boolean) => `rounded-md px-3 py-1.5 text-sm ${active ? "bg-black/10 font-medium" : "hover:bg-black/5"}`;

  const row = (a: ClinicAppointment, compact = false) => (
    <li key={a.id} className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${a.status === "cancelled" ? "opacity-60" : ""}`}>
      <Link href={`/dashboard/appointments/${a.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 hover:underline">
        <span className="font-medium" dir="ltr">
          <span className="inline-block text-start">{clinicTime(locale, tz, a.startAt)} – {clinicTime(locale, tz, a.endAt)}</span>
        </span>
        <span className="truncate">{a.patient.fullName}</span>
        <span className="text-sm opacity-70">
          {compact ? pick(a.staff.nameEn, a.staff.nameAr) : `${pick(a.service.nameEn, a.service.nameAr)} · ${pick(a.staff.nameEn, a.staff.nameAr)}`}
        </span>
      </Link>
      <div className="flex flex-col items-end gap-2">
        <StatusBadge status={a.status} label={t(`status.${a.status}`)} />
        {a.status === "booked" && !compact && (
          <a href={whatsappLink(a.patient.phoneE164, "")} target="_blank" rel="noopener noreferrer" className="rounded-md border px-2 py-1 text-xs hover:bg-black/5">
            {t("whatsapp")}
          </a>
        )}
      </div>
    </li>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1" aria-label={t("title")}>
          <Link href={href({ view: "day" })} aria-current={sp.view === "day" ? "page" : undefined} className={tab(sp.view === "day")}>{t("day")}</Link>
          <Link href={href({ view: "week" })} aria-current={sp.view === "week" ? "page" : undefined} className={tab(sp.view === "week")}>{t("week")}</Link>
        </nav>
        <Link href={newHref} className="rounded-md bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black">{t("newAppointment")}</Link>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Link href={href({ date: addDays(date, -step) })} className="rounded-md border px-3 py-2 text-sm hover:bg-black/5">‹ {t("previous")}</Link>
        <Link href={href({ date: today })} className="rounded-md border px-3 py-2 text-sm hover:bg-black/5">{t("today")}</Link>
        <Link href={href({ date: addDays(date, step) })} className="rounded-md border px-3 py-2 text-sm hover:bg-black/5">{t("next")} ›</Link>
        {/* A plain GET form: works without JavaScript and keeps the view shareable. */}
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={sp.view} />
          <label className="flex flex-col gap-1">
            <span className="text-xs opacity-70">{t("date")}</span>
            <input type="date" name="date" defaultValue={date} className="rounded-md border px-2 py-1.5 text-sm" dir="ltr" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs opacity-70">{t("dentist")}</span>
            <select name="staff" defaultValue={staffId ?? ""} className="rounded-md border px-2 py-1.5 text-sm">
              <option value="">{t("allDentists")}</option>
              {dentists.map((d) => <option key={d.id} value={d.id}>{pick(d.displayNameEn, d.displayNameAr)}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-black/5">{t("show")}</button>
        </form>
      </div>

      {sp.view === "day" ? (
        <DayList title={clinicDate(locale, date)} items={appointments} render={(a) => row(a)} t={t} />
      ) : (
        <section className="flex flex-col gap-5" aria-label={t("weekOf", { date: clinicDate(locale, first) })}>
          {appointments.length === 0 && <p className="opacity-60">{t("emptyWeek")}</p>}
          {days.map((d) => {
            const items = appointments.filter((a) => localDate(a.startAt.getTime(), tz) === d);
            const active = items.filter((a) => a.status !== "cancelled");
            const cancelled = items.length - active.length;
            return (
              <div key={d} className="flex flex-col gap-2">
                <h2 className="flex flex-wrap items-baseline gap-2">
                  <Link href={href({ view: "day", date: d })} className={`font-semibold hover:underline ${d === today ? "text-blue-800 dark:text-blue-300" : ""}`}>
                    {clinicDate(locale, d)}
                  </Link>
                  <span className="text-sm opacity-70">{t("count", { count: active.length })}</span>
                  {cancelled > 0 && <span className="text-xs opacity-60">{t("cancelledMore", { count: cancelled })}</span>}
                </h2>
                {active.length > 0 && <ul className="flex flex-col gap-2">{active.map((a) => row(a, true))}</ul>}
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

function DayList({ title, items, render, t }: { title: string; items: ClinicAppointment[]; render: (a: ClinicAppointment) => React.ReactNode; t: Awaited<ReturnType<typeof getTranslations<"Calendar">>> }) {
  const active = items.filter((a) => a.status !== "cancelled");
  const cancelled = items.filter((a) => a.status === "cancelled");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">{title}</span>
        <span className="text-sm opacity-70">{t("count", { count: active.length })}</span>
      </h2>
      {active.length === 0 && <p className="opacity-60">{t("empty")}</p>}
      <ul className="flex flex-col gap-2">{active.map(render)}</ul>
      {cancelled.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm opacity-80">{t("cancelledList", { count: cancelled.length })}</summary>
          <ul className="mt-2 flex flex-col gap-2">{cancelled.map(render)}</ul>
        </details>
      )}
    </section>
  );
}
