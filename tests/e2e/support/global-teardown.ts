import { existsSync, readFileSync, rmSync } from "node:fs";
import { cleanup, connect, type Seed } from "./seed";
import { SEED_FILE } from "./paths";

/** Deletes everything this run created. Set E2E_KEEP=1 to leave it for debugging. */
export default async function globalTeardown() {
  if (!existsSync(SEED_FILE) || process.env.E2E_KEEP) return;
  const { runId } = JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed;
  const db = connect(process.env.TEST_DATABASE_URL!);
  await db.connect();
  try {
    await cleanup(db, runId);
  } finally {
    await db.end();
    rmSync(SEED_FILE, { force: true });
  }
}
