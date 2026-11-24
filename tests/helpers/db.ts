import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Database } from "@/server/db/client";

/**
 * A real Postgres (PGlite, in memory) with the project's actual migrations
 * applied — including the hand-written exclusion constraints, which need the
 * btree_gist extension loaded. Not a mock: constraints, unique indexes and
 * transactions behave as on Neon. The Phase 5 concurrency test still needs a
 * real Neon branch, because PGlite is single-connection.
 */
export async function createTestDb() {
  const client = new PGlite({ extensions: { btree_gist } });
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: "db/migrations" });

  // The query API is identical; only the driver's result-metadata types differ.
  // Typing it as the app's Database lets tests build real ClinicContexts.
  const db = pglite as unknown as Database;
  return { client, db };
}
