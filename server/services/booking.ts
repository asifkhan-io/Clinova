import "server-only";
import { insertOnlineBooking, loadBusy } from "../db/repositories/appointments";
import { type ClinicScope, loadClinicRules, loadServiceProviders } from "../db/repositories/schedule";
import { getSlotsForDate } from "./availability";
import { addDays, localDate, localToUtc } from "./availability/time";
import { newToken } from "./tokens";
import { CONSENT_POLICY_VERSION, type BookingInput } from "@/lib/validation/booking";

export type BookingFailure = "booking_closed" | "slot_unavailable" | "slot_taken";
export type BookingResult =
  | { ok: true; token: string; appointmentId: string; staffId: string; startMs: number; endMs: number }
  | { ok: false; reason: BookingFailure };

/** Existing bookings for one clinic-local day, padded so buffers at the edges count. */
async function busyForDay(scope: ClinicScope, date: string, timeZone: string, bufferMinutes: number) {
  const from = (localToUtc(date, 0, timeZone) ?? 0) - bufferMinutes * 60_000;
  const to = (localToUtc(addDays(date, 1), 0, timeZone) ?? 0) + bufferMinutes * 60_000;
  return { from, to };
}

/**
 * Existing bookings for every dentist who performs a service, on one local
 * date. Shared by the public availability endpoint and createPublicBooking, so
 * the grid a patient sees and the check at booking time can't disagree.
 */
export async function loadBusyForDate(scope: ClinicScope, serviceId: string, date: string, excludeAppointmentId?: string) {
  const rules = await loadClinicRules(scope);
  const providers = await loadServiceProviders(scope, serviceId);
  if (!rules || !providers) return new Map<string, { startMs: number; endMs: number }[]>();
  const { from, to } = await busyForDay(scope, date, rules.timezone, rules.bufferMinutes);
  return loadBusy(scope, providers.staffIds, from, to, excludeAppointmentId);
}

/**
 * The money path (Phase 5). The client's chosen slot is a REQUEST, never a fact:
 * availability is recomputed here from the database, and the exclusion
 * constraint has the last word if two patients race for the same slot.
 */
export async function createPublicBooking(
  scope: ClinicScope,
  input: Omit<BookingInput, "email" | "consent" | "phone"> & { phoneE164: string },
  nowMs: number,
): Promise<BookingResult> {
  const rules = await loadClinicRules(scope);
  // Both switches, in this order (D4): our commercial one, then the clinic's own.
  if (!rules || rules.status === "suspended" || !rules.bookingEnabled) return { ok: false, reason: "booking_closed" };

  const date = localDate(input.startMs, rules.timezone);
  const { from, to } = await busyForDay(scope, date, rules.timezone, rules.bufferMinutes);
  const providers = await loadServiceProviders(scope, input.serviceId);
  if (!providers) return { ok: false, reason: "slot_unavailable" };
  // Every provider's bookings that day: needed for "any dentist" and for D9.
  const busy = await loadBusy(scope, providers.staffIds, from, to);

  const free = (await getSlotsForDate(scope, { serviceId: input.serviceId, date, nowMs, busy })).filter(
    (s) => s.startMs === input.startMs && (input.staffId === "any" || s.staffId === input.staffId),
  );
  if (free.length === 0) return { ok: false, reason: "slot_unavailable" };

  // D9: "any available" goes to the dentist with the fewest bookings that day,
  // so one dentist isn't loaded first every morning. Ties: a stable order.
  const candidates = [...free].sort(
    (a, b) => (busy.get(a.staffId)?.length ?? 0) - (busy.get(b.staffId)?.length ?? 0) || a.staffId.localeCompare(b.staffId),
  );

  // Patients booking "any" at the same instant all see the same first choice. If
  // someone else just took that dentist, try the next free one instead of
  // refusing a slot that is still open (finding F1, Phase 8e). A named dentist
  // has exactly one candidate, so it behaves as before. The exclusion
  // constraint still decides each attempt; this loop only picks who to try.
  const { token, hash } = newToken();
  for (const chosen of candidates) {
    const inserted = await insertOnlineBooking(scope, {
      staffId: chosen.staffId,
      serviceId: input.serviceId,
      startMs: chosen.startMs,
      endMs: chosen.endMs,
      fullName: input.fullName,
      phoneE164: input.phoneE164,
      consentPolicyVersion: CONSENT_POLICY_VERSION,
      accessTokenHash: hash,
    });
    // The raw token goes into the patient's link once and is never stored.
    if (inserted.ok) return { ok: true, token, appointmentId: inserted.appointmentId, staffId: chosen.staffId, startMs: chosen.startMs, endMs: chosen.endMs };
  }
  return { ok: false, reason: "slot_taken" };
}
