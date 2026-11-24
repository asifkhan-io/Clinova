/**
 * Phase 3 schema guarantees, enforced by the DATABASE rather than by app code
 * (database-design.md §6 composite FKs, §7 exclusion constraints). If any of
 * these ever pass a bad row, a bug elsewhere can corrupt a clinic's schedule.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  clinicHours,
  clinics,
  scheduleOverrideIntervals,
  scheduleOverrides,
  services,
  staff,
  staffHours,
  staffServices,
} from "@/db/schema";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
const ids = {} as Record<"clinicA" | "clinicB" | "dentistA" | "dentistB" | "serviceA" | "serviceB", string>;

beforeAll(async () => {
  const [a, b] = await db
    .insert(clinics)
    .values([
      { slug: "a", nameEn: "A", nameAr: "أ" },
      { slug: "b", nameEn: "B", nameAr: "ب" },
    ])
    .returning({ id: clinics.id });
  ids.clinicA = a!.id;
  ids.clinicB = b!.id;

  const [dA, dB] = await db
    .insert(staff)
    .values([
      { clinicId: ids.clinicA, displayNameEn: "Dr A", displayNameAr: "د. أ" },
      { clinicId: ids.clinicB, displayNameEn: "Dr B", displayNameAr: "د. ب" },
    ])
    .returning({ id: staff.id });
  ids.dentistA = dA!.id;
  ids.dentistB = dB!.id;

  const [sA, sB] = await db
    .insert(services)
    .values([
      { clinicId: ids.clinicA, nameEn: "Cleaning", nameAr: "تنظيف", durationMinutes: 30 },
      { clinicId: ids.clinicB, nameEn: "Cleaning", nameAr: "تنظيف", durationMinutes: 30 },
    ])
    .returning({ id: services.id });
  ids.serviceA = sA!.id;
  ids.serviceB = sB!.id;
});

describe("cross-tenant writes are impossible (composite foreign keys)", () => {
  it("links a dentist to a service in the same clinic", async () => {
    await expect(
      db.insert(staffServices).values({ clinicId: ids.clinicA, staffId: ids.dentistA, serviceId: ids.serviceA }),
    ).resolves.toBeDefined();
  });

  it("refuses to link clinic A's dentist to clinic B's service", async () => {
    await expect(
      db.insert(staffServices).values({ clinicId: ids.clinicA, staffId: ids.dentistA, serviceId: ids.serviceB }),
    ).rejects.toThrow();
  });

  it("refuses working hours that claim clinic A for clinic B's dentist", async () => {
    await expect(
      db.insert(staffHours).values({
        clinicId: ids.clinicA,
        staffId: ids.dentistB,
        dayOfWeek: 0,
        startMinute: 540,
        endMinute: 1020,
      }),
    ).rejects.toThrow();
  });

  it("refuses a leave override pointing at another clinic's dentist", async () => {
    await expect(
      db.insert(scheduleOverrides).values({
        clinicId: ids.clinicA,
        staffId: ids.dentistB,
        startDate: "2027-01-01",
        endDate: "2027-01-02",
        type: "closed",
      }),
    ).rejects.toThrow();
  });
});

describe("working hours", () => {
  it("accepts split shifts and back-to-back intervals", async () => {
    await expect(
      db.insert(staffHours).values([
        // Saudi split shift: 10:00-14:00 and 17:00-22:00
        { clinicId: ids.clinicA, staffId: ids.dentistA, dayOfWeek: 1, startMinute: 600, endMinute: 840 },
        { clinicId: ids.clinicA, staffId: ids.dentistA, dayOfWeek: 1, startMinute: 1020, endMinute: 1320 },
        // back-to-back ([) ranges): 08:00-10:00 touches 10:00 without overlapping
        { clinicId: ids.clinicA, staffId: ids.dentistA, dayOfWeek: 1, startMinute: 480, endMinute: 600 },
      ]),
    ).resolves.toBeDefined();
  });

  it("refuses overlapping intervals for the same dentist and day", async () => {
    await expect(
      db.insert(staffHours).values({
        clinicId: ids.clinicA,
        staffId: ids.dentistA,
        dayOfWeek: 1,
        startMinute: 780, // 13:00, inside 10:00-14:00
        endMinute: 900,
      }),
    ).rejects.toThrow();
  });

  it("accepts a shift ending at 24:00 (1440) for late Ramadan hours", async () => {
    await expect(
      db.insert(clinicHours).values({ clinicId: ids.clinicA, dayOfWeek: 2, startMinute: 1200, endMinute: 1440 }),
    ).resolves.toBeDefined();
  });

  it("refuses impossible times and weekdays", async () => {
    await expect(
      db.insert(clinicHours).values({ clinicId: ids.clinicA, dayOfWeek: 3, startMinute: 1300, endMinute: 1500 }),
    ).rejects.toThrow();
    await expect(
      db.insert(clinicHours).values({ clinicId: ids.clinicA, dayOfWeek: 3, startMinute: 600, endMinute: 600 }),
    ).rejects.toThrow();
    await expect(
      db.insert(clinicHours).values({ clinicId: ids.clinicA, dayOfWeek: 7, startMinute: 600, endMinute: 700 }),
    ).rejects.toThrow();
  });
});

describe("schedule overrides", () => {
  it("lets a clinic-wide override and a dentist override share dates (precedence needs both)", async () => {
    await db.insert(scheduleOverrides).values({
      clinicId: ids.clinicA,
      startDate: "2027-03-01",
      endDate: "2027-03-30",
      type: "custom_hours",
      labelEn: "Ramadan hours",
    });
    await expect(
      db.insert(scheduleOverrides).values({
        clinicId: ids.clinicA,
        staffId: ids.dentistA,
        startDate: "2027-03-10",
        endDate: "2027-03-12",
        type: "closed",
      }),
    ).resolves.toBeDefined();
  });

  it("refuses two clinic-wide overrides on overlapping dates", async () => {
    await expect(
      db.insert(scheduleOverrides).values({
        clinicId: ids.clinicA,
        startDate: "2027-03-30", // inclusive end of Ramadan above
        endDate: "2027-04-02",
        type: "closed",
      }),
    ).rejects.toThrow();
  });

  it("refuses an end date before the start date", async () => {
    await expect(
      db.insert(scheduleOverrides).values({
        clinicId: ids.clinicB,
        startDate: "2027-05-02",
        endDate: "2027-05-01",
        type: "closed",
      }),
    ).rejects.toThrow();
  });

  it("accepts Ramadan's two intervals but refuses overlapping ones", async () => {
    const [o] = await db
      .insert(scheduleOverrides)
      .values({ clinicId: ids.clinicB, startDate: "2027-03-01", endDate: "2027-03-30", type: "custom_hours" })
      .returning({ id: scheduleOverrides.id });
    await expect(
      db.insert(scheduleOverrideIntervals).values([
        { overrideId: o!.id, startMinute: 600, endMinute: 840 }, // 10:00-14:00
        { overrideId: o!.id, startMinute: 1200, endMinute: 1440 }, // 20:00-24:00
      ]),
    ).resolves.toBeDefined();
    await expect(
      db.insert(scheduleOverrideIntervals).values({ overrideId: o!.id, startMinute: 800, endMinute: 900 }),
    ).rejects.toThrow();
  });
});

describe("services", () => {
  it("allows 'price on request' (NULL) and free (0), refuses negative prices", async () => {
    await expect(
      db.insert(services).values([
        { clinicId: ids.clinicA, nameEn: "Consult", nameAr: "استشارة", durationMinutes: 15, priceMinor: null },
        { clinicId: ids.clinicA, nameEn: "Check", nameAr: "فحص", durationMinutes: 15, priceMinor: 0 },
      ]),
    ).resolves.toBeDefined();
    await expect(
      db.insert(services).values({ clinicId: ids.clinicA, nameEn: "X", nameAr: "س", durationMinutes: 15, priceMinor: -1 }),
    ).rejects.toThrow();
  });

  it("refuses durations that are not 5-minute steps between 5 and 480", async () => {
    for (const durationMinutes of [7, 0, 485]) {
      await expect(
        db.insert(services).values({ clinicId: ids.clinicA, nameEn: "X", nameAr: "س", durationMinutes }),
      ).rejects.toThrow();
    }
  });
});
