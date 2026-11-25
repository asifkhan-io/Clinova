import "server-only";
import { cancelAppointment, moveAppointment } from "../db/repositories/appointments";
import { getAppointment, insertStaffBooking, listAppointments, reissueAccessToken, setAppointmentOutcome, undoAppointmentOutcome } from "../db/repositories/clinic-appointments";
import { getOwnClinic } from "../db/repositories/clinics";
import type { ClinicContext, ClinicRole } from "../db/repositories/context";
import { loadServiceProviders } from "../db/repositories/schedule";
import { STAFF_HORIZON_DAYS, getSlotsForDate } from "./availability";
import { addDays, localDate, localToUtc } from "./availability/time";
import { loadBusyForDate } from "./booking";
import { newToken } from "./tokens";

/**
 * The clinic side of booking (flows §6–8, scope §4). Staff may override the
 * SOFT rules — working hours, lead time, buffer, horizon, change cutoff — for
 * walk-ins and phone calls. They can never override the database's no-overlap
 * constraint, and they can only touch their own clinic's rows.
 */

/** Suggested open times, one dentist, one day: hours and closures applied, no lead/buffer. */
export async function staffSlotSuggestions(
  ctx: ClinicContext,
  input: { serviceId: string; staffId: string; date: string; excludeAppointmentId?: string },
  nowMs: number,
): Promise<number[]> {
  const busy = await loadBusyForDate(ctx, input.serviceId, input.date, input.excludeAppointmentId);
  const slots = await getSlotsForDate(ctx, { serviceId: input.serviceId, date: input.date, nowMs, staffId: input.staffId, busy, staffOverride: true });
  return slots.map((s) => s.startMs);
}

export type StaffTimeFailure = "invalid_time" | "not_bookable";

/**
 * A staff-chosen time is valid if it's on a whole minute, starts no earlier
 * than today (clinic time — a walk-in recorded late still counts) and no later
 * than the staff horizon; and the dentist actually performs the service.
 * Returns the end time from the service's CURRENT duration.
 */
async function checkStaffTime(
  ctx: ClinicContext,
  input: { serviceId: string; staffId: string; startMs: number },
  nowMs: number,
): Promise<{ ok: true; endMs: number } | { ok: false; reason: StaffTimeFailure }> {
  const clinic = await getOwnClinic(ctx);
  if (!clinic) return { ok: false, reason: "not_bookable" };
  const today = localDate(nowMs, clinic.timezone);
  const earliest = localToUtc(today, 0, clinic.timezone) ?? nowMs;
  const latest = localToUtc(addDays(today, STAFF_HORIZON_DAYS), 0, clinic.timezone) ?? nowMs;
  if (input.startMs % 60_000 !== 0 || input.startMs < earliest || input.startMs >= latest) return { ok: false, reason: "invalid_time" };

  const providers = await loadServiceProviders(ctx, input.serviceId);
  if (!providers || !providers.staffIds.includes(input.staffId)) return { ok: false, reason: "not_bookable" };
  return { ok: true, endMs: input.startMs + providers.service.durationMinutes * 60_000 };
}

export type StaffBookingResult =
  | { ok: true; appointmentId: string; token: string }
  | { ok: false; reason: StaffTimeFailure | "slot_taken" };

/** Manual booking for a walk-in or a phone call. Works even while online booking is off. */
export async function createStaffAppointment(
  ctx: ClinicContext,
  input: { serviceId: string; staffId: string; startMs: number; fullName: string; phoneE164: string },
  nowMs: number,
): Promise<StaffBookingResult> {
  const time = await checkStaffTime(ctx, input, nowMs);
  if (!time.ok) return time;
  // Every appointment gets a private link, so staff can send it to the patient.
  // This is the only moment the raw token exists (only its hash is stored).
  const { token, hash } = newToken();
  const inserted = await insertStaffBooking(ctx, { ...input, endMs: time.endMs, accessTokenHash: hash });
  if (!inserted.ok) return inserted;
  return { ok: true, appointmentId: inserted.appointmentId, token };
}

export type StaffChangeResult = { ok: true } | { ok: false; reason: StaffTimeFailure | "not_found" | "changed" | "slot_taken" | "started" | "not_started" };

/** Staff may change the time, the dentist and the service (flows §7). */
export async function staffRescheduleAppointment(
  ctx: ClinicContext,
  input: { appointmentId: string; expectedSequence: number; serviceId: string; staffId: string; startMs: number },
  nowMs: number,
): Promise<StaffChangeResult> {
  const current = await getAppointment(ctx, input.appointmentId);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "booked" || current.icsSequence !== input.expectedSequence) return { ok: false, reason: "changed" };
  const time = await checkStaffTime(ctx, input, nowMs);
  if (!time.ok) return time;
  return moveAppointment(ctx, { ...input, endMs: time.endMs, actor: { type: "staff", userId: ctx.userId } });
}

