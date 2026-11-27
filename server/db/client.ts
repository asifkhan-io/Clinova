import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema";

/**
 * The ONLY place a database connection is created (architecture §3.1).
 *
 * node-postgres over TCP to Neon's pooled endpoint (PgBouncer), not the Neon
 * WebSocket Pool: on Vercel Node functions a module-level WebSocket pool can
 * outlive its connection and fail with a bare ErrorEvent, which is what
 * production showed. attachDatabasePool lets Vercel's Fluid compute close idle
 * clients before an instance is suspended. Transactions work as before.
 * Supersedes ARCH3.
 */
/**
 * Pin certificate verification explicitly. The Vercel-managed DATABASE_URL says
 * sslmode=require, which pg 8 treats as verify-full but pg 9 will downgrade to
 * "encrypt without checking the certificate". Asking for verify-full keeps
 * today's (strict) behaviour and silences pg's warning on every connection.
 */
function withStrictSsl(url: string | undefined) {
  if (!url) return url;
  const u = new URL(url);
  u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}

/**
 * Every wait has a ceiling (Phase 8). Without these, a connection that stalls
 * — a suspended Neon compute, a dropped TCP session, a lock held by another
 * transaction — hangs the query, which hangs the route, which leaves the
 * patient's booking page spinning on "finding free times" with no error and no
 * retry. That was observed in production on 2026-11-25.
 *
 * The limits are generous on purpose: a cold Neon compute legitimately needs a
 * few seconds to wake, so these catch a stall, not a slow start. Migrations are
 * unaffected — drizzle-kit connects with DATABASE_URL_UNPOOLED, not this pool.
 */
const pool = new Pool({
  // APP_DATABASE_URL is the non-owner `clinova_app` role (Phase 9b): it can't
  // rewrite or erase the audit log. DATABASE_URL (the owner, managed by the
  // Vercel–Neon integration) is only the fallback until that variable is set;
  // migrations and scripts always use DATABASE_URL_UNPOOLED, the owner.
  connectionString: withStrictSsl(process.env.APP_DATABASE_URL || process.env.DATABASE_URL),
  max: 5, // per function instance; PgBouncer multiplexes behind it
  // Waiting for a usable connection.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  // Server-side cancel, then the client's own belt-and-braces deadline.
  statement_timeout: 10_000,
  query_timeout: 10_000,
  // A transaction abandoned mid-flight holds its FOR UPDATE locks until this
  // fires, so every other request for that appointment would queue behind it.
  idle_in_transaction_session_timeout: 15_000,
});
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
export type Database = typeof db;
