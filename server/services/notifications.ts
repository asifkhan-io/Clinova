import "server-only";
import { createHash } from "node:crypto";
import { createTranslator } from "next-intl";
import { after } from "next/server";
import { clinicDateTime, clinicNumber, clinicTime } from "@/lib/i18n/format";
import { addDays, localDate, localToUtc } from "@/lib/time/zoned";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { type Database, db } from "../db/client";
import {
  type AppointmentNotice,
  appointmentNotice,
  appointmentNoticeByTokenHash,
  bookedBetween,
  claimNotificationRun,
  clinicRecipients,
  digestClinics,
} from "../db/repositories/notifications";
import { type OutgoingEmail, sendEmail } from "./email";

/**
 * Phase 8d: the three emails in scope §5 that need no WhatsApp API —
 *  - the patient's own confirmation, carrying their private link and .ics,
 *    sent once at booking and only if they typed an address;
 *  - an alert to the clinic when a patient books, moves or cancels online;
 *  - a morning digest of the day's appointments.
 *
 * No patient name or phone number goes into a CLINIC email. Mail passes
 * through Resend (outside the Kingdom) and then sits in inboxes indefinitely,
 * while the dashboard already shows those details behind a login. The clinic
 * emails say what changed and link to it. Reversing this is a one-line change
 * per template, and is a decision to take with the data-residency question.
 *
 * Patient-facing email is not sent on reschedule or cancel, although scope §5
 * lists it: the address is deliberately never stored, so there is nothing to
 * send to. The private page already shows the change.
 */

export type EmailLocale = "en" | "ar";
export type ClinicEvent = "booked" | "rescheduled" | "cancelled";
type Rendered = Omit<OutgoingEmail, "to">;

const MESSAGES: Record<EmailLocale, typeof en> = { en, ar };
const translator = (locale: EmailLocale) => createTranslator({ locale, messages: MESSAGES[locale], namespace: "Email" });

