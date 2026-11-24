import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

/**
 * A real Postgres (PGlite, in memory) with the project's actual migrations
 * applied. Not a mock: constraints, unique indexes and transactions behave as
 * on Neon. The Phase 5 concurrency test still needs a real Neon branch, because
 * PGlite is single-connection.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  return { client, db };
}
