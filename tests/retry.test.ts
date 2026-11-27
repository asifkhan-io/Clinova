/**
 * Finding F4: a deadlock between two racing bookings must be retried, so the
 * loser hears "slot taken" instead of getting a server error.
 */
import { describe, expect, it } from "vitest";
import { isDeadlock, retryOnDeadlock } from "@/server/db/retry";

const deadlock = Object.assign(new Error("Failed query"), { cause: { code: "40P01" } });
const overlap = Object.assign(new Error("Failed query"), { cause: { code: "23P01" } });

describe("retryOnDeadlock", () => {
  it("recognises a deadlock directly or wrapped by the driver", () => {
    expect(isDeadlock(deadlock)).toBe(true);
    expect(isDeadlock({ code: "40P01" })).toBe(true);
    expect(isDeadlock(overlap)).toBe(false);
  });

  it("retries a deadlock, then hands the clean result back", async () => {
    let calls = 0;
    const result = await retryOnDeadlock(async () => {
      if (++calls === 1) throw deadlock;
      return "slot_taken";
    });
    expect(result).toBe("slot_taken");
    expect(calls).toBe(2);
  });

  it("never retries other errors: they reach the caller's own handling at once", async () => {
    let calls = 0;
    await expect(retryOnDeadlock(async () => { calls++; throw overlap; })).rejects.toBe(overlap);
    expect(calls).toBe(1);
  });

  it("gives up after three attempts", async () => {
    let calls = 0;
    await expect(retryOnDeadlock(async () => { calls++; throw deadlock; })).rejects.toBe(deadlock);
    expect(calls).toBe(3);
  });
});
