/**
 * The public surface has no password in front of it, so the limiter is the only
 * thing between a script and the booking table. It must count correctly, keep
 * callers apart, store no raw address or phone number, and never refuse a real
 * booking because it is itself broken.
 */
import { describe, expect, it, vi } from "vitest";
import { rateLimits } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const testDb = await createTestDb();
vi.mock("@/server/db/client", () => ({ db: testDb.db }));

const { LIMITS, callerAddress, consumeRateLimit, sweepRateLimits } =
  await import("@/server/services/rate-limit");

const db = testDb.db;
const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);

describe("fixed-window counting", () => {
  it("allows exactly the limit, then refuses", async () => {
    const max = LIMITS["public.book.ip"].max;
    const results: boolean[] = [];
    for (let i = 0; i < max + 2; i++) {
      results.push(await consumeRateLimit("public.book.ip", "1.1.1.1", T0, db));
    }
    expect(results.slice(0, max)).toEqual(Array(max).fill(true));
    expect(results.slice(max)).toEqual([false, false]);
  });

  it("starts a fresh count in the next window", async () => {
    const bucket = "public.availability" as const;
    const windowMs = LIMITS[bucket].windowSeconds * 1_000;
    for (let i = 0; i < LIMITS[bucket].max; i++) {
      await consumeRateLimit(bucket, "2.2.2.2", T0, db);
    }
    expect(await consumeRateLimit(bucket, "2.2.2.2", T0, db)).toBe(false);
    expect(await consumeRateLimit(bucket, "2.2.2.2", T0 + windowMs, db)).toBe(true);
  });

  it("counts each caller separately", async () => {
    const max = LIMITS["public.book.ip"].max;
    for (let i = 0; i < max + 1; i++) {
      await consumeRateLimit("public.book.ip", "3.3.3.3", T0, db);
    }
    expect(await consumeRateLimit("public.book.ip", "3.3.3.3", T0, db)).toBe(false);
    expect(await consumeRateLimit("public.book.ip", "4.4.4.4", T0, db)).toBe(true);
  });

  it("keeps buckets apart, so one caller's reads cannot exhaust their bookings", async () => {
    const reads = LIMITS["public.availability"].max;
    for (let i = 0; i < reads + 1; i++) {
      await consumeRateLimit("public.availability", "5.5.5.5", T0, db);
    }
    expect(await consumeRateLimit("public.availability", "5.5.5.5", T0, db)).toBe(false);
    expect(await consumeRateLimit("public.book.ip", "5.5.5.5", T0, db)).toBe(true);
  });
});

describe("what reaches the database", () => {
  it("stores no raw address or phone number", async () => {
    await consumeRateLimit("public.book.ip", "203.0.113.9", T0, db);
    await consumeRateLimit("public.book.phone", "+966500000001", T0, db);
    const rows = await db.select({ identifierHash: rateLimits.identifierHash }).from(rateLimits);
    const stored = rows.map((r) => r.identifierHash);
    expect(stored).not.toContain("203.0.113.9");
    expect(stored).not.toContain("+966500000001");
    for (const hash of stored) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sweeps windows that can no longer refuse anything, and keeps the live one", async () => {
    const old = T0 - 48 * 3_600_000;
    await consumeRateLimit("public.book.ip", "6.6.6.6", old, db);
    await consumeRateLimit("public.book.ip", "6.6.6.6", T0, db);
    await sweepRateLimits(T0, db);
    const rows = await db.select({ windowStart: rateLimits.windowStart }).from(rateLimits);
    const windows = rows.map((r) => r.windowStart.getTime());
    expect(windows).not.toContain(Math.floor(old / 3_600_000) * 3_600_000);
    expect(windows.some((w) => w >= T0 - 3_600_000)).toBe(true);
  });
});

describe("failing open", () => {
  it("allows the request when the counter itself is broken", async () => {
    const broken = {
      insert: () => {
        throw new Error("connection terminated");
      },
    } as never;
    expect(await consumeRateLimit("public.book.ip", "7.7.7.7", T0, broken)).toBe(true);
  });
});

describe("caller address", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2" });
    expect(callerAddress(h)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip", () => {
    expect(callerAddress(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
  });

  it("returns null rather than lumping unknown callers together", () => {
    expect(callerAddress(new Headers())).toBeNull();
    expect(callerAddress(new Headers({ "x-forwarded-for": "   " }))).toBeNull();
  });
});
