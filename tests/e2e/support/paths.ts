import path from "node:path";

/** Where global setup leaves this run's ids for the specs (gitignored). Relative to the repo root, where Playwright runs. */
export const SEED_FILE = path.resolve("tests/e2e/.seed.json");
