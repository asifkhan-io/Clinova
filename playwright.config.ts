import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (Phase 8e, DoD 7). They start their own dev server on port 3100
 * pointed at the disposable Neon `test` branch (TEST_DATABASE_URL in .env.test),
 * never at the database in .env.local. See tests/e2e/README.md.
 */
loadEnv({ path: ".env.test", quiet: true });
const local = loadEnv({ path: ".env.local", quiet: true, processEnv: {} }).parsed ?? {};

const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL is not set. Put the Neon `test` branch URL in .env.test.");
for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
  const other = local[name];
  if (other && new URL(other).hostname.replace("-pooler", "") === new URL(testDb).hostname.replace("-pooler", "")) {
    throw new Error(`TEST_DATABASE_URL is the same database as ${name} in .env.local. Refusing to run browser tests against it.`);
  }
}

const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  // One worker: the tests share one dev server and one database.
  workers: 1,
  fullyParallel: false,
  // The dev server compiles each route on its first visit; that can take a while.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/support/global-setup.ts",
  globalTeardown: "./tests/e2e/support/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Riyadh",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      // E2E_BROWSER_CHANNEL=chrome uses an installed Chrome instead of Playwright's own build.
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/en/sign-in`,
    timeout: 180_000,
    // Never reuse a server someone started by hand: it might be on the dev database.
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // Process env wins over .env.local inside Next, so these override it.
      DATABASE_URL: testDb,
      DATABASE_URL_UNPOOLED: testDb,
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: local.BETTER_AUTH_SECRET || "e2e-only-secret-0123456789-abcdefghij",
      // No real email from tests, ever.
      RESEND_API_KEY: "",
      CRON_SECRET: "e2e",
    },
  },
});
