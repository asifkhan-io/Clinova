import { connection } from "next/server";
import { z } from "zod";
import { patientRescheduleSlots } from "@/server/services/appointment-changes";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { hashToken } from "@/server/services/tokens";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/public/a/:token/availability?date=YYYY-MM-DD
 *
 * Times this appointment can move to (same service and dentist, D10). An
 * unknown, expired or locked link gets an empty list, not a 404, so the
 * response can't be used to probe which tokens exist. Never cached (ARCH8).
 *
 * Rate limited per link, not per address (ARCH2): the token is the only
 * identity here, and limiting by address would punish a family or a clinic
 * waiting room sharing one connection. A refusal is also an empty list, for
 * the same reason the not-found case is.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/public/a/[token]/availability">) {
  await connection();
  const { token } = await ctx.params;
  const parsed = date.safeParse(new URL(request.url).searchParams.get("date"));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const tokenHash = hashToken(token);
  if (!(await consumeRateLimit("token.availability", tokenHash))) {
    return Response.json({ slots: [] }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }

  const slots = await patientRescheduleSlots(tokenHash, parsed.data, Date.now());
  return Response.json({ slots }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
