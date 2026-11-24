import "server-only";
import type { Locale } from "next-intl";
import { redirect } from "@/lib/i18n/navigation";
import type { ClinicContext, ClinicRole } from "../db/repositories/context";
import { AuthError } from "./errors";
import { requireClinicAccess } from "./guards";

/**
 * requireClinicAccess() for PAGES: turns an authorization failure into a
 * navigation instead of a 404. Signed out → sign-in; signed in but not allowed
 * here (an admin with no clinic, staff on an owner page) → the dashboard, which
 * shows each account what it can use. Any other error still surfaces.
 */
export async function requireClinicPage(locale: Locale, minRole: ClinicRole = "clinic_staff"): Promise<ClinicContext> {
  try {
    return await requireClinicAccess(minRole);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    redirect({ href: e.code === "unauthenticated" ? "/sign-in" : "/dashboard", locale });
    throw e; // unreachable: redirect() throws
  }
}
