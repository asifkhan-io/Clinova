"use server";

import type { AuthErrorCode } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import { createOverride, deleteOverride } from "@/server/db/repositories/overrides";
import { overrideSchema } from "@/lib/validation/override";
import { uuidSchema } from "@/lib/validation/service";
import { type ActionResult, authFailure } from "./result";

export type OverrideActionError =
  | AuthErrorCode
  | "invalid_input"
  | "date_order"
  | "too_long"
  | "no_intervals"
  | "overlap_intervals"
  | "overlap"
  | "not_found";
type Result = ActionResult<undefined, OverrideActionError>;

const FIELD_ERRORS = ["date_order", "too_long", "no_intervals", "overlap_intervals"] as const;

export async function createOverrideAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await requireClinicAccess("clinic_owner", { write: true });
  } catch (e) {
    return authFailure(e);
  }
  let intervals: unknown = [];
  try {
    intervals = JSON.parse(String(form.get("intervals") ?? "[]"));
  } catch {
    return { ok: false, error: "invalid_input" };
  }
  const parsed = overrideSchema.safeParse({
    staffId: form.get("staffId") ?? "",
    type: form.get("type"),
    startDate: form.get("startDate"),
    endDate: form.get("endDate"),
    labelEn: form.get("labelEn") ?? "",
    labelAr: form.get("labelAr") ?? "",
    intervals,
  });
  if (!parsed.success) {
    const known = parsed.error.issues.map((i) => i.message).find((m) => (FIELD_ERRORS as readonly string[]).includes(m));
    return { ok: false, error: (known as (typeof FIELD_ERRORS)[number] | undefined) ?? "invalid_input" };
  }
  const result = await createOverride(ctx, parsed.data);
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.reason };
}

export async function deleteOverrideAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await requireClinicAccess("clinic_owner", { write: true });
  } catch (e) {
    return authFailure(e);
  }
  const id = uuidSchema.safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  return (await deleteOverride(ctx, id.data)) ? { ok: true, data: undefined } : { ok: false, error: "not_found" };
}
