"use server";

import type { AuthErrorCode } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import { setBookingEnabled, updateBookingRules, updateClinicProfile } from "@/server/db/repositories/clinics";
import { getSetupChecklist } from "@/server/services/onboarding";
import { bookingRulesSchema, clinicProfileSchema } from "@/lib/validation/clinic-settings";
import { type ActionResult, authFailure } from "./result";

export type SettingsActionError = AuthErrorCode | "invalid_input" | "phone" | "maps_url" | "not_ready";
type Result = ActionResult<undefined, SettingsActionError>;

const ownerWrite = () => requireClinicAccess("clinic_owner", { write: true });

export async function saveProfileAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await ownerWrite();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = clinicProfileSchema.safeParse(Object.fromEntries(
    ["nameEn", "nameAr", "addressEn", "addressAr", "phone", "mapsUrl", "timezone"].map((k) => [k, form.get(k) ?? ""]),
  ));
  if (!parsed.success) {
    const m = parsed.error.issues.map((i) => i.message);
    return { ok: false, error: m.includes("phone") ? "phone" : m.includes("maps_url") ? "maps_url" : "invalid_input" };
  }
  await updateClinicProfile(ctx, parsed.data);
  return { ok: true, data: undefined };
}

export async function saveBookingRulesAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await ownerWrite();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = bookingRulesSchema.safeParse(Object.fromEntries(
    ["bufferMinutes", "minLeadMinutes", "maxHorizonDays", "changeCutoffMinutes", "slotGranularityMinutes"].map((k) => [k, form.get(k)]),
  ));
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  await updateBookingRules(ctx, parsed.data);
  return { ok: true, data: undefined };
}

export async function setBookingEnabledAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await ownerWrite();
  } catch (e) {
    return authFailure(e);
  }
  const enable = form.get("enabled") === "true";
  if (enable) {
    // Enforced here, not just by a disabled button: the checklist is the rule.
    const { readyToBook } = await getSetupChecklist(ctx);
    if (!readyToBook) return { ok: false, error: "not_ready" };
  }
  await setBookingEnabled(ctx, enable);
  return { ok: true, data: undefined };
}
