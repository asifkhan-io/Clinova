"use server";

import { z } from "zod";
import type { AuthErrorCode } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import { updatePatient } from "@/server/db/repositories/patients";
import {
  clinicWallTimeToUtc,
  createStaffAppointment,
  reissueAppointmentLink,
  staffCancelAppointment,
  staffRescheduleAppointment,
  staffSetOutcome,
} from "@/server/services/staff-appointments";
import { minutesOf, patientEditSchema, staffBookingSchema, staffRescheduleSchema } from "@/lib/validation/appointment";
import { type ActionResult, authFailure } from "./result";

/**
 * Clinic-side appointment mutations. Any clinic member may do these (scope §3:
 * staff create, reschedule and cancel). A suspended clinic can read but not
 * write. The clinic always comes from the session, never from the form.
 */
export type AppointmentActionError =
  | AuthErrorCode
  | "invalid_input"
  | "phone"
  | "invalid_time"
  | "not_bookable"
  | "slot_taken"
  | "not_found"
  | "changed"
  | "started"
  | "not_started"
  | "phone_taken";

async function member() {
  return requireClinicAccess("clinic_staff", { write: true });
}
const fieldError = (issues: { path: PropertyKey[] }[]) => (issues.some((i) => i.path[0] === "phone") ? "phone" : "invalid_input");

/** What the form needs to offer "send the patient their link". */
export type CreatedAppointment = { appointmentId: string; token: string; startMs: number; phoneE164: string };

export async function createAppointmentAction(
  _prev: ActionResult<CreatedAppointment, AppointmentActionError> | null,
  form: FormData,
): Promise<ActionResult<CreatedAppointment, AppointmentActionError>> {
  let ctx;
  try {
    ctx = await member();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = staffBookingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error.issues) };
  const { date, time, phone, ...rest } = parsed.data;
  const startMs = await clinicWallTimeToUtc(ctx, date, minutesOf(time));
  if (startMs === null) return { ok: false, error: "invalid_time" };
  const result = await createStaffAppointment(ctx, { ...rest, startMs, phoneE164: phone }, Date.now());
  return result.ok
    ? { ok: true, data: { appointmentId: result.appointmentId, token: result.token, startMs, phoneE164: phone } }
    : { ok: false, error: result.reason };
}

type Result = ActionResult<undefined, AppointmentActionError>;
const done = (r: { ok: true } | { ok: false; reason: AppointmentActionError }): Result =>
  r.ok ? { ok: true, data: undefined } : { ok: false, error: r.reason };

export async function rescheduleAppointmentAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await member();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = staffRescheduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { date, time, ...rest } = parsed.data;
  const startMs = await clinicWallTimeToUtc(ctx, date, minutesOf(time));
  if (startMs === null) return { ok: false, error: "invalid_time" };
  return done(await staffRescheduleAppointment(ctx, { ...rest, startMs }, Date.now()));
}

export async function cancelAppointmentAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await member();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = z.object({ appointmentId: z.uuid(), expectedSequence: z.coerce.number().int().min(0) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  return done(await staffCancelAppointment(ctx, parsed.data, Date.now()));
}

export async function setOutcomeAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await member();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = z.object({ appointmentId: z.uuid(), status: z.enum(["completed", "no_show"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  return done(await staffSetOutcome(ctx, parsed.data, Date.now()));
}

export async function updatePatientAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await member();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = patientEditSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: fieldError(parsed.error.issues) };
  return done(await updatePatient(ctx, parsed.data.patientId, { fullName: parsed.data.fullName, phoneE164: parsed.data.phone }));
}

/**
 * A replacement private link for a booking whose link was lost (Phase 8b).
 * Shown once, exactly like the original: the raw token is in this result and
 * nowhere else, and issuing it stops the previous link working immediately.
 */
export async function reissueLinkAction(
  _prev: ActionResult<{ token: string }, AppointmentActionError> | null,
  form: FormData,
): Promise<ActionResult<{ token: string }, AppointmentActionError>> {
  let ctx;
  try {
    ctx = await member();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = z.object({ appointmentId: z.uuid() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const result = await reissueAppointmentLink(ctx, parsed.data.appointmentId);
  return result.ok ? { ok: true, data: { token: result.token } } : { ok: false, error: result.reason };
}
