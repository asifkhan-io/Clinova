"use server";

import type { AuthErrorCode } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import { listClinicHours, replaceClinicHours, replaceStaffHours } from "@/server/db/repositories/hours";
import { weekSchema } from "@/lib/validation/hours";
import { uuidSchema } from "@/lib/validation/service";
import { type ActionResult, authFailure } from "./result";

export type HoursActionError = AuthErrorCode | "invalid_input" | "overlap" | "not_found";
type Result = ActionResult<undefined, HoursActionError>;

function parseWeek(raw: FormDataEntryValue | null) {
  let json: unknown;
  try {
    json = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { ok: false as const, error: "invalid_input" as const };
  }
  const parsed = weekSchema.safeParse(json);
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const overlap = parsed.error.issues.some((i) => i.message === "overlap");
  return { ok: false as const, error: overlap ? ("overlap" as const) : ("invalid_input" as const) };
}

/** `staffId` empty = the clinic's template hours; set = that dentist's hours. */
export async function saveHoursAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await requireClinicAccess("clinic_owner", { write: true });
  } catch (e) {
    return authFailure(e);
  }
  const week = parseWeek(form.get("intervals"));
  if (!week.ok) return { ok: false, error: week.error };

  const rawStaffId = form.get("staffId");
  if (!rawStaffId) {
    await replaceClinicHours(ctx, week.data);
    return { ok: true, data: undefined };
  }
  const staffId = uuidSchema.safeParse(rawStaffId);
  if (!staffId.success) return { ok: false, error: "invalid_input" };
  const ok = await replaceStaffHours(ctx, staffId.data, week.data);
  return ok ? { ok: true, data: undefined } : { ok: false, error: "not_found" };
}

/** "Same as clinic hours": overwrite one dentist's week with the clinic template. */
export async function copyClinicHoursAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await requireClinicAccess("clinic_owner", { write: true });
  } catch (e) {
    return authFailure(e);
  }
  const staffId = uuidSchema.safeParse(form.get("staffId"));
  if (!staffId.success) return { ok: false, error: "invalid_input" };
  const template = await listClinicHours(ctx);
  const ok = await replaceStaffHours(ctx, staffId.data, template);
  return ok ? { ok: true, data: undefined } : { ok: false, error: "not_found" };
}
