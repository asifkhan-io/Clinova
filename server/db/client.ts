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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5, // per function instance; PgBouncer multiplexes behind it
});
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
export type Database = typeof db;
