import { beforeAll, describe, expect, it, vi } from "vitest";
import { clinics, staff } from "@/db/schema";
import { formatTimeInput, parseTime, weekSchema } from "@/lib/validation/hours";
import { clinicMinutes, weekdayName } from "@/lib/i18n/format";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
const repo = await import("@/server/db/repositories/hours");
type Ctx = Parameters<typeof repo.listClinicHours>[0];

let ctxA: Ctx;
let ctxB: Ctx;
let dentistA: string;

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
  const [d] = await db
    .insert(staff)
    .values({ clinicId: a!.id, displayNameEn: "Dr A", displayNameAr: "د" })
    .returning({ id: staff.id });
  dentistA = d!.id;
});

describe("time helpers", () => {
  it("parses HH:MM to minutes, with 00:00 as an END meaning 24:00", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("00:00", true)).toBe(1440);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:30")).toBeNull();
    expect(formatTimeInput(570)).toBe("09:30");
    expect(formatTimeInput(1440)).toBe("00:00");
  });

  it("names Sunday as day 0 and shows Latin digits in Arabic", () => {
    expect(weekdayName("en", 0)).toBe("Sunday");
    expect(weekdayName("en", 4)).toBe("Thursday");
    expect(clinicMinutes("ar", 570)).toMatch(/9:30/);
    expect(clinicMinutes("ar", 570)).not.toMatch(/[٠-٩]/);
  });
});

describe("week validation", () => {
  it("accepts a Saudi split shift and a shift ending at midnight", () => {
    const ok = weekSchema.safeParse([
      { dayOfWeek: 0, startMinute: 600, endMinute: 840 },
      { dayOfWeek: 0, startMinute: 1020, endMinute: 1320 },
      { dayOfWeek: 1, startMinute: 1200, endMinute: 1440 },
    ]);
    expect(ok.success).toBe(true);
  });

  it("accepts back-to-back shifts but rejects overlapping ones", () => {
    expect(
      weekSchema.safeParse([
        { dayOfWeek: 2, startMinute: 540, endMinute: 780 },
        { dayOfWeek: 2, startMinute: 780, endMinute: 1020 },
      ]).success,
    ).toBe(true);
    const bad = weekSchema.safeParse([
      { dayOfWeek: 2, startMinute: 540, endMinute: 800 },
      { dayOfWeek: 2, startMinute: 780, endMinute: 1020 },
    ]);
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.some((i) => i.message === "overlap")).toBe(true);
  });

  it("rejects an end before its start and impossible days", () => {
    expect(weekSchema.safeParse([{ dayOfWeek: 0, startMinute: 900, endMinute: 600 }]).success).toBe(false);
    expect(weekSchema.safeParse([{ dayOfWeek: 7, startMinute: 600, endMinute: 900 }]).success).toBe(false);
  });
});

describe("hours repository", () => {
  const week = [
    { dayOfWeek: 0, startMinute: 600, endMinute: 840 },
    { dayOfWeek: 0, startMinute: 1020, endMinute: 1320 },
    { dayOfWeek: 4, startMinute: 540, endMinute: 1020 },
  ];

  it("replaces the clinic week whole, and only for the caller's clinic", async () => {
    await repo.replaceClinicHours(ctxA, week);
    await repo.replaceClinicHours(ctxB, [{ dayOfWeek: 3, startMinute: 600, endMinute: 700 }]);
    expect(await repo.listClinicHours(ctxA)).toEqual(week);

    await repo.replaceClinicHours(ctxA, [week[2]!]);
    expect(await repo.listClinicHours(ctxA)).toEqual([week[2]]);
    expect(await repo.listClinicHours(ctxB)).toHaveLength(1);
  });

  it("saves a dentist's week and refuses another clinic's dentist", async () => {
    expect(await repo.replaceStaffHours(ctxA, dentistA, week)).toBe(true);
    expect((await repo.listStaffHours(ctxA)).get(dentistA)).toEqual(week);

    expect(await repo.replaceStaffHours(ctxB, dentistA, [])).toBe(false);
    expect((await repo.listStaffHours(ctxA)).get(dentistA)).toEqual(week);
    expect((await repo.listStaffHours(ctxB)).size).toBe(0);
  });

  it("rolls back the whole save if the database rejects an overlap", async () => {
    const before = (await repo.listStaffHours(ctxA)).get(dentistA);
    await expect(
      repo.replaceStaffHours(ctxA, dentistA, [
        { dayOfWeek: 5, startMinute: 540, endMinute: 800 },
        { dayOfWeek: 5, startMinute: 780, endMinute: 1020 }, // bypassing validation on purpose
      ]),
    ).rejects.toThrow();
    expect((await repo.listStaffHours(ctxA)).get(dentistA)).toEqual(before);
  });
});
