/**
 * Phase 4 definition of done (DoD 3): correct for every precedence rule,
 * buffers, lead time, horizon, Ramadan, Eid, split shifts, and Europe/Berlin DST.
 * Pure functions: no database, a fixed clock.
 */
import { describe, expect, it } from "vitest";
import { generateSlots, type BookingRules } from "@/server/services/availability/generate-slots";
import { type Override, resolveDay, type WeeklyInterval } from "@/server/services/availability/resolve-intervals";
import { dayOfWeek, localToUtc, zoneOffsetMinutes } from "@/server/services/availability/time";

const H = (h: number, m = 0) => h * 60 + m;
const SARA = "sara";
const OTHER = "other";

// Sara works Sun–Thu 09:00–13:00 + 16:00–21:00 (Saudi split shift).
const weekly: WeeklyInterval[] = [0, 1, 2, 3, 4].flatMap((dayOfWeek) => [
  { dayOfWeek, startMinute: H(9), endMinute: H(13) },
  { dayOfWeek, startMinute: H(16), endMinute: H(21) },
]);
const ramadan: Override = {
  staffId: null, type: "custom_hours", startDate: "2027-02-08", endDate: "2027-03-09",
  intervals: [{ startMinute: H(20), endMinute: 1440 }, { startMinute: H(10), endMinute: H(14) }],
};
const eid: Override = { staffId: null, type: "closed", startDate: "2027-03-10", endDate: "2027-03-13", intervals: [] };

const resolve = (date: string, overrides: Override[]) =>
  resolveDay({ date, dayOfWeek: dayOfWeek(date), staffId: SARA, weekly, overrides });

describe("D6 precedence — exactly one rule decides each date", () => {
  it("4 · weekly hours on an ordinary Sunday, nothing on Friday", () => {
    expect(resolve("2027-01-03", [])).toEqual({ rule: "weekly", intervals: [{ startMinute: H(9), endMinute: H(13) }, { startMinute: H(16), endMinute: H(21) }] });
    expect(resolve("2027-01-08", []).intervals).toEqual([]); // Friday
  });

  it("3 · clinic special hours REPLACE the week (Ramadan keeps its evening shift)", () => {
    const day = resolve("2027-02-14", [ramadan]);
    expect(day.rule).toBe("clinic_custom");
    expect(day.intervals).toEqual([{ startMinute: H(10), endMinute: H(14) }, { startMinute: H(20), endMinute: 1440 }]);
  });

  it("3 · clinic special hours apply even on a day the dentist normally rests", () => {
    expect(resolve("2027-02-12", [ramadan]).rule).toBe("clinic_custom"); // Friday in Ramadan
  });

  it("2 · a dentist's own special hours beat the clinic's", () => {
    const mine: Override = { staffId: SARA, type: "custom_hours", startDate: "2027-02-14", endDate: "2027-02-14", intervals: [{ startMinute: H(12), endMinute: H(15) }] };
    expect(resolve("2027-02-14", [ramadan, mine])).toEqual({ rule: "staff_custom", intervals: [{ startMinute: H(12), endMinute: H(15) }] });
  });

  it("1 · a dentist's leave beats every kind of hours", () => {
    const leave: Override = { staffId: SARA, type: "closed", startDate: "2027-02-14", endDate: "2027-02-20", intervals: [] };
    const mine: Override = { staffId: SARA, type: "custom_hours", startDate: "2027-02-14", endDate: "2027-02-14", intervals: [{ startMinute: H(12), endMinute: H(15) }] };
    expect(resolve("2027-02-15", [ramadan, leave, mine]).rule).toBe("staff_closed");
  });

  it("0 · a clinic closure beats everything, including a dentist's special hours", () => {
    const mine: Override = { staffId: SARA, type: "custom_hours", startDate: "2027-03-11", endDate: "2027-03-11", intervals: [{ startMinute: H(9), endMinute: H(12) }] };
    expect(resolve("2027-03-11", [eid, mine])).toEqual({ rule: "clinic_closed", intervals: [] });
  });

  it("ignores another dentist's overrides and uses inclusive date ranges", () => {
    const theirLeave: Override = { staffId: OTHER, type: "closed", startDate: "2027-01-03", endDate: "2027-01-03", intervals: [] };
    expect(resolve("2027-01-03", [theirLeave]).rule).toBe("weekly");
    expect(resolve("2027-03-13", [eid]).rule).toBe("clinic_closed"); // last day included
    expect(resolve("2027-03-14", [eid]).rule).toBe("weekly"); // day after: normal Sunday
  });
});

const rules: BookingRules = { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 365, slotGranularityMinutes: 15 };
const NOW = Date.UTC(2027, 0, 1); // 1 Jan 2027, far before every test date
const riyadh = (date: string, minutes: number) => localToUtc(date, minutes, "Asia/Riyadh")!;
const startsAt = (slots: { startMs: number }[], date: string, tz = "Asia/Riyadh") =>
  slots.map((s) => {
    const local = s.startMs + zoneOffsetMinutes(s.startMs, tz) * 60_000;
    expect(new Date(local).toISOString().slice(0, 10)).toBe(date);
    return new Date(local).toISOString().slice(11, 16);
  });

