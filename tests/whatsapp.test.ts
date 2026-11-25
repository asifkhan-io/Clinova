import { describe, expect, it } from "vitest";
import { clinicTime, wallClock } from "@/lib/i18n/format";
import { whatsappLink } from "@/lib/whatsapp";

describe("wa.me links", () => {
  it("drop the + and encode Arabic text and line breaks", () => {
    const link = whatsappLink("+966512345678", "موعدك غدًا\n9:30 ص");
    expect(link.startsWith("https://wa.me/966512345678?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1]!)).toBe("موعدك غدًا\n9:30 ص");
    expect(link).not.toMatch(/\s/);
  });
});

describe("clinic wall-clock formatting", () => {
  const nineThirtyRiyadh = Date.UTC(2027, 0, 3, 6, 30);
  it("gives <input type=time> values in the clinic's zone, 24-hour", () => {
    expect(wallClock("Asia/Riyadh", nineThirtyRiyadh)).toBe("09:30");
    expect(wallClock("Asia/Riyadh", Date.UTC(2027, 0, 3, 15, 5))).toBe("18:05");
  });
  it("keeps Latin digits in Arabic", () => {
    expect(clinicTime("ar", "Asia/Riyadh", nineThirtyRiyadh)).toMatch(/9:30/);
  });
});
