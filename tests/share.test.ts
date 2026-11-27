/**
 * The clinic share kit: the booking link and its QR code are built on our own
 * server from the clinic's slug, never sent to a third-party QR service.
 */
import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { whatsappShareLink } from "@/lib/whatsapp";
import { publicBookingUrl, qrDataUrl } from "@/server/services/share";

describe("clinic share kit", () => {
  it("builds the public booking link for the page's language", () => {
    expect(publicBookingUrl("https://clinova-beta.vercel.app", "en", "demo")).toBe("https://clinova-beta.vercel.app/en/c/demo");
    expect(publicBookingUrl("http://localhost:3000/", "ar", "smile-isb")).toBe("http://localhost:3000/ar/c/smile-isb");
  });

  it("makes the QR code as an SVG data URL, locally", () => {
    const url = "https://clinova-beta.vercel.app/en/c/demo";
    const dataUrl = qrDataUrl(url);
    expect(dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(dataUrl.split(",")[1]!, "base64").toString();
    expect(svg).toMatch(/^<svg [^>]*viewBox=/);
    // Same input, same code: the poster and the download always match.
    expect(qrDataUrl(url)).toBe(dataUrl);
    // The encoder accepts the link at the error-correction level the poster uses.
    expect(encode(url, { ecc: "M" }).size).toBeGreaterThan(20);
  });

  it("the WhatsApp share link carries the whole message, encoded, with no number", () => {
    const link = whatsappShareLink("Book at Smile Dental: https://x.test/en/c/smile?a=1&b=2");
    expect(link.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(link.slice("https://wa.me/?text=".length))).toBe("Book at Smile Dental: https://x.test/en/c/smile?a=1&b=2");
  });
});
