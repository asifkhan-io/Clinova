import "server-only";
import { createHash } from "node:crypto";
import { type Database, db } from "../db/client";
import { countRequest, deleteWindowsBefore } from "../db/repositories/rate-limits";

/**
 * Rate limiting for the public, unauthenticated surface (ARCH2).
 *
 * Fixed windows, one upsert per request, in the database we already run. The
 * count is per (bucket, caller, window); a window boundary lets a determined
 * caller burst twice the limit for one instant, which is irrelevant when the
 * point is to stop floods and scripted abuse.
 *
 * Why two keys on the booking path: Saudi mobile carriers put many subscribers
 * behind few public addresses, so an address-keyed limit alone would eventually
 * refuse a whole neighbourhood of real patients. The address limit is generous
 * and only catches crude flooding; the phone-number limit is the one that
 * actually stops someone filling a clinic's day with junk bookings.
 */

export const LIMITS = {
  /** Slot grid for a clinic page. A patient clicking through 14 days is normal. */
  "public.availability": { windowSeconds: 60, max: 60 },
  /** Completed bookings from one address. */
  "public.book.ip": { windowSeconds: 3_600, max: 5 },
  /** Completed bookings for one phone number. The real abuse limit. */
  "public.book.phone": { windowSeconds: 86_400, max: 10 },
  /** Slot grid on a patient's own private link. */
  "token.availability": { windowSeconds: 60, max: 30 },
  /** Reschedule and cancel on a patient's own private link. */
  "token.change": { windowSeconds: 3_600, max: 10 },
} as const;

export type RateBucket = keyof typeof LIMITS;

/** Expired windows are dropped opportunistically, on roughly 1 request in 100. */
const SWEEP_PROBABILITY = 0.01;
const SWEEP_AGE_MS = 24 * 3_600_000;

function windowStartFor(bucket: RateBucket, nowMs: number): Date {
  const windowMs = LIMITS[bucket].windowSeconds * 1_000;
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

/** The bucket is part of the hash, so one caller cannot be correlated across buckets. */
function identifierHash(bucket: RateBucket, identifier: string): string {
  return createHash("sha256").update(`${bucket}:${identifier}`).digest("hex");
}

/**
 * Count this request against `identifier` and say whether it may proceed.
 *
 * Fails OPEN. If the counter itself cannot be read or written, the request is
 * allowed: refusing to take a booking because the limiter is unwell would cost
 * a clinic real money, and anything serious enough to break this upsert will
 * break the booking's own transaction a moment later anyway.
 */
export async function consumeRateLimit(
  bucket: RateBucket,
  identifier: string,
  nowMs: number = Date.now(),
  database: Database = db,
): Promise<boolean> {
  try {
    const count = await countRequest(database, {
      bucket,
      identifierHash: identifierHash(bucket, identifier),
      windowStart: windowStartFor(bucket, nowMs),
    });
    if (count === null) return true;
    if (Math.random() < SWEEP_PROBABILITY) await sweepRateLimits(nowMs, database);
    return count <= LIMITS[bucket].max;
  } catch {
    return true;
  }
}

/** Housekeeping. Safe to call at any time; a failure costs disk, not correctness. */
export async function sweepRateLimits(nowMs: number = Date.now(), database: Database = db): Promise<void> {
  try {
    await deleteWindowsBefore(database, new Date(nowMs - SWEEP_AGE_MS));
  } catch {
    // Deliberately swallowed: the sweep is an optimisation, never a gate.
  }
}

/**
 * The caller's address, from the proxy header Vercel sets.
 *
 * Returns null when no address can be determined, and callers then skip the
 * limit rather than counting everyone into one shared bucket — a missing header
 * must not be able to lock every patient out at once.
 */
export function callerAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = headers.get("x-real-ip")?.trim();
  return real && real.length > 0 ? real : null;
}
