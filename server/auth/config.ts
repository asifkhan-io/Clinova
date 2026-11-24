import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Relative imports, not the @/ alias: the Better Auth CLI loads this file
// outside the Next build, where tsconfig path aliases may not resolve.

import * as schema from "../../db/schema";
import { db } from "../db/client";

/**
 * Better Auth owns identity ONLY: users, sessions, accounts, verifications.
 * No Clinova domain column lives in those tables — membership, roles and
 * platform-admin status are our own tables, which reference users.id and
 * nothing else. That is what keeps this decision cheap to reverse.
 *
 * The organization plugin is deliberately NOT used: `clinics` carries fifteen
 * domain columns and must stay a stable domain key for the composite foreign
 * keys in database-design.md §6.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    // Our foreign keys say `users`, not `user`. Pluralising here keeps the
    // domain schema from bending to the auth library's naming.
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