/** Everything we interpolate is clinic- or patient-typed text; none of it is trusted HTML. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Absolute links need the deployment's own address. Without it we do not send. */
export function appBaseUrl(): string | null {
  const url = process.env.BETTER_AUTH_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

// An untranslated Arabic name (NULL, scope §13) falls back to English, never to a blank.
const pick = (locale: EmailLocale, enValue: string, arValue: string | null) => (locale === "ar" ? arValue || enValue : enValue);

function button(href: string, label: string): string {
  return `<p style="margin:20px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${esc(label)}</a></p>`;
}

function detailRows(rows: [string, string][]): string {
  return `<table role="presentation" style="border-collapse:collapse;margin:12px 0">${rows
    .map(([label, value]) => `<tr><td style="padding:4px 0;color:#666666;padding-inline-end:16px">${esc(label)}</td><td style="padding:4px 0;font-weight:600">${esc(value)}</td></tr>`)
    .join("")}</table>`;
}

/** One card per language. Arabic cards carry dir="rtl" so mail clients lay them out right to left. */
function layout(cards: { locale: EmailLocale; body: string }[]): string {
  const rendered = cards
    .map(
      ({ locale, body }) =>
        `<div lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}" style="max-width:560px;margin:0 auto 16px;background:#ffffff;border-radius:10px;padding:24px;text-align:${locale === "ar" ? "right" : "left"}">${body}</div>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#111111;line-height:1.6">${rendered}</body></html>`;
}

const footer = (locale: EmailLocale) => `<p style="margin:16px 0 0;color:#888888;font-size:12px">${esc(translator(locale)("footer"))}</p>`;

/* --------------------------------- templates --------------------------------- */

/** The patient's confirmation, in the language they booked in. */
export function patientBookingEmail(n: AppointmentNotice, token: string, locale: EmailLocale, base: string): Rendered {
  const t = translator(locale);
  const clinic = pick(locale, n.clinicNameEn, n.clinicNameAr);
  const when = clinicDateTime(locale, n.timeZone).format(n.startAt);
  const rows: [string, string][] = [
    [t("when"), when],
    [t("dentist"), pick(locale, n.staffNameEn, n.staffNameAr)],
    [t("service"), pick(locale, n.serviceNameEn, n.serviceNameAr)],
  ];
  const manage = `${base}/${locale}/a/${token}`;
  const ics = `${base}/api/public/a/${token}/ics?lang=${locale}`;
  const body =
    `<h1 style="font-size:20px;margin:0 0 4px">${esc(t("patientHeading"))}</h1>` +
    `<p style="margin:0;color:#444444">${esc(clinic)}</p>` +
    detailRows(rows) +
    `<p style="margin:8px 0">${esc(t("payAtClinic"))}</p>` +
    button(manage, t("manage")) +
    `<p style="margin:4px 0"><a href="${esc(ics)}">${esc(t("addToCalendar"))}</a></p>` +
    `<p style="margin:16px 0 0;color:#666666;font-size:13px">${esc(t("keepPrivate"))}</p>` +
    footer(locale);
  const text = [t("patientHeading"), clinic, ...rows.map(([k, v]) => `${k}: ${v}`), t("payAtClinic"), `${t("manage")}: ${manage}`, `${t("addToCalendar")}: ${ics}`, t("keepPrivate")].join("\n");
  return { subject: t("patientSubject", { clinic }), html: layout([{ locale, body }]), text };
}

/** To the clinic, in Arabic and English, with no patient name or phone. */
export function clinicAlertEmail(n: AppointmentNotice, event: ClinicEvent, base: string): Rendered {
  const cards = (["ar", "en"] as const).map((locale) => {
    const t = translator(locale);
    const when = clinicDateTime(locale, n.timeZone).format(n.startAt);
    const rows: [string, string][] = [
      [t("when"), when],
      [t("dentist"), pick(locale, n.staffNameEn, n.staffNameAr)],
      [t("service"), pick(locale, n.serviceNameEn, n.serviceNameAr)],
    ];
    const link = `${base}/${locale}/dashboard/appointments/${n.id}`;
    return {
      locale,
      subject: t("alertSubject", { event, when }),
      text: [t("alertHeading", { event }), ...rows.map(([k, v]) => `${k}: ${v}`), t("alertPrivacy"), `${t("openAppointment")}: ${link}`].join("\n"),
      body:
        `<h1 style="font-size:20px;margin:0 0 4px">${esc(t("alertHeading", { event }))}</h1>` +
        `<p style="margin:0;color:#444444">${esc(pick(locale, n.clinicNameEn, n.clinicNameAr))}</p>` +
        detailRows(rows) +
        `<p style="margin:8px 0;color:#666666;font-size:13px">${esc(t("alertPrivacy"))}</p>` +
        button(link, t("openAppointment")) +
        footer(locale),
    };
  });
  return {
    subject: cards.find((c) => c.locale === "en")!.subject,
    html: layout(cards),
    text: cards.map((c) => c.text).join("\n\n— — —\n\n"),
  };
}

/** The day at a glance, Arabic and English, times on the clinic's wall clock. */
export function morningDigestEmail(
  clinic: { nameEn: string; nameAr: string | null; timeZone: string },
  items: AppointmentNotice[],
  base: string,
): Rendered {
  const cards = (["ar", "en"] as const).map((locale) => {
    const t = translator(locale);
    const name = pick(locale, clinic.nameEn, clinic.nameAr);
    const lines = items.map(
      (a) => `${clinicTime(locale, clinic.timeZone, a.startAt)} · ${pick(locale, a.staffNameEn, a.staffNameAr)} · ${pick(locale, a.serviceNameEn, a.serviceNameAr)}`,
    );
    const calendar = `${base}/${locale}/dashboard/calendar`;
    const subject = t("digestSubject", { clinic: name, count: items.length, countText: clinicNumber(locale).format(items.length) });
    const list =
      lines.length === 0
        ? `<p>${esc(t("digestEmpty"))}</p>`
        : `<ul style="padding-inline-start:20px;margin:12px 0">${lines.map((l) => `<li style="margin:4px 0">${esc(l)}</li>`).join("")}</ul>`;
    return {
      locale,
      subject,
      text: [subject, ...(lines.length ? lines : [t("digestEmpty")]), `${t("openCalendar")}: ${calendar}`].join("\n"),
      body:
        `<h1 style="font-size:20px;margin:0 0 4px">${esc(t("digestHeading"))}</h1>` +
        `<p style="margin:0;color:#444444">${esc(name)}</p>` +
        list +
        `<p style="margin:8px 0;color:#666666;font-size:13px">${esc(t("alertPrivacy"))}</p>` +
        button(calendar, t("openCalendar")) +
        footer(locale),
    };
  });
  return {
    subject: cards.find((c) => c.locale === "en")!.subject,
    html: layout(cards),
    text: cards.map((c) => c.text).join("\n\n— — —\n\n"),
  };
}

/* -------------------------------- delivery -------------------------------- */

/**
 * Run notification work once the response has gone out. A booking must never
 * wait on, or fail because of, an email: anything thrown here is caught and
 * logged by label only — no address, no patient detail.
 */
function deliverAfterResponse(label: string, task: () => Promise<void>): void {
  after(async () => {
    try {
      await task();
    } catch {
      console.error(`notifications: ${label} failed`);
    }
  });
}

/** One message per recipient, so one bad address cannot sink the rest and members don't see each other's. */
async function sendToEach(recipients: string[], email: Rendered, keyPrefix?: string): Promise<void> {
  await Promise.all(
    recipients.map((to) =>
      sendEmail({
        ...email,
        to: [to],
        idempotencyKey: keyPrefix ? `${keyPrefix}:${createHash("sha256").update(to).digest("hex").slice(0, 16)}` : undefined,
      }),
    ),
  );
}

export function notifyPublicBooking(input: {
  appointmentId: string;
  token: string;
  locale: EmailLocale;
  patientEmail?: string;
}): void {
  deliverAfterResponse("public booking", async () => {
    const base = appBaseUrl();
    if (!base) return;
    const notice = await appointmentNotice(db, input.appointmentId);
    if (!notice) return;
    // Used here once and then dropped: the address is never written anywhere.
    const patient = input.patientEmail ? sendEmail({ to: [input.patientEmail], ...patientBookingEmail(notice, input.token, input.locale, base) }) : null;
    const clinic = sendToEach(await clinicRecipients(db, notice.clinicId), clinicAlertEmail(notice, "booked", base));
    await Promise.all([patient, clinic]);
  });
}

export function notifyPatientChange(tokenHash: string, event: Exclude<ClinicEvent, "booked">): void {
  deliverAfterResponse(`patient ${event}`, async () => {
    const base = appBaseUrl();
    if (!base) return;
    const notice = await appointmentNoticeByTokenHash(db, tokenHash);
    if (!notice) return;
    await sendToEach(await clinicRecipients(db, notice.clinicId), clinicAlertEmail(notice, event, base));
  });
}

/* ------------------------------ morning digest ------------------------------ */

/** The local hour the digest goes out. The cron fires once a day at 04:00 UTC, which is 07:00 in Riyadh. */
export const DIGEST_LOCAL_HOUR = 7;

function localHour(nowMs: number, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(nowMs));
}

export type DigestRun = { sent: number; empty: number; notDue: number; alreadySent: number };

/**
 * Send each clinic whose local time is DIGEST_LOCAL_HOUR its day's list.
 *
 * Written for an HOURLY trigger, which is what several timezones need
 * (user-flows §10), even though Vercel's free plan only allows a daily cron:
 * moving to Pro means changing the schedule in vercel.json and nothing here.
 * At most once per clinic per day, claimed before sending.
 */
export async function runMorningDigests(nowMs: number = Date.now(), database: Database = db): Promise<DigestRun> {
  const run: DigestRun = { sent: 0, empty: 0, notDue: 0, alreadySent: 0 };
  const base = appBaseUrl();
  if (!base) return run;

  for (const clinic of await digestClinics(database)) {
    if (localHour(nowMs, clinic.timeZone) !== DIGEST_LOCAL_HOUR) {
      run.notDue++;
      continue;
    }
    const day = localDate(nowMs, clinic.timeZone);
    const from = localToUtc(day, 0, clinic.timeZone);
    const to = localToUtc(addDays(day, 1), 0, clinic.timeZone);
    // A zone with no such midnight is not a reason to guess a window.
    if (from === null || to === null) continue;
    if (!(await claimNotificationRun(database, { clinicId: clinic.id, kind: "morning_digest", runKey: day }))) {
      run.alreadySent++;
      continue;
    }
    const items = await bookedBetween(database, clinic.id, new Date(from), new Date(to));
    // A daily "nothing today" teaches people to ignore the email that matters.
    if (items.length === 0) {
      run.empty++;
      continue;
    }
    await sendToEach(await clinicRecipients(database, clinic.id), morningDigestEmail(clinic, items, base), `digest:${clinic.id}:${day}`);
    run.sent++;
  }
  return run;
}
