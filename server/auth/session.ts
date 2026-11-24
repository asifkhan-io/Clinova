import "server-only";
import { headers } from "next/headers";
import { auth } from "./config";

/**
 * Reads the current session. Request-time by nature (it reads cookies), so under
 * cacheComponents any component calling it must sit inside a <Suspense> boundary.
 *
 * This answers "who is signed in" only. "May they touch this clinic's data" is
 * requireClinicAccess() in guards.ts (step 2c) — never use this alone for that.
 */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
