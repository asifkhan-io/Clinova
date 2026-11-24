import "server-only";
import {
  type ClinicScope,
  loadClinicRules,
  loadSchedules,
  loadServiceProviders,
} from "../../db/repositories/schedule";
import { type Busy, generateSlots } from "./generate-slots";
import { resolveDay } from "./resolve-intervals";
import { addDays, dayOfWeek, localDate } from "./time";

export type Slot = { staffId: string; startMs: number; endMs: number };

/**
 * Bookable slots for one service on one local date, per dentist.
 *
 * Request-time by design (ARCH8): never cache this. A stale slot grid is a
 * double-booking funnel. `busy` supplies existing appointments per dentist; the
 * appointments table arrives in Phase 5, until then callers pass none.
 */
export async function getSlotsForDate(
  scope: ClinicScope,
  input: {
    serviceId: string;
    date: string; // the clinic's local date, YYYY-MM-DD
    nowMs: number;
    staffId?: string; // omit for "any available dentist"
    busy?: Map<string, Busy[]>;
    /**
     * Staff-only relaxations (never for patients): staff may book a walk-in for
     * right now (no minimum notice) and squeeze appointments back to back (no
     * buffer, D13). Working hours, closures and the no-overlap rule still apply.
     */
    staffOverride?: boolean;
  },
): Promise<Slot[]> {
  const loaded = await loadClinicRules(scope);
  if (!loaded) return [];
  const rules = input.staffOverride ? { ...loaded, minLeadMinutes: 0, bufferMinutes: 0 } : loaded;
  const providers = await loadServiceProviders(scope, input.serviceId);
  if (!providers) return [];

  const staffIds = input.staffId
    ? providers.staffIds.filter((id) => id === input.staffId)
    : providers.staffIds;
  if (staffIds.length === 0) return [];

  // Skip work outright for dates that can never have a slot.
  const today = localDate(input.nowMs, rules.timezone);
  if (input.date < today || input.date > addDays(today, rules.maxHorizonDays)) return [];

  const { weekly, overrides } = await loadSchedules(scope, staffIds, input.date, input.date);
  const minutes = providers.service.durationMinutes;
  const dow = dayOfWeek(input.date);

  return staffIds
    .flatMap((staffId) => {
      const day = resolveDay({ date: input.date, dayOfWeek: dow, staffId, weekly: weekly.get(staffId) ?? [], overrides });
      return generateSlots({
        date: input.date,
        timeZone: rules.timezone,
        intervals: day.intervals,
        serviceMinutes: minutes,
        rules,
        busy: input.busy?.get(staffId) ?? [],
        nowMs: input.nowMs,
      }).map((slot) => ({ staffId, ...slot }));
    })
    .sort((a, b) => a.startMs - b.startMs);
}
