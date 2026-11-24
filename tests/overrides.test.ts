import { beforeAll, describe, expect, it, vi } from "vitest";
import { clinics, staff } from "@/db/schema";
import { clinicDate } from "@/lib/i18n/format";
import { overrideSchema } from "@/lib/validation/override";
import { createTestDb } from "./helpers/db";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));
const repo = await import("@/server/db/repositories/overrides");
type Ctx = Parameters<typeof repo.listOverrides>[0];

let ctxA: Ctx;
let ctxB: Ctx;
let dentistA: string;

const eid = {
  staffId: null,
  type: "closed" as const,
  startDate: "2027-03-20",
  endDate: "2027-03-23",
  labelEn: "Eid al-Fitr",
  labelAr: "عيد الفطر",
  intervals: [],
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
  const [d] = await db.insert(staff).values({ clinicId: a!.id, displayNameEn: "Dr A", displayNameAr: "د" }).returning({ id: staff.id });
  dentistA = d!.id;
});

describe("override validation", () => {
  const form = { staffId: "", type: "custom_hours", startDate: "2027-02-18", endDate: "2027-03-19", labelEn: "", labelAr: "", intervals: [] as unknown[] };

  it("accepts Ramadan hours with an evening shift ending at midnight", () => {
    const v = overrideSchema.parse({ ...form, intervals: [{ startMinute: 600, endMinute: 840 }, { startMinute: 1200, endMinute: 1440 }] });
    expect(v.staffId).toBeNull();
    expect(v.intervals).toHaveLength(2);
  });

  it("requires at least one shift for special hours (DB4) and drops shifts from closures", () => {
    expect(overrideSchema.safeParse(form).error?.issues[0]?.message).toBe("no_intervals");
    const closed = overrideSchema.parse({ ...form, type: "closed", intervals: [{ startMinute: 600, endMinute: 700 }] });
    expect(closed.intervals).toEqual([]);
  });

  it("rejects reversed dates, overlapping shifts and year-plus ranges", () => {
    const msg = (v: object) => overrideSchema.safeParse({ ...form, ...v }).error?.issues.map((i) => i.message);
    expect(msg({ startDate: "2027-03-10", endDate: "2027-03-01", intervals: [{ startMinute: 600, endMinute: 700 }] })).toContain("date_order");
    expect(msg({ intervals: [{ startMinute: 600, endMinute: 800 }, { startMinute: 700, endMinute: 900 }] })).toContain("overlap_intervals");
    expect(msg({ endDate: "2028-06-01", intervals: [{ startMinute: 600, endMinute: 700 }] })).toContain("too_long");
  });
});

describe("overrides repository", () => {
  it("creates a clinic closure, lists it only for its own clinic", async () => {
    expect(await repo.createOverride(ctxA, eid)).toEqual({ ok: true });
    expect((await repo.listOverrides(ctxA)).map((o) => o.labelEn)).toEqual(["Eid al-Fitr"]);
    expect(await repo.listOverrides(ctxB)).toEqual([]);
  });

  it("reports an overlapping clinic closure as 'overlap', not a crash", async () => {
    expect(await repo.createOverride(ctxA, { ...eid, startDate: "2027-03-23", endDate: "2027-03-25" })).toEqual({ ok: false, reason: "overlap" });
  });

  it("lets a dentist's leave share dates with a clinic closure (precedence needs both)", async () => {
    expect(await repo.createOverride(ctxA, { ...eid, staffId: dentistA, labelEn: "Leave" })).toEqual({ ok: true });
  });

  it("stores special-hours shifts with the override", async () => {
    await repo.createOverride(ctxA, {
      ...eid,
      type: "custom_hours",
      startDate: "2027-02-18",
      endDate: "2027-03-19",
      labelEn: "Ramadan",
      intervals: [{ startMinute: 600, endMinute: 840 }, { startMinute: 1200, endMinute: 1440 }],
    });
    const ramadan = (await repo.listOverrides(ctxA)).find((o) => o.labelEn === "Ramadan");
    expect(ramadan?.intervals).toEqual([{ startMinute: 600, endMinute: 840 }, { startMinute: 1200, endMinute: 1440 }]);
  });

  it("refuses another clinic's dentist and another clinic's delete", async () => {
    expect(await repo.createOverride(ctxB, { ...eid, staffId: dentistA })).toEqual({ ok: false, reason: "not_found" });
    const [first] = await repo.listOverrides(ctxA);
    expect(await repo.deleteOverride(ctxB, first!.id)).toBe(false);
    expect(await repo.deleteOverride(ctxA, first!.id)).toBe(true);
  });
});

describe("date display", () => {
  it("shows Gregorian dates with Latin digits in Arabic", () => {
    const ar = clinicDate("ar", "2027-03-20");
    expect(ar).toMatch(/2027/);
    expect(ar).not.toMatch(/[٠-٩]/);
    expect(clinicDate("en", "2027-03-20")).toMatch(/Mar/);
  });
});
