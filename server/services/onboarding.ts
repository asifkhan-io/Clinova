import "server-only";
import { getOwnClinic, getSetupFacts } from "../db/repositories/clinics";
import type { ClinicContext } from "../db/repositories/context";

export type SetupStepKey =
  | "profile"
  | "services"
  | "dentists"
  | "dentistServices"
  | "hours"
  | "bookingOn";

export type SetupStep = { key: SetupStepKey; done: boolean; href: string; required: boolean };

/**
 * The derived onboarding checklist (architecture §5, Phase 3). "Required" steps
 * gate turning online booking on: a clinic page with no bookable dentist is a
 * page that silently shows no times, which patients read as "fully booked".
 */
export async function getSetupChecklist(ctx: ClinicContext) {
  const [clinic, facts] = await Promise.all([getOwnClinic(ctx), getSetupFacts(ctx)]);
  if (!clinic) throw new Error("clinic not found for context");

  const steps: SetupStep[] = [
    { key: "profile", required: false, href: "/dashboard/settings", done: Boolean(clinic.phone && (clinic.addressEn || clinic.addressAr)) },
    { key: "services", required: true, href: "/dashboard/services", done: facts.activeServices > 0 },
    { key: "dentists", required: true, href: "/dashboard/dentists", done: facts.activeDentists > 0 },
    {
      key: "dentistServices",
      required: true,
      href: "/dashboard/dentists",
      done: facts.activeDentists > 0 && facts.dentistsWithoutServices === 0,
    },
    {
      key: "hours",
      required: true,
      href: "/dashboard/hours",
      done: facts.activeDentists > 0 && facts.dentistsWithoutHours === 0,
    },
    { key: "bookingOn", required: false, href: "/dashboard/settings", done: clinic.bookingEnabled },
  ];
  const readyToBook = steps.filter((s) => s.required).every((s) => s.done);
  return { steps, readyToBook, bookingEnabled: clinic.bookingEnabled, facts };
}