describe("slot generation", () => {
  const gen = (o: Partial<Parameters<typeof generateSlots>[0]>) =>
    generateSlots({ date: "2027-01-03", timeZone: "Asia/Riyadh", intervals: [{ startMinute: H(9), endMinute: H(11) }], serviceMinutes: 30, rules, busy: [], nowMs: NOW, ...o });

  it("fills an interval at the granularity, and the whole appointment must fit", () => {
    expect(startsAt(gen({}), "2027-01-03")).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30"]);
  });

  it("aligns starts to the interval, not the clock (DB2)", () => {
    expect(startsAt(gen({ intervals: [{ startMinute: H(10, 10), endMinute: H(11) }] }), "2027-01-03")).toEqual(["10:10", "10:25"]);
  });

  it("offers both halves of a split shift and nothing in the gap", () => {
    const s = startsAt(gen({ intervals: [{ startMinute: H(9), endMinute: H(10) }, { startMinute: H(16), endMinute: H(17) }], serviceMinutes: 60 }), "2027-01-03");
    expect(s).toEqual(["09:00", "16:00"]);
  });

  it("converts Riyadh (UTC+3, no DST) local times to the right UTC instants", () => {
    const [first] = gen({});
    expect(new Date(first!.startMs).toISOString()).toBe("2027-01-03T06:00:00.000Z");
  });

  it("Ramadan: a shift ending at 24:00 offers its last slot at 23:30", () => {
    const s = startsAt(gen({ date: "2027-02-14", intervals: [{ startMinute: H(23), endMinute: 1440 }] }), "2027-02-14");
    expect(s).toEqual(["23:00", "23:15", "23:30"]);
  });

  it("removes slots overlapping a booking, and keeps the buffer clear around it", () => {
    const busy = [{ startMs: riyadh("2027-01-03", H(10)), endMs: riyadh("2027-01-03", H(10, 30)) }];
    expect(startsAt(gen({ busy }), "2027-01-03")).toEqual(["09:00", "09:15", "09:30", "10:30"]);
    const buffered = gen({ busy, rules: { ...rules, bufferMinutes: 15 } });
    // 15-minute buffer keeps 09:45–10:45 clear; 10:45 itself would end after the shift.
    expect(startsAt(buffered, "2027-01-03")).toEqual(["09:00", "09:15"]);
  });

  it("enforces minimum notice and the booking horizon", () => {
    const now = riyadh("2027-01-03", H(9, 20));
    expect(startsAt(gen({ nowMs: now, rules: { ...rules, minLeadMinutes: 60 } }), "2027-01-03")).toEqual(["10:30"]);
    expect(gen({ nowMs: riyadh("2026-12-01", 0), rules: { ...rules, maxHorizonDays: 30 } })).toEqual([]);
  });

  it("returns nothing when the service is longer than every interval", () => {
    expect(gen({ serviceMinutes: 180 })).toEqual([]);
  });
});

describe("daylight saving (Europe/Berlin) — free correctness for the next market", () => {
  const berlin = (date: string, intervals: { startMinute: number; endMinute: number }[]) =>
    generateSlots({ date, timeZone: "Europe/Berlin", intervals, serviceMinutes: 30, rules: { ...rules, slotGranularityMinutes: 30 }, busy: [], nowMs: NOW });

  it("skips the hour that does not exist when clocks spring forward (28 Mar 2027)", () => {
    expect(localToUtc("2027-03-28", H(2, 30), "Europe/Berlin")).toBeNull();
    const s = startsAt(berlin("2027-03-28", [{ startMinute: H(1), endMinute: H(4) }]), "2027-03-28", "Europe/Berlin");
    expect(s).not.toContain("02:00");
    expect(s).not.toContain("02:30");
    expect(s).toEqual(["01:00", "03:00", "03:30"]);
  });

  it("uses the right offset on each side of the change", () => {
    expect(new Date(localToUtc("2027-03-27", H(9), "Europe/Berlin")!).toISOString()).toBe("2027-03-27T08:00:00.000Z"); // CET
    expect(new Date(localToUtc("2027-03-29", H(9), "Europe/Berlin")!).toISOString()).toBe("2027-03-29T07:00:00.000Z"); // CEST
  });

  it("gives a slot that spans the autumn change its true length (31 Oct 2027)", () => {
    const [slot] = berlin("2027-10-31", [{ startMinute: H(2), endMinute: H(3) }]);
    expect(slot).toBeDefined();
    expect(new Date(slot!.startMs).toISOString()).toBe("2027-10-31T00:00:00.000Z"); // first 02:00, still CEST
  });
});