export async function staffCancelAppointment(ctx: ClinicContext, input: { appointmentId: string; expectedSequence: number }, nowMs: number): Promise<StaffChangeResult> {
  return cancelAppointment(ctx, { ...input, actor: { type: "staff", userId: ctx.userId }, nowMs });
}

export async function staffSetOutcome(ctx: ClinicContext, input: { appointmentId: string; status: "completed" | "no_show" }, nowMs: number): Promise<StaffChangeResult> {
  return setAppointmentOutcome(ctx, { ...input, nowMs });
}

/** A date and wall-clock time typed by staff, in the clinic's own zone, to UTC. */
export async function clinicWallTimeToUtc(ctx: ClinicContext, date: string, minutes: number): Promise<number | null> {
  const clinic = await getOwnClinic(ctx);
  return clinic ? localToUtc(date, minutes, clinic.timezone) : null;
}

/**
 * Which buttons the appointment page shows. The same rules are enforced again
 * by each action under a row lock; this only keeps the screen honest.
 */
export function staffActionsFor(a: { status: string; startAt: Date }, nowMs: number = Date.now()) {
  const booked = a.status === "booked";
  const started = a.startAt.getTime() <= nowMs;
  return { change: booked, cancel: booked && !started, outcome: booked && started };
}

/** The dashboard's "Today" card: how many, and who's next. */
export async function todaySummary(ctx: ClinicContext, timeZone: string, nowMs: number = Date.now()) {
  const today = localDate(nowMs, timeZone);
  const list = await listAppointments(ctx, {
    fromMs: localToUtc(today, 0, timeZone) ?? nowMs,
    toMs: localToUtc(addDays(today, 1), 0, timeZone) ?? nowMs,
  });
  const active = list.filter((a) => a.status !== "cancelled");
  const next = active.find((a) => a.status === "booked" && a.endAt.getTime() > nowMs) ?? null;
  return { count: active.length, next };
}

export type ReissueLinkOutcome = { ok: true; token: string } | { ok: false; reason: "not_found" | "changed" };

/**
 * A fresh private link for an existing booking (Phase 8b). The staff booking
 * flow shows the link exactly once, so without this a lost link means
 * cancelling and rebooking. Issuing a new one immediately kills the old.
 */
export async function reissueAppointmentLink(ctx: ClinicContext, appointmentId: string): Promise<ReissueLinkOutcome> {
  // As at booking: this is the only moment the raw token exists.
  const { token, hash } = newToken();
  const result = await reissueAccessToken(ctx, { appointmentId, accessTokenHash: hash });
  return result.ok ? { ok: true, token } : result;
}

export type UndoOutcomeOutcome = { ok: true } | { ok: false; reason: "not_found" | "changed" | "too_late" | "slot_taken" };

/**
 * Put a mis-tapped Completed or No-show back to booked (Phase 8c).
 *
 * Completed and No-show are otherwise final, which is right: they are the
 * clinic's record of what happened. But a receptionist taps No-show and the
 * patient walks in eight minutes later, and without this the only fix is a
 * database edit. The window is the appointment's own day in the clinic's
 * timezone — long enough to correct a mistake, short enough that nobody
 * rewrites last month's history. The action layer restricts it to the owner.
 */
export async function staffUndoOutcome(ctx: ClinicContext, appointmentId: string, nowMs: number): Promise<UndoOutcomeOutcome> {
  const [appointment, clinic] = await Promise.all([getAppointment(ctx, appointmentId), getOwnClinic(ctx)]);
  if (!appointment || !clinic) return { ok: false, reason: "not_found" };
  const day = localDate(appointment.startAt.getTime(), clinic.timezone);
  const allowedUntilMs = localToUtc(addDays(day, 1), 0, clinic.timezone);
  // A zone with no such midnight is not a reason to widen the window.
  if (allowedUntilMs === null) return { ok: false, reason: "too_late" };
  return undoAppointmentOutcome(ctx, { appointmentId, nowMs, allowedUntilMs });
}

/**
 * Whether the screen should offer to undo this outcome (Phase 8c). Lives here
 * rather than in the page for the same reason staffActionsFor does: the clock
 * is read outside render, and staffUndoOutcome enforces the same rule again
 * under a row lock, so a stale screen cannot talk the server into it.
 */
export function canUndoOutcome(
  appointment: { status: string; startAt: Date },
  role: ClinicRole,
  timeZone: string,
  nowMs: number = Date.now(),
): boolean {
  if (appointment.status !== "completed" && appointment.status !== "no_show") return false;
  if (role !== "clinic_owner") return false;
  return localDate(nowMs, timeZone) === localDate(appointment.startAt.getTime(), timeZone);
}
