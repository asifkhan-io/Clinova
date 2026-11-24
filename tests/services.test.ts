import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clinics, services, staff, staffServices } from "@/db/schema";
import { serviceSchema } from "@/lib/validation/service";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));

const repo = await import("@/server/db/repositories/services");
type Ctx = Parameters<typeof repo.listServices>[0];

let ctxA: Ctx;
let ctxB: Ctx;
let activeDentist: string;
let inactiveDentist: string;

const input = {
  nameEn: "Cleaning",
  nameAr: "تنظيف",
  descriptionEn: null,
  descriptionAr: null,
  durationMinutes: 30,
  priceMinor: 15000,
};

beforeAll(async () => {
  const [a, b] = await db
    .insert(clinics)
    .values([
      { slug: "a", nameEn: "A", nameAr: "أ" },
      { slug: "b", nameEn: "B", nameAr: "ب" },
    ])
    .returning({ id: clinics.id });
  const base = { db, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "active" } as const;
  ctxA = { ...base, clinicId: a!.id };
  ctxB = { ...base, clinicId: b!.id };

  const [d1, d2] = await db
    .insert(staff)
    .values([
      { clinicId: a!.id, displayNameEn: "Dr On", displayNameAr: "د" },
      { clinicId: a!.id, displayNameEn: "Dr Off", displayNameAr: "د", isActive: false },
    ])
    .returning({ id: staff.id });
  activeDentist = d1!.id;
  inactiveDentist = d2!.id;
});

describe("services repository", () => {
  it("offers a new service through every active dentist, and no inactive one", async () => {
    const { id } = await repo.createService(ctxA, input);
    const links = await db.select().from(staffServices).where(eq(staffServices.serviceId, id));
    expect(links.map((l) => l.staffId)).toEqual([activeDentist]);
    expect(links.map((l) => l.staffId)).not.toContain(inactiveDentist);
  });

  it("lists only the caller's clinic", async () => {
    await repo.createService(ctxB, { ...input, nameEn: "B only" });
    const seenByA = await repo.listServices(ctxA);
    expect(seenByA.every((s) => s.clinicId === ctxA.clinicId)).toBe(true);
    expect(seenByA.map((s) => s.nameEn)).not.toContain("B only");
  });

  it("refuses to edit or deactivate another clinic's service, even with its id", async () => {
    const { id } = await repo.createService(ctxA, { ...input, nameEn: "Whitening" });

    expect(await repo.updateService(ctxB, id, { ...input, nameEn: "HACKED" })).toBe(false);
    expect(await repo.setServiceActive(ctxB, id, false)).toBe(false);

    const [row] = await db.select().from(services).where(eq(services.id, id));
    expect(row!.nameEn).toBe("Whitening");
    expect(row!.isActive).toBe(true);
  });

  it("edits and deactivates its own service", async () => {
    const { id } = await repo.createService(ctxA, { ...input, nameEn: "Filling" });
    expect(await repo.updateService(ctxA, id, { ...input, nameEn: "Filling (composite)", durationMinutes: 45 })).toBe(true);
    expect(await repo.setServiceActive(ctxA, id, false)).toBe(true);
    const [row] = await db.select().from(services).where(eq(services.id, id));
    expect(row).toMatchObject({ nameEn: "Filling (composite)", durationMinutes: 45, isActive: false });
  });
});

describe("service form validation", () => {
  const form = { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: "", descriptionAr: "", durationMinutes: "30" };

  it("turns riyals into halalas, empty into 'price on request', and keeps free as 0", () => {
    expect(serviceSchema.parse({ ...form, priceMinor: "150" }).priceMinor).toBe(15000);
    expect(serviceSchema.parse({ ...form, priceMinor: "150.5" }).priceMinor).toBe(15050);
    expect(serviceSchema.parse({ ...form, priceMinor: "" }).priceMinor).toBeNull();
    expect(serviceSchema.parse({ ...form, priceMinor: "0" }).priceMinor).toBe(0);
  });

  it("rejects bad prices, durations and a missing Arabic name", () => {
    for (const priceMinor of ["-5", "abc", "1.234"]) {
      expect(serviceSchema.safeParse({ ...form, priceMinor }).success).toBe(false);
    }
    for (const durationMinutes of ["7", "0", "485"]) {
      expect(serviceSchema.safeParse({ ...form, durationMinutes, priceMinor: "" }).success).toBe(false);
    }
    expect(serviceSchema.safeParse({ ...form, nameAr: "", priceMinor: "" }).success).toBe(false);
  });

  it("stores empty descriptions as NULL, not empty strings", () => {
    const v = serviceSchema.parse({ ...form, priceMinor: "" });
    expect(v.descriptionEn).toBeNull();
    expect(v.descriptionAr).toBeNull();
  });
});
