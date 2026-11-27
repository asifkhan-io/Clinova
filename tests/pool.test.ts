/**
 * Finding F3: a Neon compute waking from sleep made the first connection time
 * out, and the dashboard showed a server error. ResilientPool retries OPENING
 * a connection once; nothing that already reached the database is retried.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { ResilientPool, connectWithRetry, isRetryableConnectError } from "@/server/db/pool";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });
const timeout = new Error("Connection terminated due to connection timeout");
const waking = withCode("Authentication timed out", "08P01");
const badPassword = withCode('password authentication failed for user "x"', "28P01");
const queryError = withCode('relation "nope" does not exist', "42P01");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isRetryableConnectError", () => {
  it("retries a database that is still waking or a connect that ran out of time", () => {
    expect(isRetryableConnectError(timeout)).toBe(true);
    expect(isRetryableConnectError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isRetryableConnectError(waking)).toBe(true);
    expect(isRetryableConnectError(withCode("the database system is starting up", "57P03"))).toBe(true);
    expect(isRetryableConnectError(withCode("read ECONNRESET", "ECONNRESET"))).toBe(true);
  });

  it("never retries a wrong password, a SQL error, or something that isn't an error", () => {
    expect(isRetryableConnectError(badPassword)).toBe(false);
    expect(isRetryableConnectError(queryError)).toBe(false);
    expect(isRetryableConnectError("timeout")).toBe(false);
    expect(isRetryableConnectError(null)).toBe(false);
  });
});

describe("connectWithRetry", () => {
  it("tries once more after a waking database, then succeeds", async () => {
    let calls = 0;
    const result = await connectWithRetry(async () => {
      if (++calls === 1) throw waking;
      return "connected";
    }, { delayMs: 0 });
    expect(result).toBe("connected");
    expect(calls).toBe(2);
  });

  it("gives up after the second attempt and reports the real error", async () => {
    let calls = 0;
    await expect(connectWithRetry(async () => { calls++; throw timeout; }, { delayMs: 0 })).rejects.toBe(timeout);
    expect(calls).toBe(2);
  });

  it("fails at once on errors a retry can't fix", async () => {
    let calls = 0;
    await expect(connectWithRetry(async () => { calls++; throw badPassword; }, { delayMs: 0 })).rejects.toBe(badPassword);
    expect(calls).toBe(1);
  });
});

describe("ResilientPool", () => {
  // A stand-in for a checked-out client: just enough for pg-pool's query() path.
  const fakeClient = () => {
    const client = {
      query: vi.fn((_text: string, _values: unknown, cb: (err: Error | null, res: { rows: number[] }) => void) => cb(null, { rows: [1] })),
      release: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
    };
    return client as unknown as PoolClient & { query: typeof client.query; release: typeof client.release };
  };

  it("pool.query() survives one waking-database failure (the path Better Auth and drizzle use)", async () => {
    const client = fakeClient();
    const base = vi.spyOn(Pool.prototype, "connect").mockRejectedValueOnce(waking).mockResolvedValueOnce(client as never);
    const pool = new ResilientPool();
    const res = await pool.query("select 1");
    expect(res.rows).toEqual([1]);
    expect(base).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("the promise form (drizzle transactions) retries the same way", async () => {
    const client = fakeClient();
    const base = vi.spyOn(Pool.prototype, "connect").mockRejectedValueOnce(timeout).mockResolvedValueOnce(client as never);
    await expect(new ResilientPool().connect()).resolves.toBe(client);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("a query error is NOT retried: the SQL reached the database once and only once", async () => {
    const client = fakeClient();
    client.query.mockImplementationOnce((_t, _v, cb) => cb(queryError as never, undefined as never));
    const base = vi.spyOn(Pool.prototype, "connect").mockResolvedValue(client as never);
    await expect(new ResilientPool().query("select * from nope")).rejects.toBe(queryError);
    expect(base).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
