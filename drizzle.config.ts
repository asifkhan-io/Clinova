import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside the Next.js runtime, so it does not get Next's
// automatic .env.local loading. Load it explicitly, before defineConfig reads
// process.env below.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  // Migrations go direct, never through the pooler: the hand-written
  // 0002_constraints.sql needs CREATE EXTENSION and exclusion constraints.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
  strict: true,
  verbose: true,
});
