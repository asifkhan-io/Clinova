import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { appointments, clinics } from "@/db/schema";
import { buildIcs, escapeText, fold } from "@/server/services/ics";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const { findAppointmentByToken } = await import("@/server/db/repositories/appointments");
const { createPublicBooking } = await import("@/server/services/booking");
const { hashToken } = await import("@/server/services/tokens");
const { localToUtc } = await import("@/lib/time/zoned");
const { GET } = await import("@/app/api/public/a/[token]/ics/route");

const NOW = Date.UTC(2027, 0, 1);
const DATE = "2027-01-03";
let token: string;
let appointmentId: string;

beforeAll(async () => {
  const [c] = await db.insert(clinics).values({ slug: "smile", nameEn: "Smile, Dental; Care", nameAr: "ابتسامة", addressEn: "King Fahd Rd, Riyadh", bookingEnabled: true }).returning({ id: clinics.id });
  const ctx = { db, clinicId: c!.id, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "trial" } as const;
  await clinicsRepo.updateBookingRules(ctx, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 365, changeCutoffMinutes: 0, slotGranularityMinutes: 30 });
  const svc = (await services.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  const sara = (await staffRepo.createStaff(ctx, { displayNameEn: "Dr Sara", displayNameAr: "د. سارة", titleEn: null, titleAr: null })).id;
  await hours.replaceStaffHours(ctx, sara, [{ dayOfWeek: 0, startMinute: 540, endMinute: 600 }]);
  const r = await createPublicBooking(ctx, { serviceId: svc, staffId: "any", startMs: localToUtc(DATE, 540, "Asia/Riyadh")!, fullName: "Noura Ali", phoneE164: "+966512345678" }, NOW);
  if (!r.ok) throw new Error(r.reason);
  token = r.token;
  appointmentId = r.appointmentId;
});

describe("private appointment link", () => {
  it("finds the booking by the token's hash only — never exposes name or phone", async () => {
    const appt = await findAppointmentByToken(hashToken(token), NOW);
    expect(appt?.service.nameEn).toBe("Cleaning");
    expect(JSON.stringify(appt)).not.toMatch(/Noura|512345678/);
    expect(await findAppointmentByToken(token, NOW)).toBeNull(); // the raw token is not a valid key
  });

  it("stops working 24 hours after the appointment ends", async () => {
    const end = localToUtc(DATE, 570, "Asia/Riyadh")!;
    expect(await findAppointmentByToken(hashToken(token), end + 23 * 3_600_000)).not.toBeNull();
    expect(await findAppointmentByToken(hashToken(token), end + 25 * 3_600_000)).toBeNull();
  });
});

describe("calendar file", () => {
  it("serves a valid, escaped .ics with a stable UID and no patient data", async () => {
    const res = await GET(new Request(`http://x/api/public/a/${token}/ics?lang=en`), { params: Promise.resolve({ token }) } as never);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain(`UID:${appointmentId}@clinova`);
    expect(body).toContain("DTSTART:20270103T060000Z"); // 09:00 Riyadh = 06:00 UTC
    expect(body).toContain("SUMMARY:Cleaning — Smile\\, Dental\; Care");
    expect(body).toContain("\r\n");
    expect(body).not.toMatch(/Noura|512345678/);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ token: "nope" }) } as never);
    expect(res.status).toBe(404);
  });

  it("marks a cancelled appointment so calendars remove it", async () => {
    await db.update(appointments).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "patient", icsSequence: 1 }).where(eq(appointments.id, appointmentId));
    const body = await (await GET(new Request(`http://x?lang=en`), { params: Promise.resolve({ token }) } as never)).text();
    expect(body).toContain("METHOD:CANCEL");
    expect(body).toContain("STATUS:CANCELLED");
    expect(body).toContain("SEQUENCE:1");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const long = `SUMMARY:${"تنظيف الأسنان ".repeat(10)}`;
    for (const part of fold(long).split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(fold(long).replace(/\r\n /g, "")).toBe(long);
    expect(escapeText("a\nb")).toBe("a\\nb");
    expect(buildIcs({ uid: "u", sequence: 0, startMs: 0, endMs: 1, summary: "x", location: null, description: null, nowMs: 0 }).endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
