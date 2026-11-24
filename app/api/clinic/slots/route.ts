import { connection } from "next/server";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import { staffSlotSuggestions } from "@/server/services/staff-appointments";

const query = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exclude: z.uuid().optional(),
});

/**
 * GET /api/clinic/slots?serviceId&staffId&date[&exclude=appointmentId]
 * Suggested free times for staff. Signed-in members only; the clinic comes
 * from the session, so another clinic's ids just return nothing. Never cached.
 */
export async function GET(request: Request) {
  await connection();
  let ctx;
  try {
    ctx = await requireClinicAccess();
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.code }, { status: e.code === "unauthenticated" ? 401 : 403 });
    throw e;
  }
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const { exclude, ...rest } = parsed.data;
  const slots = await staffSlotSuggestions(ctx, { ...rest, excludeAppointmentId: exclude }, Date.now());
  return Response.json({ slots }, { headers: { "Cache-Control": "no-store" } });
}
