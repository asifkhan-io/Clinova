"use server";

import { headers } from "next/headers";
import { countryOf } from "@/lib/countries";
import { bookingSchemaFor } from "@/lib/validation/booking";
import { findPublicClinic } from "@/server/db/repositories/public-clinic";
import { createPublicBooking } from "@/server/services/booking";
import { notifyPublicBooking } from "@/server/services/notifications";
import { callerAddress, consumeRateLimit } from "@/server/services/rate-limit";
import type { ActionResult } from "./result";

export type PublicBookingError =
  | "invalid_input"
  | "phone"
  | "consent"
  | "not_found"
  | "booking_closed"
  | "slot_unavailable"
  | "slot_taken"
  | "rate_limited";
export type PublicBookingData = { token: string; startMs: number; staffId: string };
type Result = ActionResult<PublicBookingData, PublicBookingError>;

/**
 * Public, unauthenticated: the clinic comes from the slug, everything else is
 * validated and re-derived server-side.
 *
 * Two limits (ARCH2). The address limit runs first and is deliberately loose —
 * Saudi mobile carriers share few public addresses between many subscribers, so
 * a tight one would refuse real patients. The phone limit runs once the form is
 * valid and is the one that actually stops a clinic's day being filled with
 * junk: a booking needs a phone number, and a real patient has one.
 */
export async function publicBookAction(_prev: Result | null, form: FormData): Promise<Result> {
  const address = callerAddress(await headers());
  if (address && !(await consumeRateLimit("public.book.ip", address))) {
    return { ok: false, error: "rate_limited" };
  }

  const found = await findPublicClinic(String(form.get("slug") ?? ""));
  if (!found) return { ok: false, error: "not_found" };

  const parsed = bookingSchemaFor(countryOf(found.clinic.country)).safeParse({
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
  if (!(await consumeRateLimit("public.book.phone", phone))) {
    return { ok: false, error: "rate_limited" };
  }

  const result = await createPublicBooking(found.scope, { ...rest, phoneE164: phone }, Date.now());
  if (!result.ok) return { ok: false, error: result.reason };

  // Sent after the response, never blocking or failing the booking (Phase 8d).
  // The email address is used for this one message and stored nowhere.
  notifyPublicBooking({
    appointmentId: result.appointmentId,
    token: result.token,
    locale: form.get("locale") === "ar" ? "ar" : "en",
    patientEmail: rest.email || undefined,
  });
  return { ok: true, data: { token: result.token, startMs: result.startMs, staffId: result.staffId } };
}
