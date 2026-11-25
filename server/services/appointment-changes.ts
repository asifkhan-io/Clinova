import "server-only";
import { cancelAppointment, findAppointmentByToken, findAppointmentForChange, moveAppointment } from "../db/repositories/appointments";
import { getSlotsForDate } from "./availability";
import { localDate } from "./availability/time";
import { loadBusyForDate } from "./booking";

/** A patient may move one appointment this many times; then they call (flows §7). */
export const MAX_PATIENT_RESCHEDULES = 2;

export type RescheduleState = "allowed" | "unavailable" | "cutoff_passed" | "limit_reached" | "booking_closed";

type ChangeFacts = {
  status: string;
  startAt: Date;
  rescheduleCount: number;
  clinic: { bookingEnabled: boolean; changeCutoffMinutes: number };
};

/**
 * What the patient's link may do right now. One function decides it, so the
 * page's buttons, the slot endpoint and the Server Actions can't disagree.
 *  - Cancel: any time before the start. No cutoff (D12): late notice still
 *    beats a no-show.
 *  - Reschedule: before start − change cutoff, under the limit, and only while
 *    the clinic takes online bookings (a move is a new online booking).
 */
export function patientChangeState(appt: ChangeFacts, nowMs: number): { canCancel: boolean; reschedule: RescheduleState } {
  const startMs = appt.startAt.getTime();
  const open = appt.status === "booked" && startMs > nowMs;
  const reschedule: RescheduleState = !open
    ? "unavailable"
    : nowMs >= startMs - appt.clinic.changeCutoffMinutes * 60_000
      ? "cutoff_passed"
      : appt.rescheduleCount >= MAX_PATIENT_RESCHEDULES
        ? "limit_reached"
        : !appt.clinic.bookingEnabled
          ? "booking_closed"
          : "allowed";
  return { canCancel: open, reschedule };
}

/** The private page's data: the appointment and what its link may do now. */
export async function getPatientAppointment(tokenHash: string, nowMs: number = Date.now()) {
  const appt = await findAppointmentByToken(tokenHash, nowMs);
  if (!appt) return null;
  return { appt, changes: patientChangeState(appt, nowMs) };
}

/**
 * Open times for moving this appointment on one local date: same service,
 * same dentist (D10), every patient rule applied, and the appointment's own
 * current time not counted as busy (it frees itself when moved).
 */
export async function patientRescheduleSlots(tokenHash: string, date: string, nowMs: number): Promise<number[]> {
  const found = await findAppointmentForChange(tokenHash, nowMs);
  if (!found) return [];
  const { appointment: a, scope } = found;
  if (patientChangeState(a, nowMs).reschedule !== "allowed") return [];
  const busy = await loadBusyForDate(scope, a.serviceId, date, a.id);
  const slots = await getSlotsForDate(scope, { serviceId: a.serviceId, date, nowMs, staffId: a.staffId, busy });
  const current = a.startAt.getTime();
  return slots.filter((s) => s.startMs !== current).map((s) => s.startMs);
}

export type PatientChangeFailure = "not_found" | "changed" | "not_allowed" | "slot_unavailable" | "slot_taken";
export type PatientChangeResult = { ok: true } | { ok: false; reason: PatientChangeFailure };

/** The client's chosen time is a request: availability is recomputed here. */
export async function reschedulePatientAppointment(
  tokenHash: string,
  input: { startMs: number; expectedSequence: number },
  nowMs: number,
): Promise<PatientChangeResult> {
  const found = await findAppointmentForChange(tokenHash, nowMs);
  if (!found) return { ok: false, reason: "not_found" };
  const { appointment: a, scope } = found;
  if (a.icsSequence !== input.expectedSequence) return { ok: false, reason: "changed" };
  if (patientChangeState(a, nowMs).reschedule !== "allowed") return { ok: false, reason: "not_allowed" };

  const date = localDate(input.startMs, a.clinic.timezone);
  const busy = await loadBusyForDate(scope, a.serviceId, date, a.id);
  const slot = (await getSlotsForDate(scope, { serviceId: a.serviceId, date, nowMs, staffId: a.staffId, busy })).find(
    (s) => s.startMs === input.startMs,
  );
  if (!slot || slot.startMs === a.startAt.getTime()) return { ok: false, reason: "slot_unavailable" };

  return moveAppointment(scope, {
    appointmentId: a.id,
    expectedSequence: input.expectedSequence,
    staffId: a.staffId,
    serviceId: a.serviceId,
    startMs: slot.startMs,
    endMs: slot.endMs,
    actor: { type: "patient" },
  });
}

export async function cancelPatientAppointment(
  tokenHash: string,
  input: { expectedSequence: number },
  nowMs: number,
): Promise<PatientChangeResult> {
  const found = await findAppointmentForChange(tokenHash, nowMs);
  if (!found) return { ok: false, reason: "not_found" };
  const { appointment: a, scope } = found;
  if (a.icsSequence !== input.expectedSequence) return { ok: false, reason: "changed" };
  if (!patientChangeState(a, nowMs).canCancel) return { ok: false, reason: "not_allowed" };
  const result = await cancelAppointment(scope, {
    appointmentId: a.id,
    expectedSequence: input.expectedSequence,
    actor: { type: "patient" },
    nowMs,
  });
  if (!result.ok) return { ok: false, reason: result.reason === "started" ? "not_allowed" : "changed" };
  return { ok: true };
}
