import { beforeAll, describe, expect, it, vi } from "vitest";
import { clinics } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
// connection() needs a live Next request; in a unit test there is none.
// after() only exists inside a real request; here the notification work just runs.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => {
    void task();
  },
}));
// The address the limiter sees. Null by default: a unit test has no proxy
// header, and an unknown caller is deliberately not limited.
let forwardedFor: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
}));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const { findPublicClinic, loadPublicCatalogue } = await import("@/server/db/repositories/public-clinic");
const { GET } = await import("@/app/api/public/c/[slug]/availability/route");
const { publicBookAction } = await import("@/server/actions/public-booking");
const { LIMITS } = await import("@/server/services/rate-limit");
const { addDays, localDate, localToUtc } = await import("@/lib/time/zoned");

type Ctx = Parameters<typeof services.listServices>[0];
let ctx: Ctx;
let cleaning: string;
let hidden: string;
let sara: string;
// A date safely inside the horizon from the real clock (route uses Date.now()).
const date = addDays(localDate(Date.now(), "Asia/Riyadh"), 7);

beforeAll(async () => {
  const [c] = await db.insert(clinics).values({ slug: "smile", nameEn: "Smile", nameAr: "ابتسامة" }).returning({ id: clinics.id });
  await db.insert(clinics).values({ slug: "gone", nameEn: "Gone", nameAr: "مغلقة", status: "suspended", bookingEnabled: true });
  ctx = { db, clinicId: c!.id, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "trial" };
  await clinicsRepo.updateBookingRules(ctx, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 60, changeCutoffMinutes: 0, slotGranularityMinutes: 30 });
  cleaning = (await services.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: 15000 })).id;
  sara = (await staffRepo.createStaff(ctx, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  // Created after Sara, and then removed from her: nobody performs it.
  hidden = (await services.createService(ctx, { nameEn: "Nobody does this", nameAr: "لا أحد", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  await staffRepo.setStaffServices(ctx, sara, [cleaning]);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  await hours.replaceStaffHours(ctx, sara, [{ dayOfWeek: dow, startMinute: 540, endMinute: 660 }]);
});

const availability = (q: Record<string, string>, slug = "smile") =>
  GET(new Request(`http://x/api/public/c/${slug}/availability?${new URLSearchParams(q)}`), { params: Promise.resolve({ slug }) } as never);

describe("public clinic page data", () => {
  it("hides suspended clinics entirely and unknown slugs", async () => {
    expect(await findPublicClinic("gone")).toBeNull();
    expect(await findPublicClinic("nope")).toBeNull();
    expect((await findPublicClinic("smile"))?.clinic.nameEn).toBe("Smile");
  });

  it("lists only services somebody performs, and only dentists with services", async () => {
    const found = (await findPublicClinic("smile"))!;
    const cat = await loadPublicCatalogue(found.scope);
    expect(cat.services.map((s) => s.id)).toEqual([cleaning]);
    expect(cat.services.map((s) => s.id)).not.toContain(hidden);
    expect(cat.dentists.map((d) => d.id)).toEqual([sara]);
  });
});

describe("GET availability", () => {
  it("returns no slots while booking is switched off, then real slots, never cached", async () => {
    const off = await availability({ serviceId: cleaning, staffId: "any", date });
    expect(await off.json()).toEqual({ slots: [] });

    await clinicsRepo.setBookingEnabled(ctx, true);
    const on = await availability({ serviceId: cleaning, staffId: "any", date });
    expect(on.headers.get("cache-control")).toBe("no-store");
    const { slots } = (await on.json()) as { slots: number[] };
    expect(slots).toEqual([0, 30, 60, 90].map((m) => localToUtc(date, 540 + m, "Asia/Riyadh")));
  });

  it("rejects bad input (400) and suspended or unknown clinics (404)", async () => {
    expect((await availability({ serviceId: "x", staffId: "any", date })).status).toBe(400);
    expect((await availability({ serviceId: cleaning, staffId: "any", date }, "gone")).status).toBe(404);
  });
});

describe("publicBookAction", () => {
  const form = (o: Record<string, string> = {}) => {
    const f = new FormData();
    const base = { slug: "smile", serviceId: cleaning, staffId: "any", startMs: String(localToUtc(date, 540, "Asia/Riyadh")), fullName: "Noura Ali", phone: "05 1234 5678", email: "", consent: "on", ...o };
    for (const [k, v] of Object.entries(base)) if (v !== "__omit") f.set(k, v);
    return f;
  };

  it("books, and the time disappears from availability", async () => {
    const r = await publicBookAction(null, form());
    expect(r.ok).toBe(true);
    const { slots } = (await (await availability({ serviceId: cleaning, staffId: "any", date })).json()) as { slots: number[] };
    expect(slots).not.toContain(localToUtc(date, 540, "Asia/Riyadh"));
  });

  it("explains what's wrong instead of failing silently", async () => {
    expect(await publicBookAction(null, form({ consent: "__omit" }))).toEqual({ ok: false, error: "consent" });
    expect(await publicBookAction(null, form({ phone: "123" }))).toEqual({ ok: false, error: "phone" });
    expect(await publicBookAction(null, form({ slug: "gone" }))).toEqual({ ok: false, error: "not_found" });
    expect(await publicBookAction(null, form())).toEqual({ ok: false, error: "slot_unavailable" }); // already taken
  });
});

describe("rate limiting the booking path", () => {
  const bookWith = (phone: string) => {
    const f = new FormData();
    const base = {
      slug: "smile",
      serviceId: cleaning,
      staffId: "any",
      startMs: String(localToUtc(date, 540, "Asia/Riyadh")),
      fullName: "Noura Ali",
      phone,
      consent: "on",
    };
    for (const [k, v] of Object.entries(base)) f.set(k, v);
    return f;
  };

  it("refuses a flood from one address, and says so rather than failing silently", async () => {
    forwardedFor = "198.51.100.7";
    try {
      const results = [];
      for (let i = 0; i <= LIMITS["public.book.ip"].max; i++) {
        results.push(await publicBookAction(null, bookWith("05 9000 0001")));
      }
      expect(results.at(-1)).toEqual({ ok: false, error: "rate_limited" });
      // Everything under the limit got a real answer, not a refusal.
      expect(results.slice(0, -1).some((r) => !r.ok && r.error === "rate_limited")).toBe(false);
    } finally {
      forwardedFor = null;
    }
  });

  it("refuses a flood for one phone number even when the address is unknown", async () => {
    const results = [];
    for (let i = 0; i <= LIMITS["public.book.phone"].max; i++) {
      results.push(await publicBookAction(null, bookWith("05 9000 0002")));
    }
    expect(results.at(-1)).toEqual({ ok: false, error: "rate_limited" });
    expect(results.slice(0, -1).some((r) => !r.ok && r.error === "rate_limited")).toBe(false);
  });

  it("does not limit a caller it cannot identify", async () => {
    // forwardedFor is null here, so the address bucket is skipped entirely;
    // a missing proxy header must never lock every patient out at once.
    const r = await publicBookAction(null, bookWith("05 9000 0003"));
    expect(r).not.toEqual({ ok: false, error: "rate_limited" });
  });
});
