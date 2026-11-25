import { lt, sql } from "drizzle-orm";
import { rateLimits } from "../../../db/schema";
import type { Database } from "../client";

/**
 * The counter store behind the rate limiter (ARCH2). Policy — which buckets
 * exist, how big a window is, what the limit is — lives in
 * server/services/rate-limit.ts; this file only counts.
 *
 * No ClinicContext: a limit protects the platform from one caller, so these
 * rows are not tenant-owned and there is nothing to scope by clinic.
 */

/**
 * Add one to this caller's count for this window and return the new total.
 * A single statement, so two requests arriving together cannot both read the
 * same count and each decide they are under the limit.
 */
export async function countRequest(
  database: Database,
  row: { bucket: string; identifierHash: string; windowStart: Date },
): Promise<number | null> {
  const [updated] = await database
    .insert(rateLimits)
    .values({ ...row, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.identifierHash, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return updated?.count ?? null;
}

/** Drop windows old enough that they can no longer refuse anything. */
export async function deleteWindowsBefore(database: Database, cutoff: Date): Promise<void> {
  await database.delete(rateLimits).where(lt(rateLimits.windowStart, cutoff));
}
