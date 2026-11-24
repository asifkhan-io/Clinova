import { connection } from "next/server";
import { z } from "zod";
import { patientRescheduleSlots } from "@/server/services/appointment-changes";
import { hashToken } from "@/server/services/tokens";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/public/a/:token/availability?date=YYYY-MM-DD
 *
 * Times this appointment can move to (same service and dentist, D10). An
 * unknown, expired or locked link gets an empty list, not a 404, so the
 * response can't be used to probe which tokens exist. Never cached (ARCH8).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/public/a/[token]/availability">) {
  await connection();
  const { token } = await ctx.params;
  const parsed = date.safeParse(new URL(request.url).searchParams.get("date"));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const slots = await patientRescheduleSlots(hashToken(token), parsed.data, Date.now());
  return Response.json({ slots }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
