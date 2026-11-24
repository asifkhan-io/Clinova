import { beforeAll, describe, expect, it, vi } from "vitest";
import { clinics } from "@/db/schema";
import { bookingRulesSchema, clinicProfileSchema } from "@/lib/validation/clinic-settings";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
const clinicsRepo = await import("@/server/db/repositories/clinics");
const servicesRepo = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hoursRepo = await import("@/server/db/repositories/hours");
const { getSetupChecklist } = await import("@/server/services/onboarding");
type Ctx = Parameters<typeof clinicsRepo.getOwnClinic>[0];

let ctx: Ctx;
const done = async () =>
  Object.fromEntries((await getSetupChecklist(ctx)).steps.map((s) => [s.key, s.done]));

beforeAll(async () => {
  const [c] = await db.insert(clinics).values({ slug: "fresh", nameEn: "Fresh", nameAr: "جديدة" }).returning({ id: clinics.id });
  ctx = { db, clinicId: c!.id, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "trial" };
});

describe("setup checklist (derived, never stored)", () => {
  it("starts with nothing done and booking not allowed", async () => {
    const c = await getSetupChecklist(ctx);
    expect(c.readyToBook).toBe(false);
    expect(c.steps.every((s) => !s.done)).toBe(true);
  });

  it("becomes ready only when every active dentist has a service AND hours", async () => {
    await servicesRepo.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null });
    const { id: sara } = await staffRepo.createStaff(ctx, { displayNameEn: "Dr Sara", displayNameAr: "د. سارة", titleEn: null, titleAr: null });
    // Sara inherited the service (D5) but the clinic had no hours template yet.
    expect(await done()).toMatchObject({ services: true, dentists: true, dentistServices: true, hours: false });
    expect((await getSetupChecklist(ctx)).readyToBook).toBe(false);

    await hoursRepo.replaceStaffHours(ctx, sara, [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }]);
    expect((await getSetupChecklist(ctx)).readyToBook).toBe(true);
  });

  it("goes back to not-ready when a dentist loses all services", async () => {
    const [sara] = await staffRepo.listStaff(ctx);
    await staffRepo.setStaffServices(ctx, sara!.id, []);
    expect(await done()).toMatchObject({ dentistServices: false });
    expect((await getSetupChecklist(ctx)).readyToBook).toBe(false);
  });

  it("ignores inactive dentists and counts only ACTIVE services", async () => {
    const [sara] = await staffRepo.listStaff(ctx);
    await staffRepo.setStaffActive(ctx, sara!.id, false);
    expect(await done()).toMatchObject({ dentists: false });
    await staffRepo.setStaffActive(ctx, sara!.id, true);
    const [svc] = await servicesRepo.listServices(ctx);
    await staffRepo.setStaffServices(ctx, sara!.id, [svc!.id]);
    await servicesRepo.setServiceActive(ctx, svc!.id, false);
    expect(await done()).toMatchObject({ services: false, dentistServices: false });
  });

  it("marks the profile done once address and phone are set", async () => {
    await clinicsRepo.updateClinicProfile(ctx, {
      nameEn: "Fresh", nameAr: "جديدة", addressEn: "King Fahd Rd, Riyadh", addressAr: null,
      phone: "+966512345678", mapsUrl: null, timezone: "Asia/Riyadh",
    });
    expect(await done()).toMatchObject({ profile: true });
  });
});

describe("settings validation", () => {
  const profile = { nameEn: "A", nameAr: "أ", addressEn: "", addressAr: "", phone: "", mapsUrl: "", timezone: "Asia/Riyadh" };

  it("normalises phone spacing and rejects local formats", () => {
    expect(clinicProfileSchema.parse({ ...profile, nameEn: "Ab", nameAr: "أب", phone: "+966 51-234 5678" }).phone).toBe("+966512345678");
    expect(clinicProfileSchema.safeParse({ ...profile, nameEn: "Ab", nameAr: "أب", phone: "0512345678" }).success).toBe(false);
  });

  it("accepts only https map links and known GCC time zones", () => {
    const base = { ...profile, nameEn: "Ab", nameAr: "أب" };
    expect(clinicProfileSchema.safeParse({ ...base, mapsUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(clinicProfileSchema.safeParse({ ...base, timezone: "Europe/London" }).success).toBe(false);
  });

  it("keeps booking rules inside the database's CHECK ranges", () => {
    const ok = { bufferMinutes: "10", minLeadMinutes: "120", maxHorizonDays: "60", changeCutoffMinutes: "120", slotGranularityMinutes: "15" };
    expect(bookingRulesSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ bufferMinutes: "7" }, { maxHorizonDays: "0" }, { slotGranularityMinutes: "25" }, { minLeadMinutes: "-5" }]) {
      expect(bookingRulesSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });
});
