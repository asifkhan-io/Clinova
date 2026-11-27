import { Pool, type PoolClient } from "pg";

/**
 * Finding F3, seen in production on 2026-11-27: Neon suspends an idle compute,
 * and the first visitor after that waits while it wakes. Sometimes opening the
 * connection takes longer than the pool allows, and Better Auth's session
 * lookup failed with "Connection terminated due to connection timeout" or
 * Neon's "Authentication timed out" (08P01). The owner saw a server error just
 * for opening the dashboard.
 *
 * Retrying is safe HERE and only here: these errors happen while a connection
 * is being opened, before any SQL is sent, so nothing can run twice. A query
 * that fails after it was sent is never retried by this code.
 */

/** Codes that mean "the server isn't ready yet", not "you're not allowed in". */
const RETRYABLE_CODES = new Set([
  "08P01", // Neon proxy: "Authentication timed out" while the compute wakes
  "08001", // unable to establish connection
  "08006", // connection failure
  "57P03", // the database system is starting up
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
]);

export function isRetryableConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  // pg's own wording for a connect that ran out of time, or a socket that died mid-handshake.
  return /timeout exceeded when trying to connect|Connection terminated due to connection timeout|Connection terminated unexpectedly/.test(error.message);
}

export async function connectWithRetry<T>(
  connect: () => Promise<T>,
  { attempts = 2, delayMs = 300 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= attempts || !isRetryableConnectError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

type ConnectCallback = (err: Error | undefined, client: PoolClient | undefined, done: (release?: boolean | Error) => void) => void;

/**
 * A pg Pool whose connect() tries once more when the database was still
 * waking. pool.query() and drizzle's transactions both check clients out
 * through connect(), so both are covered.
 */
export class ResilientPool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const opened = connectWithRetry(() => super.connect());
    if (!callback) return opened;
    opened.then(
      (client) => callback(undefined, client, (release) => client.release(release)),
      (error: Error) => callback(error, undefined, () => {}),
    );
  }
}
