// Prints the tables and applied migrations in the database from .env.local.
// Usage: npm run db:check
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
});

await client.connect();
try {
  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  const migrations = await client.query(
    "select count(*)::int as n from drizzle.__drizzle_migrations",
  );
  console.log(`Tables (${tables.rowCount}): ${tables.rows.map((r) => r.table_name).join(", ")}`);
  console.log(`Migrations applied: ${migrations.rows[0].n}`);
} finally {
  await client.end();
}
