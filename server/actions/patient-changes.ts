"use server";

import { z } from "zod";
import { cancelPatientAppointment, reschedulePatientAppointment, type PatientChangeFailure } from "@/server/services/appointment-changes";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { hashToken } from "@/server/services/tokens";
import type { ActionResult } from "./result";

// 32 random bytes, base64url: exactly 43 characters. Anything else is not a link we issued.
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sequence = z.coerce.number().int().min(0);

export type PatientChangeError = "invalid_input" | "rate_limited" | PatientChangeFailure;
type Result = ActionResult<undefined, PatientChangeError>;

/**
 * Public, unauthenticated: the link's token IS the authorization. It is only
 * ever hashed and looked up, never trusted for anything else.
 *
 * Limited per link rather than per address (ARCH2): the token is the only
 * identity here, and an address limit would punish a household or a waiting
 * room on one connection. Reschedule and cancel share one counter, so a script
 * holding a stolen link cannot churn an appointment all day.
 */
export async function patientRescheduleAction(_prev: Result | null, form: FormData): Promise<Result> {
  const parsed = z
    .object({ token, expectedSequence: sequence, startMs: z.coerce.number().int().positive() })
    .safeParse({ token: form.get("token"), expectedSequence: form.get("seq"), startMs: form.get("startMs") });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { token: raw, ...input } = parsed.data;
  const tokenHash = hashToken(raw);
  if (!(await consumeRateLimit("token.change", tokenHash))) return { ok: false, error: "rate_limited" };
  const result = await reschedulePatientAppointment(tokenHash, input, Date.now());
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.reason };
}

export async function patientCancelAction(_prev: Result | null, form: FormData): Promise<Result> {
  const parsed = z.object({ token, expectedSequence: sequence }).safeParse({ token: form.get("token"), expectedSequence: form.get("seq") });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const tokenHash = hashToken(parsed.data.token);
  if (!(await consumeRateLimit("token.change", tokenHash))) return { ok: false, error: "rate_limited" };
  const result = await cancelPatientAppointment(tokenHash, { expectedSequence: parsed.data.expectedSequence }, Date.now());
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.reason };
}
