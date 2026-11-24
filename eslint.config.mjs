import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Tenant isolation, part 1 (architecture.md §3.1): only repositories build
    // queries. Everything else goes through a repository that takes a
    // ClinicContext, so a missing clinic filter cannot be written by accident.
    files: ["app/**", "components/**", "lib/**", "server/services/**", "server/actions/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server/db/client", "@/server/db/client"],
              message:
                "Import a repository from server/db/repositories instead. Only repositories may construct queries.",
            },
            {
              group: ["drizzle-orm", "drizzle-orm/*"],
              message:
                "Queries belong in server/db/repositories. UI and services must not build SQL.",
            },
          ],
        },
      ],
    },
  },
  {
    // RTL (instructions §6): logical utilities only, so Arabic mirrors correctly.
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(^|\\s)-?(ml|mr|pl|pr|left|right|rounded-l|rounded-r|border-l|border-r)-|(^|\\s)text-(left|right)(\\s|$)/]",
          message:
            "Use logical utilities (ms-, me-, ps-, pe-, start-, end-, text-start, text-end) so Arabic RTL mirrors correctly.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
