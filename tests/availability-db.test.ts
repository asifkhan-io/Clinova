/** The engine end to end against a real database: loader + D6 resolver + slots. */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clinics } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const overrides = await import("@/server/db/repositories/overrides");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const { getSlotsForDate } = await import("@/server/services/availability");
const { localToUtc } = await import("@/server/services/availability/time");

type Ctx = Parameters<typeof services.listServices>[0];
let a: Ctx;
let b: Ctx;
let cleaning: string;
let otherClinicService: string;
let sara: string;
let omar: string;
const NOW = Date.UTC(2027, 0, 1);
const H = (h: number) => h * 60;
const SUNDAY = "2027-01-03";

beforeAll(async () => {
  const [ca, cb] = await db.insert(clinics).values([{ slug: "a", nameEn: "A", nameAr: "أ" }, { slug: "b", nameEn: "B", nameAr: "ب" }]).returning({ id: clinics.id });
  const base = { db, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "active" } as const;
  a = { ...base, clinicId: ca!.id };
  b = { ...base, clinicId: cb!.id };
  await clinicsRepo.updateBookingRules(a, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 365, changeCutoffMinutes: 0, slotGranularityMinutes: 30 });

  cleaning = (await services.createService(a, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 60, priceMinor: null })).id;
  otherClinicService = (await services.createService(b, { nameEn: "B", nameAr: "ب", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;

  sara = (await staffRepo.createStaff(a, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  omar = (await staffRepo.createStaff(a, { displayNameEn: "Omar", displayNameAr: "عمر", titleEn: null, titleAr: null })).id;
  await hours.replaceStaffHours(a, sara, [{ dayOfWeek: 0, startMinute: H(9), endMinute: H(11) }]);
  await hours.replaceStaffHours(a, omar, [{ dayOfWeek: 0, startMinute: H(16), endMinute: H(18) }]);
});

const local = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(11, 16); // Riyadh is UTC+3

describe("getSlotsForDate", () => {
  it("returns each dentist's slots for one dentist, or merged for 'any available'", async () => {
    const saraOnly = await getSlotsForDate(a, { serviceId: cleaning, date: SUNDAY, nowMs: NOW, staffId: sara });
    expect(saraOnly.map((s) => local(s.startMs))).toEqual(["09:00", "09:30", "10:00"]);

    const any = await getSlotsForDate(a, { serviceId: cleaning, date: SUNDAY, nowMs: NOW });
    expect(new Set(any.map((s) => s.staffId))).toEqual(new Set([sara, omar]));
    expect(any.map((s) => local(s.startMs))).toEqual(["09:00", "09:30", "10:00", "16:00", "16:30", "17:00"]);
  });

  it("applies a clinic closure from the database (D6 rule 0)", async () => {
    await overrides.createOverride(a, { staffId: null, type: "closed", startDate: SUNDAY, endDate: SUNDAY, labelEn: "Closed", labelAr: null, intervals: [] });
    expect(await getSlotsForDate(a, { serviceId: cleaning, date: SUNDAY, nowMs: NOW })).toEqual([]);
    expect((await getSlotsForDate(a, { serviceId: cleaning, date: "2027-01-10", nowMs: NOW })).length).toBe(6); // next Sunday normal
  });

  it("subtracts existing bookings passed in as busy", async () => {
    const date = "2027-01-10";
    const busy = new Map([[sara, [{ startMs: localToUtc(date, H(9), "Asia/Riyadh")!, endMs: localToUtc(date, H(10), "Asia/Riyadh")! }]]]);
    const slots = await getSlotsForDate(a, { serviceId: cleaning, date, nowMs: NOW, staffId: sara, busy });
    expect(slots.map((s) => local(s.startMs))).toEqual(["10:00"]);
  });

  it("never offers dentists who don't perform the service, or inactive ones", async () => {
    await staffRepo.setStaffServices(a, omar, []);
    const slots = await getSlotsForDate(a, { serviceId: cleaning, date: "2027-01-10", nowMs: NOW });
    expect(slots.every((s) => s.staffId === sara)).toBe(true);
    await staffRepo.setStaffActive(a, sara, false);
    expect(await getSlotsForDate(a, { serviceId: cleaning, date: "2027-01-10", nowMs: NOW })).toEqual([]);
    await staffRepo.setStaffActive(a, sara, true);
  });

  it("returns nothing for another clinic's service, an inactive service, or a past date", async () => {
    expect(await getSlotsForDate(a, { serviceId: otherClinicService, date: "2027-01-10", nowMs: NOW })).toEqual([]);
    expect(await getSlotsForDate(a, { serviceId: cleaning, date: "2026-12-27", nowMs: NOW })).toEqual([]);
    await services.setServiceActive(a, cleaning, false);
    expect(await getSlotsForDate(a, { serviceId: cleaning, date: "2027-01-10", nowMs: NOW })).toEqual([]);
  });
});
