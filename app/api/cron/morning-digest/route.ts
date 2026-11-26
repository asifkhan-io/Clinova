import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { runMorningDigests } from "@/server/services/notifications";

/**
 * GET /api/cron/morning-digest — called by Vercel Cron (vercel.json).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`. Anything else is refused,
 * and so is everything when CRON_SECRET is unset: an unconfigured secret must
 * close the door, not leave it open for anyone to trigger mass email.
 */
function authorised(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!authorised(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await runMorningDigests();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
