import type { Database } from "../client";

export type ClinicRole = "clinic_owner" | "clinic_staff";
export type ClinicStatus = "trial" | "active" | "suspended";

/**
 * The only way into clinic data. Built by requireClinicAccess() from the
 * session's membership row — NEVER from a URL, form field or request body.
 * Every clinic-scoped repository function takes it as its first argument, so a
 * query without a clinic filter is a type error, not a code-review catch.
 */
export type ClinicContext = {
  readonly db: Database;
  readonly clinicId: string;
  readonly userId: string;
  readonly role: ClinicRole;
  readonly clinicStatus: ClinicStatus;
};

/** Platform admin: clinic records only, never patient data (scope decision). */
export type AdminContext = {
  readonly db: Database;
  readonly userId: string;
};
