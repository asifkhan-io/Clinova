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

const pool = new Pool({
  connectionString: withStrictSsl(process.env.DATABASE_URL),
  max: 5, // per function instance; PgBouncer multiplexes behind it
});
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
export type Database = typeof db;
