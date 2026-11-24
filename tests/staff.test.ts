import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clinicHours, clinics, services, staff, staffHours, staffServices } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));

const repo = await import("@/server/db/repositories/staff");
type Ctx = Parameters<typeof repo.listStaff>[0];

let ctxA: Ctx;
let ctxB: Ctx;
const svc = {} as Record<"activeA" | "inactiveA" | "otherClinic", string>;
const dr = { displayNameEn: "Dr Sara", displayNameAr: "د. سارة", titleEn: null, titleAr: null };

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

  const [s1, s2, s3] = await db
    .insert(services)
    .values([
      { clinicId: a!.id, nameEn: "Cleaning", nameAr: "تنظيف", durationMinutes: 30 },
      { clinicId: a!.id, nameEn: "Old", nameAr: "قديم", durationMinutes: 30, isActive: false },
      { clinicId: b!.id, nameEn: "B svc", nameAr: "ب", durationMinutes: 30 },
    ])
    .returning({ id: services.id });
  svc.activeA = s1!.id;
  svc.inactiveA = s2!.id;
  svc.otherClinic = s3!.id;

  // Clinic A's template: Sunday split shift.
  await db.insert(clinicHours).values([
    { clinicId: a!.id, dayOfWeek: 0, startMinute: 540, endMinute: 780 },
    { clinicId: a!.id, dayOfWeek: 0, startMinute: 960, endMinute: 1260 },
  ]);
});

describe("dentists repository", () => {
  it("starts a new dentist with all ACTIVE services and the clinic's hours (D5)", async () => {
    const { id } = await repo.createStaff(ctxA, dr);
    const links = await db.select().from(staffServices).where(eq(staffServices.staffId, id));
    expect(links.map((l) => l.serviceId)).toEqual([svc.activeA]);

    const hours = await db.select().from(staffHours).where(eq(staffHours.staffId, id));
    expect(hours.map((h) => [h.dayOfWeek, h.startMinute, h.endMinute]).sort()).toEqual([
      [0, 540, 780],
      [0, 960, 1260],
    ]);
  });

  it("starts a dentist with no hours when the clinic has no template", async () => {
    const { id } = await repo.createStaff(ctxB, dr);
    expect(await db.select().from(staffHours).where(eq(staffHours.staffId, id))).toEqual([]);
  });

  it("lists only the caller's dentists, with the services each performs", async () => {
    const list = await repo.listStaff(ctxA);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.clinicId === ctxA.clinicId)).toBe(true);
    expect(list[0]!.serviceIds).toEqual([svc.activeA]);
  });

  it("refuses to edit, deactivate or re-assign another clinic's dentist", async () => {
    const { id } = await repo.createStaff(ctxA, { ...dr, displayNameEn: "Dr Untouchable" });

    expect(await repo.updateStaff(ctxB, id, { ...dr, displayNameEn: "HACKED" })).toBe(false);
    expect(await repo.setStaffActive(ctxB, id, false)).toBe(false);
    expect(await repo.setStaffServices(ctxB, id, [svc.otherClinic])).toBe(false);

    const [row] = await db.select().from(staff).where(eq(staff.id, id));
    expect(row).toMatchObject({ displayNameEn: "Dr Untouchable", isActive: true });
    const links = await db.select().from(staffServices).where(eq(staffServices.staffId, id));
    expect(links.map((l) => l.serviceId)).toEqual([svc.activeA]);
  });

  it("replaces a dentist's services, silently dropping another clinic's service id", async () => {
    const { id } = await repo.createStaff(ctxA, dr);
    expect(await repo.setStaffServices(ctxA, id, [svc.inactiveA, svc.otherClinic])).toBe(true);
    const links = await db.select().from(staffServices).where(eq(staffServices.staffId, id));
    expect(links.map((l) => l.serviceId)).toEqual([svc.inactiveA]);

    expect(await repo.setStaffServices(ctxA, id, [])).toBe(true);
    expect(await db.select().from(staffServices).where(eq(staffServices.staffId, id))).toEqual([]);
  });

  it("deactivates and reactivates its own dentist", async () => {
    const { id } = await repo.createStaff(ctxA, dr);
    expect(await repo.setStaffActive(ctxA, id, false)).toBe(true);
    expect(await repo.setStaffActive(ctxA, id, true)).toBe(true);
  });
});
