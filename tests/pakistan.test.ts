/**
 * Week 2 of the Pakistan-first roadmap (scope §13): a clinic's country decides
 * how local mobile numbers are read and which currency prices are shown in,
 * and Arabic names are optional with English as the fallback.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clinics, patients, users } from "@/db/schema";
import { COUNTRIES, countryOf } from "@/lib/countries";
import { clinicMoney } from "@/lib/i18n/format";
import { staffBookingSchemaFor } from "@/lib/validation/appointment";
import { bookingSchemaFor, normalisePhone } from "@/lib/validation/booking";
import { createClinicSchema } from "@/lib/validation/clinic";
import { clinicProfileSchema } from "@/lib/validation/clinic-settings";
import { serviceSchema } from "@/lib/validation/service";
import { staffSchema } from "@/lib/validation/staff";
import { addDays, localDate, localToUtc } from "@/lib/time/zoned";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Emails go out after the response; a unit test has no request scope, so run them inline (nothing is sent: no API key).
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    void task();
  },
}));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const { createClinicWithOwnerInvite } = await import("@/server/db/repositories/admin-clinics");
const { publicBookAction } = await import("@/server/actions/public-booking");
const { morningDigestEmail } = await import("@/server/services/notifications");

describe("phone numbers are read in the clinic's country", () => {
  it("Pakistan: local 03… mobiles become +92…", () => {
    expect(normalisePhone("0300 1234567", "PK")).toBe("+923001234567");
    expect(normalisePhone("0312-345-6789", "PK")).toBe("+923123456789");
    expect(normalisePhone("+92 300 1234567", "PK")).toBe("+923001234567");
    expect(normalisePhone("0092 300 1234567", "PK")).toBe("+923001234567");
  });

  it("a local number is only local in its own country", () => {
    // Saudi local format at a Pakistani clinic, and the other way round.
    expect(normalisePhone("0512345678", "PK")).toBeNull();
    expect(normalisePhone("03001234567", "SA")).toBeNull();
    // Saudi clinics behave exactly as before.
    expect(normalisePhone("05 1234 5678", "SA")).toBe("+966512345678");
  });

  it("international numbers are accepted everywhere", () => {
    expect(normalisePhone("+966512345678", "PK")).toBe("+966512345678");
    expect(normalisePhone("+923001234567", "SA")).toBe("+923001234567");
  });

  it("rejects junk and wrong lengths", () => {
    expect(normalisePhone("0300123456", "PK")).toBeNull(); // one digit short
    expect(normalisePhone("030012345678", "PK")).toBeNull(); // one digit long
    expect(normalisePhone("12345", "PK")).toBeNull();
  });

  it("the staff booking form uses the same rule", () => {
    const base = { serviceId: crypto.randomUUID(), staffId: crypto.randomUUID(), date: "2027-01-04", time: "10:00", fullName: "Ali Khan", phone: "0300 1234567" };
    expect(staffBookingSchemaFor("PK").parse(base).phone).toBe("+923001234567");
    expect(staffBookingSchemaFor("SA").safeParse(base).success).toBe(false);
  });

  it("an unknown stored country falls back to the column default instead of crashing", () => {
    expect(countryOf("PK")).toBe("PK");
    expect(countryOf("ZZ")).toBe("SA");
    expect(countryOf(null)).toBe("SA");
  });
});

describe("money is shown in the clinic's currency", () => {
  it("whole amounts without decimals, Latin digits", () => {
    expect(clinicMoney("en", 150000, "PKR")).toMatch(/PKR\s?1,500$/);
    expect(clinicMoney("en", 30000, "SAR")).toMatch(/SAR\s?300$/);
    expect(clinicMoney("ar", 150000, "PKR")).toMatch(/1,500/);
    expect(clinicMoney("ar", 150000, "PKR")).not.toMatch(/[٠-٩]/);
  });

  it("keeps the fraction when there is one", () => {
    expect(clinicMoney("en", 15050, "SAR")).toMatch(/150\.50/);
  });

  it("each country names its currency and time zone", () => {
    expect(COUNTRIES.PK).toMatchObject({ currency: "PKR", timezone: "Asia/Karachi" });
    expect(COUNTRIES.SA).toMatchObject({ currency: "SAR", timezone: "Asia/Riyadh" });
  });
});

describe("Arabic names are optional", () => {
  it("blank Arabic is stored as NULL; a given one still needs 2 letters", () => {
    const svc = { nameEn: "Scaling", nameAr: "", descriptionEn: "", descriptionAr: "", durationMinutes: "30", priceMinor: "1500" };
    expect(serviceSchema.parse(svc).nameAr).toBeNull();
    expect(serviceSchema.safeParse({ ...svc, nameAr: "ت" }).success).toBe(false);
    expect(serviceSchema.parse({ ...svc, nameAr: "تنظيف" }).nameAr).toBe("تنظيف");
    expect(staffSchema.parse({ displayNameEn: "Dr Ayesha", displayNameAr: "  ", titleEn: "", titleAr: "" }).displayNameAr).toBeNull();
    const profile = { nameEn: "Smile Dental", nameAr: "", addressEn: "", addressAr: "", phone: "", mapsUrl: "", timezone: "Asia/Karachi" };
    expect(clinicProfileSchema.parse(profile)).toMatchObject({ nameAr: null, timezone: "Asia/Karachi" });
  });

  it("the English name is still required", () => {
    expect(serviceSchema.safeParse({ nameEn: "", nameAr: "تنظيف", descriptionEn: "", descriptionAr: "", durationMinutes: "30", priceMinor: "" }).success).toBe(false);
  });

  it("a new clinic needs a supported country", () => {
    const base = { slug: "smile-isb", nameEn: "Smile Dental", nameAr: "", ownerEmail: "o@test.local" };
    expect(createClinicSchema.parse({ ...base, country: "PK" })).toMatchObject({ country: "PK", nameAr: null });
    expect(createClinicSchema.safeParse({ ...base, country: "AE" }).success).toBe(false);
    expect(createClinicSchema.safeParse(base).success).toBe(false);
  });

  it("emails fall back to English when there is no Arabic name", () => {
    const at = new Date(Date.UTC(2027, 0, 4, 5, 0));
    const email = morningDigestEmail({ nameEn: "Smile Dental", nameAr: null, timeZone: "Asia/Karachi" }, [
      { id: "a", clinicId: "c", clinicNameEn: "Smile Dental", clinicNameAr: null, timeZone: "Asia/Karachi", startAt: at, staffNameEn: "Dr Ayesha", staffNameAr: null, serviceNameEn: "Scaling", serviceNameAr: null },
    ], "https://clinova.test");
    expect(email.text).not.toMatch(/null|undefined/);
    // Both cards (Arabic and English) name the clinic and the dentist in English.
    expect(email.text.match(/Smile Dental/g)?.length).toBeGreaterThanOrEqual(2);
    expect(email.text.match(/Dr Ayesha/g)?.length).toBe(2);
  });
});

describe("a Pakistani clinic end to end", () => {
  let clinicId: string;
  let scaling: string;
  let ayesha: string;
  const date = addDays(localDate(Date.now(), "Asia/Karachi"), 7);

  beforeAll(async () => {
    const [admin] = await db.insert(users).values({ name: "Admin", email: "admin@test.local" }).returning({ id: users.id });
    const created = await createClinicWithOwnerInvite(
      { db, userId: admin!.id } as never,
      { slug: "smile-isb", nameEn: "Smile Dental Islamabad", nameAr: null, country: "PK", ownerEmail: "owner@test.local" },
      "h".repeat(64),
    );
    clinicId = created.id;
    const ctx = { db, clinicId, userId: admin!.id, role: "clinic_owner", clinicStatus: "trial" } as const;
    await clinicsRepo.updateBookingRules(ctx, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 60, changeCutoffMinutes: 0, slotGranularityMinutes: 30 });
    await clinicsRepo.setBookingEnabled(ctx, true);
    scaling = (await services.createService(ctx, { nameEn: "Scaling", nameAr: null, descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: 300000 })).id;
    ayesha = (await staffRepo.createStaff(ctx, { displayNameEn: "Dr Ayesha", displayNameAr: null, titleEn: null, titleAr: null })).id;
    await staffRepo.setStaffServices(ctx, ayesha, [scaling]);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    await hours.replaceStaffHours(ctx, ayesha, [{ dayOfWeek: dow, startMinute: 600, endMinute: 720 }]);
  });

  it("is created in Pakistan, on Karachi time, with no Arabic name", async () => {
    const [row] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
    expect(row).toMatchObject({ country: "PK", timezone: "Asia/Karachi", nameAr: null });
    expect(await clinicsRepo.getClinicCountry({ db, clinicId, userId: "x", role: "clinic_owner", clinicStatus: "trial" })).toBe("PK");
  });

  const book = (phone: string, minute = 600) => {
    const f = new FormData();
    const base = { slug: "smile-isb", serviceId: scaling, staffId: "any", startMs: String(localToUtc(date, minute, "Asia/Karachi")), fullName: "Ali Khan", phone, email: "", consent: "on" };
    for (const [k, v] of Object.entries(base)) f.set(k, v);
    return publicBookAction(null, f);
  };

  it("takes an online booking with a local 03… number and stores it as +92…", async () => {
    expect((await book("0300 1234567")).ok).toBe(true);
    const [p] = await db.select().from(patients).where(eq(patients.clinicId, clinicId));
    expect(p?.phoneE164).toBe("+923001234567");
  });

  it("refuses a Saudi local number there", async () => {
    expect(await book("0512345678", 630)).toEqual({ ok: false, error: "phone" });
  });

  it("the public booking schema follows the same country", () => {
    const base = { serviceId: scaling, staffId: "any", startMs: "1", fullName: "Ali", phone: "03001234567", email: "", consent: true };
    expect(bookingSchemaFor("PK").safeParse(base).success).toBe(true);
    expect(bookingSchemaFor("SA").safeParse(base).success).toBe(false);
  });
});
