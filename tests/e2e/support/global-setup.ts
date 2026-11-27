import { rmSync, writeFileSync } from "node:fs";
import { connect, seed } from "./seed";
import { SEED_FILE } from "./paths";

/** Makes this run's throwaway clinics and users; the specs read them from SEED_FILE. */
export default async function globalSetup() {
  const runId = `${Date.now() % 1e8}`.padStart(8, "0"); // digits only, so Arabic pages carry no stray Latin
  rmSync(`${SEED_FILE}.phone-seq`, { force: true }); // phone numbers restart with each run (fixtures.ts)
  const db = connect(process.env.TEST_DATABASE_URL!);
  await db.connect();
  try {
    writeFileSync(SEED_FILE, JSON.stringify(await seed(db, runId), null, 2));
  } finally {
    await db.end();
  }
}
