import { connection } from "next/server";
import { z } from "zod";
import { findPublicClinic } from "@/server/db/repositories/public-clinic";
import { getSlotsForDate } from "@/server/services/availability";
import { loadBusyForDate } from "@/server/services/booking";
import { callerAddress, consumeRateLimit } from "@/server/services/rate-limit";

const query = z.object({
  serviceId: z.uuid(),
  staffId: z.union([z.uuid(), z.literal("any")]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * GET /api/public/c/:slug/availability?serviceId&staffId|any&date
 *
 * Request-time, never cached (ARCH8): a stale slot grid is a double-booking
 * funnel. Returns start instants only; for "any" the dentist is not revealed
 * (the booking step picks one, D9).
 *
 * Rate limited per address BEFORE validation (ARCH2), so a flood of malformed
 * requests is refused as cheaply as a flood of valid ones.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/public/c/[slug]/availability">) {
  await connection();
  const { slug } = await ctx.params;

  const address = callerAddress(request.headers);
  if (address && !(await consumeRateLimit("public.availability", address))) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const found = await findPublicClinic(slug);
  if (!found) return Response.json({ error: "not_found" }, { status: 404 });
  if (!found.clinic.bookingEnabled) return Response.json({ slots: [] }, { headers: { "Cache-Control": "no-store" } });

  const nowMs = Date.now();
  const { serviceId, staffId, date } = parsed.data;
  const busy = await loadBusyForDate(found.scope, serviceId, date);
  const slots = await getSlotsForDate(found.scope, {
    serviceId,
    date,
    nowMs,
    staffId: staffId === "any" ? undefined : staffId,
    busy,
  });
  const starts = [...new Set(slots.map((s) => s.startMs))].sort((a, b) => a - b);
  return Response.json({ slots: starts }, { headers: { "Cache-Control": "no-store" } });
}
