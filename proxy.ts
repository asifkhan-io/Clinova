// Next.js 16 renamed middleware.ts to proxy.ts. This handles locale only.
// It is NOT an auth boundary (architecture.md §3.2): authorization happens on
// the server, in every page, Server Action and Route Handler.
import createMiddleware from "next-intl/middleware";
import { routing } from "./lib/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Pages only. /api/* (public booking, cron, Better Auth) must never be rewritten.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
