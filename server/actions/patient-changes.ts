"use server";

import { z } from "zod";
import { cancelPatientAppointment, reschedulePatientAppointment, type PatientChangeFailure } from "@/server/services/appointment-changes";
import { hashToken } from "@/server/services/tokens";
import type { ActionResult } from "./result";

// 32 random bytes, base64url: exactly 43 characters. Anything else is not a link we issued.
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sequence = z.coerce.number().int().min(0);

export type PatientChangeError = "invalid_input" | PatientChangeFailure;
type Result = ActionResult<undefined, PatientChangeError>;

/**
 * Public, unauthenticated: the link's token IS the authorization. It is only
 * ever hashed and looked up, never trusted for anything else. Rate limiting per
 * token arrives in Phase 8 (ARCH2).
 */
export async function patientRescheduleAction(_prev: Result | null, form: FormData): Promise<Result> {
  const parsed = z
    .object({ token, expectedSequence: sequence, startMs: z.coerce.number().int().positive() })
    .safeParse({ token: form.get("token"), expectedSequence: form.get("seq"), startMs: form.get("startMs") });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { token: raw, ...input } = parsed.data;
  const result = await reschedulePatientAppointment(hashToken(raw), input, Date.now());
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.reason };
}

export async function patientCancelAction(_prev: Result | null, form: FormData): Promise<Result> {
  const parsed = z.object({ token, expectedSequence: sequence }).safeParse({ token: form.get("token"), expectedSequence: form.get("seq") });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const result = await cancelPatientAppointment(hashToken(parsed.data.token), { expectedSequence: parsed.data.expectedSequence }, Date.now());
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.reason };
}
