"use server";

import { bookingSchema } from "@/lib/validation/booking";
import { findPublicClinic } from "@/server/db/repositories/public-clinic";
import { createPublicBooking } from "@/server/services/booking";
import type { ActionResult } from "./result";

export type PublicBookingError =
  | "invalid_input"
  | "phone"
  | "consent"
  | "not_found"
  | "booking_closed"
  | "slot_unavailable"
  | "slot_taken";
export type PublicBookingData = { token: string; startMs: number; staffId: string };
type Result = ActionResult<PublicBookingData, PublicBookingError>;

/**
 * Public, unauthenticated: the clinic comes from the slug, everything else is
 * validated and re-derived server-side. Rate limiting arrives in Phase 8 (ARCH2).
 */
export async function publicBookAction(_prev: Result | null, form: FormData): Promise<Result> {
  const found = await findPublicClinic(String(form.get("slug") ?? ""));
  if (!found) return { ok: false, error: "not_found" };

  const parsed = bookingSchema.safeParse({
    serviceId: form.get("serviceId"),
    staffId: form.get("staffId"),
    startMs: form.get("startMs"),
    fullName: form.get("fullName"),
    phone: form.get("phone") ?? "",
    email: form.get("email") ?? "",
    consent: form.get("consent") === "on",
  });
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path[0]);
    if (paths.includes("consent")) return { ok: false, error: "consent" };
    if (paths.includes("phone")) return { ok: false, error: "phone" };
    return { ok: false, error: "invalid_input" };
  }

  const { phone, ...rest } = parsed.data;
  const result = await createPublicBooking(found.scope, { ...rest, phoneE164: phone }, Date.now());
  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true, data: { token: result.token, startMs: result.startMs, staffId: result.staffId } };
}
