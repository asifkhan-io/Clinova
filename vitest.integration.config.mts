import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// The only env file read here. It points at the disposable Neon `test` branch,
// never at dev or production (see tests/integration/README.md).
config({ path: ".env.test", quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.integration.test.ts"],
    // Real network round-trips, and a cold Neon compute may need a few seconds to wake.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file at a time: they share one database.
    fileParallelism: false,
    env: { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", TEST_APP_DATABASE_URL: process.env.TEST_APP_DATABASE_URL ?? "" },
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./tests/helpers/empty.ts", import.meta.url)),
    },
  },
});
