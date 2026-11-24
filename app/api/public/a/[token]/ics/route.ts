import { connection } from "next/server";
import { findAppointmentByToken } from "@/server/db/repositories/appointments";
import { buildIcs } from "@/server/services/ics";
import { hashToken } from "@/server/services/tokens";

/** GET /api/public/a/:token/ics?lang=en|ar — the "Add to calendar" file. */
export async function GET(request: Request, ctx: RouteContext<"/api/public/a/[token]/ics">) {
  await connection();
  const { token } = await ctx.params;
  const nowMs = Date.now();
  const appt = await findAppointmentByToken(hashToken(token), nowMs);
  if (!appt) return new Response("Not found", { status: 404 });

  const ar = new URL(request.url).searchParams.get("lang") === "ar";
  const pick = (en: string | null, arText: string | null) => (ar ? arText || en : en || arText);
  const clinicName = pick(appt.clinic.nameEn, appt.clinic.nameAr)!;
  const body = buildIcs({
    uid: `${appt.id}@clinova`,
    sequence: appt.icsSequence,
    startMs: appt.startAt.getTime(),
    endMs: appt.endAt.getTime(),
    summary: `${pick(appt.service.nameEn, appt.service.nameAr)} — ${clinicName}`,
    location: pick(appt.clinic.addressEn, appt.clinic.addressAr),
    description: [pick(appt.dentist.nameEn, appt.dentist.nameAr), appt.clinic.phone].filter(Boolean).join("\n"),
    cancelled: appt.status === "cancelled",
    nowMs,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
