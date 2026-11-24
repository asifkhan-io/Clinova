import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each file gets a fresh in-memory Postgres; no shared state between files.
    isolate: true,
  },
  resolve: {
    // The @/ alias from tsconfig.json.
    tsconfigPaths: true,
    alias: {
      // Next.js resolves "server-only" itself; outside Next it is just a marker.
      "server-only": fileURLToPath(new URL("./tests/helpers/empty.ts", import.meta.url)),
    },
  },
});
