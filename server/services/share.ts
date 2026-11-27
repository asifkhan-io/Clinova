import "server-only";
import { headers } from "next/headers";
import { renderSVG } from "uqr";

/**
 * The clinic share kit (Week 4 support): the public booking link as a QR
 * code for the reception desk and a ready WhatsApp message.
 *
 * The origin comes from the request the owner is making, so the link is right
 * on production, a preview and localhost alike, and it follows a custom domain
 * the day one is connected, with no setting to update. It only ever shapes the
 * owner's own page.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function publicBookingUrl(origin: string, locale: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/c/${slug}`;
}

/**
 * The QR code as an SVG data URL, made on our own server (uqr, no network): the
 * link is never sent to a third-party QR service. Error correction "M" survives
 * a smudged or folded print; the 4-module quiet zone is what scanners expect.
 * A data URL (not inline markup) so the same value also serves as the download.
 */
export function qrDataUrl(text: string): string {
  const svg = renderSVG(text, { ecc: "M", border: 4 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
