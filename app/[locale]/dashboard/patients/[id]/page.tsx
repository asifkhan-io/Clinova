import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/calendar/status-badge";
import { ErasePatientForm } from "@/components/patients/erase-patient-form";
import { PatientEditForm } from "@/components/patients/patient-edit-form";
import { clinicDay, clinicTime } from "@/lib/i18n/format";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { whatsappLink } from "@/lib/whatsapp";
import { requireClinicPage } from "@/server/auth/page-guards";
import { getOwnClinic } from "@/server/db/repositories/clinics";
import { getPatientRecord } from "@/server/db/repositories/patients";

type Props = PageProps<"/[locale]/dashboard/patients/[id]">;

export default async function PatientPage({ params }: Props) {
  const locale = await resolveLocale();
  const t = await getTranslations("Patients");
  return (
    <main className="flex flex-col gap-6">
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <PatientBody locale={locale} params={params} />
      </Suspense>
    </main>
  );
}

async function PatientBody({ locale, params }: { locale: Locale; params: Props["params"] }) {
  const ctx = await requireClinicPage(locale);
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  // getPatientRecord writes the patient.record_viewed audit row itself.
  const [record, clinic] = await Promise.all([getPatientRecord(ctx, id), getOwnClinic(ctx)]);
  if (!record || !clinic) notFound();

  const t = await getTranslations({ locale, namespace: "Patients" });
  const { patient, history } = record;
  const tz = clinic.timezone;
  const ar = locale === "ar";
  const pick = (en: string, arText: string | null) => (ar ? arText || en : en);
  const erasedAt = patient.anonymizedAt;
  const erased = erasedAt !== null;
  const canEdit = ctx.clinicStatus !== "suspended" && !erased;
  // Erasing is the owner's call (Phase 9d); the action checks the role again.
  const canErase = canEdit && ctx.role === "clinic_owner";

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/dashboard/patients" className="self-start text-sm underline">{t("back")}</Link>
        {erasedAt ? (
          <>
            <h1 className="text-2xl font-semibold">{t("erasedName")}</h1>
            <p role="status" className="rounded-lg border p-3 text-sm">{t("erasedNotice", { date: clinicDay(locale, tz, erasedAt) })}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{patient.fullName}</h1>
            <p dir="ltr" className="self-start opacity-80">{patient.phoneE164}</p>
            <div className="flex flex-wrap gap-2">
              <a href={whatsappLink(patient.phoneE164, t("greeting", { name: patient.fullName }))} target="_blank" rel="noopener noreferrer" className="rounded-md border px-4 py-2">{t("whatsapp")}</a>
              <a href={`tel:${patient.phoneE164}`} className="rounded-md border px-4 py-2">{t("call")}</a>
            </div>
          </>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("history")}</h2>
        {history.length === 0 && <p className="opacity-60">{t("noHistory")}</p>}
        <ul className="flex flex-col gap-2">
          {history.map((h) => (
            <li key={h.id}>
              <Link href={`/dashboard/appointments/${h.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 hover:bg-black/5">
                <span className="flex flex-col">
                  <span className="font-medium">
                    {clinicDay(locale, tz, h.startAt)} · <span dir="ltr" className="inline-block">{clinicTime(locale, tz, h.startAt)}</span>
                  </span>
                  <span className="text-sm opacity-70">{pick(h.service.nameEn, h.service.nameAr)} · {pick(h.staff.nameEn, h.staff.nameAr)}</span>
                </span>
                <StatusBadge status={h.status} label={t(`status.${h.status}`)} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {canEdit && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-semibold">{t("edit")}</summary>
          <div className="mt-4">
            <PatientEditForm patientId={patient.id} fullName={patient.fullName} phone={patient.phoneE164} />
          </div>
        </details>
      )}

      {canErase && <ErasePatientForm patientId={patient.id} />}

      <p className="text-xs opacity-60">{t("privacyNote")}</p>
    </>
  );
}
