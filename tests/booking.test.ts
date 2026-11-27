/**
 * Phase 5 DoD 2 (book) and 4 (no double booking). The concurrency guarantee is
 * the database's exclusion constraint; here it is proven by racing two inserts
 * at the same slot. A two-connection test against a Neon branch follows in
 * Phase 8 (PGlite is single-connection).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { appointments, auditLog, clinics, patients } from "@/db/schema";
import { bookingSchema, normalisePhone } from "@/lib/validation/booking";
import { createTestDb } from "./helpers/db";
import { expectNoPii } from "./helpers/pii";

const { db } = await createTestDb();
vi.mock("@/server/db/client", () => ({ db }));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const appts = await import("@/server/db/repositories/appointments");
const { createPublicBooking } = await import("@/server/services/booking");
const { localToUtc } = await import("@/server/services/availability/time");
const { hashToken } = await import("@/server/services/tokens");

type Ctx = Parameters<typeof services.listServices>[0];
let ctx: Ctx;
let cleaning: string;
let sara: string;
let omar: string;
const NOW = Date.UTC(2027, 0, 1);
const DATE = "2027-01-03"; // Sunday
const at = (h: number, m = 0) => localToUtc(DATE, h * 60 + m, "Asia/Riyadh")!;
const patient = { fullName: "Noura Ali", phoneE164: "+966512345678" };

beforeAll(async () => {
  const [c] = await db.insert(clinics).values({ slug: "smile", nameEn: "Smile", nameAr: "ابتسامة" }).returning({ id: clinics.id });
  ctx = { db, clinicId: c!.id, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "trial" };
  await clinicsRepo.updateBookingRules(ctx, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 365, changeCutoffMinutes: 0, slotGranularityMinutes: 30 });
  cleaning = (await services.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  sara = (await staffRepo.createStaff(ctx, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  omar = (await staffRepo.createStaff(ctx, { displayNameEn: "Omar", displayNameAr: "عمر", titleEn: null, titleAr: null })).id;
  for (const id of [sara, omar]) await hours.replaceStaffHours(ctx, id, [{ dayOfWeek: 0, startMinute: 540, endMinute: 720 }]);
});

const book = (o: Partial<Parameters<typeof createPublicBooking>[1]> = {}) =>
  createPublicBooking(ctx, { serviceId: cleaning, staffId: sara, startMs: at(9), ...patient, ...o }, NOW);

describe("online booking", () => {
  it("refuses everything while the clinic hasn't switched booking on (D4)", async () => {
    expect(await book()).toEqual({ ok: false, reason: "booking_closed" });
    await clinicsRepo.setBookingEnabled(ctx, true);
  });

  it("books a real free slot, stores only the token's hash, and audits without PII", async () => {
    const r = await book();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db.select().from(appointments).where(eq(appointments.id, r.appointmentId));
    expect(row).toMatchObject({ staffId: sara, status: "booked", source: "online" });
    expect(row!.accessTokenHash).toBe(hashToken(r.token));
    expect(row!.accessTokenHash).not.toBe(r.token);

    const [event] = await db.select().from(auditLog).where(eq(auditLog.entityId, r.appointmentId));
    expect(event!.action).toBe("appointment.created");
    expectNoPii(event!.metadata, "Noura");
  });

  it("refuses the same slot again, and a time that was never offered", async () => {
    expect(await book()).toEqual({ ok: false, reason: "slot_unavailable" });
    expect(await book({ startMs: at(9, 10) })).toEqual({ ok: false, reason: "slot_unavailable" }); // off-grid
    expect(await book({ startMs: at(13) })).toEqual({ ok: false, reason: "slot_unavailable" }); // after hours
  });

  it("'any dentist' takes the one with fewer bookings that day (D9)", async () => {
    const r = await book({ staffId: "any", startMs: at(10) });
    expect(r.ok && r.staffId).toBe(omar); // Sara already has the 09:00
  });

  it("keeps one patient record per phone, and doesn't let a booking rename it", async () => {
    await book({ staffId: sara, startMs: at(11), fullName: "Someone Else" });
    const rows = await db.select().from(patients).where(eq(patients.phoneE164, patient.phoneE164));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe("Noura Ali");
    expect(rows[0]!.consentAt).not.toBeNull();
  });
});

describe("double booking is impossible (DoD 4)", () => {
  it("the database rejects a second overlapping booking that skipped the availability check", async () => {
    const race = (name: string, phone: string) =>
      appts.insertOnlineBooking(ctx, { staffId: sara, serviceId: cleaning, startMs: at(11, 30), endMs: at(12), fullName: name, phoneE164: phone, consentPolicyVersion: "t", accessTokenHash: hashToken(name) });
    const results = await Promise.all([race("first", "+966500000001"), race("second", "+966500000002")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "slot_taken" }]);
    // The losing transaction left nothing behind — not even its patient row.
    expect(await db.select().from(patients).where(eq(patients.phoneE164, "+966500000002"))).toEqual([]);
  });

  it("'any dentist' patients arriving together spill over to the next free dentist (F1)", async () => {
    const r = await Promise.all(
      ["+966522222201", "+966522222202", "+966522222203"].map((phoneE164) => book({ staffId: "any", startMs: at(9, 30), phoneE164 })),
    );
    const won = r.filter((x) => x.ok);
    expect(won).toHaveLength(2); // Sara and Omar are both free at 09:30
    expect(new Set(won.map((x) => (x.ok ? x.staffId : "")))).toEqual(new Set([sara, omar]));
    expect(r.filter((x) => !x.ok)).toEqual([{ ok: false, reason: "slot_taken" }]);
  });

  it("a cancellation frees the slot for the next patient", async () => {
    const [row] = await db.select().from(appointments).where(eq(appointments.startAt, new Date(at(9))));
    await db.update(appointments).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "patient" }).where(eq(appointments.id, row!.id));
    expect((await book({ phoneE164: "+966511111111" })).ok).toBe(true);
  });
});

describe("booking form validation", () => {
  it("accepts Saudi local mobiles and international numbers, rejects junk", () => {
    expect(normalisePhone("05 1234 5678")).toBe("+966512345678");
    expect(normalisePhone("00966512345678")).toBe("+966512345678");
    expect(normalisePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalisePhone("12345")).toBeNull();
  });

  it("requires consent and a real name", () => {
    const base = { serviceId: cleaning, staffId: "any", startMs: String(at(9)), fullName: "Noura", phone: "0512345678", email: "", consent: true };
    expect(bookingSchema.safeParse(base).success).toBe(true);
    expect(bookingSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...base, fullName: "N" }).success).toBe(false);
  });
});
