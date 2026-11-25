import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { CancelAppointmentButton, OutcomeButtons, ReissueLinkButton, UndoOutcomeButton } from "@/components/calendar/appointment-actions";
import { AppointmentForm } from "@/components/calendar/appointment-form";
import { StatusBadge } from "@/components/calendar/status-badge";
import { bookingFormOptions } from "@/lib/dashboard/form-options";
import { clinicDay, clinicTime, wallClock } from "@/lib/i18n/format";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { localDate } from "@/lib/time/zoned";
import { whatsappLink } from "@/lib/whatsapp";
import { requireClinicPage } from "@/server/auth/page-guards";
import { getAppointment } from "@/server/db/repositories/clinic-appointments";
import { getOwnClinic } from "@/server/db/repositories/clinics";
import { canUndoOutcome, staffActionsFor } from "@/server/services/staff-appointments";

type Props = PageProps<"/[locale]/dashboard/appointments/[id]">;

export default async function AppointmentAdminPage({ params }: Props) {
  const locale = await resolveLocale();
  const t = await getTranslations("AppointmentAdmin");
  return (
    <main className="flex flex-col gap-6">
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <AppointmentBody locale={locale} params={params} />
      </Suspense>
    </main>
  );
}

async function AppointmentBody({ locale, params }: { locale: Locale; params: Props["params"] }) {
  const ctx = await requireClinicPage(locale);
  await connection();
  const { id } = await params;
  // A malformed id is just "not found" — don't hand Postgres a cast error.
  if (!z.uuid().safeParse(id).success) notFound();
  const [a, clinic] = await Promise.all([getAppointment(ctx, id), getOwnClinic(ctx)]);
  // Another clinic's id lands here too: the query is scoped to ctx.clinicId.
  if (!a || !clinic) notFound();

  const t = await getTranslations({ locale, namespace: "AppointmentAdmin" });
  const tz = clinic.timezone;
  const ar = locale === "ar";
  const pick = (en: string, arText: string) => (ar ? arText || en : en || arText);
  const can = staffActionsFor(a);
  const day = localDate(a.startAt.getTime(), tz);
  const canUndo = canUndoOutcome(a, ctx.role, tz);

  // The reminder is offered in both languages: we don't know the patient's.
  const reminder = async (lang: "en" | "ar") => {
    const tl = await getTranslations({ locale: lang, namespace: "AppointmentAdmin" });
    return tl("reminderText", {
      name: a.patient.fullName,
      clinic: (lang === "ar" ? clinic.nameAr : clinic.nameEn) || clinic.nameEn,
      date: clinicDay(lang, tz, a.startAt),
      time: clinicTime(lang, tz, a.startAt),
    });
  };
  const [remindEn, remindAr] = await Promise.all([reminder("en"), reminder("ar")]);
  const options = can.change ? await bookingFormOptions(ctx, locale) : null;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/dashboard/calendar?view=day&date=${day}`} className="self-start text-sm underline">{t("back")}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.patient.fullName}</h1>
          <StatusBadge status={a.status} label={t(`status.${a.status}`)} />
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border p-4">
        <dt className="opacity-70">{t("when")}</dt>
        <dd className="font-medium">
          {clinicDay(locale, tz, a.startAt)} ·{" "}
          <span dir="ltr" className="inline-block">{clinicTime(locale, tz, a.startAt)} – {clinicTime(locale, tz, a.endAt)}</span>
        </dd>
        <dt className="opacity-70">{t("service")}</dt>
        <dd>{pick(a.service.nameEn, a.service.nameAr)}</dd>
        <dt className="opacity-70">{t("dentist")}</dt>
        <dd>{pick(a.staff.nameEn, a.staff.nameAr)}</dd>
        <dt className="opacity-70">{t("phone")}</dt>
        <dd><a href={`tel:${a.patient.phoneE164}`} dir="ltr" className="underline">{a.patient.phoneE164}</a></dd>
        <dt className="opacity-70">{t("booked")}</dt>
        <dd>
          {a.source === "online" ? t("sourceOnline") : t("sourceStaff")}
          {a.rescheduleCount > 0 && <span className="block text-sm opacity-70">{t("patientMoves", { count: a.rescheduleCount })}</span>}
          {a.cancelledBy && <span className="block text-sm opacity-70">{t("cancelledBy", { who: t(`who.${a.cancelledBy}`) })}</span>}
        </dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Link href={`/dashboard/patients/${a.patient.id}`} className="rounded-md border px-4 py-2">{t("openRecord")}</Link>
        <a href={`tel:${a.patient.phoneE164}`} className="rounded-md border px-4 py-2">{t("call")}</a>
      </div>

      {a.status === "booked" && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t("remind")}</h2>
          <div className="flex flex-wrap gap-2">
            <a href={whatsappLink(a.patient.phoneE164, remindAr)} target="_blank" rel="noopener noreferrer" className="rounded-md border px-4 py-2" lang="ar">{t("remindAr")}</a>
            <a href={whatsappLink(a.patient.phoneE164, remindEn)} target="_blank" rel="noopener noreferrer" className="rounded-md border px-4 py-2" lang="en">{t("remindEn")}</a>
          </div>
        </section>
      )}

      {a.status === "booked" && (
        <ReissueLinkButton
          appointmentId={a.id}
          phoneE164={a.patient.phoneE164}
          clinicName={pick(clinic.nameEn, clinic.nameAr)}
          when={{ date: clinicDay(locale, tz, a.startAt), time: clinicTime(locale, tz, a.startAt) }}
        />
      )}

      {can.outcome && (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-semibold">{t("outcomeTitle")}</h2>
          <OutcomeButtons appointmentId={a.id} />
        </section>
      )}

      {canUndo && (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-semibold">{t("outcomeTitle")}</h2>
          <UndoOutcomeButton appointmentId={a.id} />
        </section>
      )}

      {can.change && options && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-semibold">{t("change")}</summary>
          <div className="mt-4">
            <AppointmentForm
              {...options}
              timeZone={tz}
              clinicName={pick(clinic.nameEn, clinic.nameAr)}
              initial={{ serviceId: a.service.id, staffId: a.staff.id, date: day, time: wallClock(tz, a.startAt) }}
              edit={{ appointmentId: a.id, seq: a.icsSequence }}
            />
          </div>
        </details>
      )}

      {can.cancel && <CancelAppointmentButton appointmentId={a.id} seq={a.icsSequence} />}
    </>
  );
}
