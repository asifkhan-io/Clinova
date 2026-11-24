import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/config";

// Better Auth's HTTP endpoints: /api/auth/sign-in/email, /api/auth/sign-out, …
// proxy.ts excludes /api, so these are never locale-rewritten.
export const { GET, POST } = toNextJsHandler(auth);
