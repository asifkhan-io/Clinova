/**
 * Phase 8e — Definition of Done 4, against a real Postgres with real concurrency.
 *
 * The unit tests run on PGlite, which is one connection: "simultaneous" requests
 * there are really queued, so they can never prove the exclusion constraint
 * under load. Here several requests hit the same slot through separate pool
 * connections at once, via the real createPublicBooking (availability check,
 * patient upsert, appointment insert, audit row), and the database must let
 * exactly one through.
 *
 * Runs only against the disposable Neon `test` branch (TEST_DATABASE_URL in
 * .env.test). It creates its own clinic with a unique slug and removes it
 * afterwards, so it touches no other rows. See tests/integration/README.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { appointments, auditLog, clinics, patients } from "@/db/schema";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL is not set. Put the Neon `test` branch URL in .env.test (gitignored).");
}
// A shell that still exports the production URL must never reach it from here.
const forbidden = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].filter(Boolean) as string[];
if (forbidden.some((u) => new URL(u).hostname === new URL(url).hostname)) {
  throw new Error("TEST_DATABASE_URL points at the same database as DATABASE_URL. Refusing to run.");
}

const connectionString = (() => {
  const u = new URL(url);
  u.searchParams.set("sslmode", "verify-full"); // same strictness as server/db/client.ts
  return u.toString();
})();
const POOL_SIZE = 12;
const pool = new Pool({ connectionString, max: POOL_SIZE, connectionTimeoutMillis: 20_000, statement_timeout: 30_000 });
const db = drizzle(pool, { schema });
vi.mock("@/server/db/client", () => ({ db }));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const clinicsRepo = await import("@/server/db/repositories/clinics");
const { createPublicBooking } = await import("@/server/services/booking");
const { localToUtc } = await import("@/server/services/availability/time");

type Ctx = Parameters<typeof services.listServices>[0];
let ctx: Ctx;
let clinicId: string;
let cleaning: string;
let sara: string;
let omar: string;

const NOW = Date.UTC(2027, 0, 1);
const DATE = "2027-01-03"; // a Sunday
const at = (h: number, m = 0) => localToUtc(DATE, h * 60 + m, "Asia/Riyadh")!;
const slug = `race-${Date.now().toString(36)}`;
let phoneSeq = 0;
const nextPhone = () => `+9665${String(70_000_000 + ++phoneSeq).padStart(8, "0")}`;

/** Everyone books at the same moment: open all connections first, then fire. */
async function raceFor(startMs: number, staffId: string, contenders: number) {
  await Promise.all(Array.from({ length: POOL_SIZE }, () => pool.query("select 1")));
  const phones = Array.from({ length: contenders }, nextPhone);
  const results = await Promise.all(
    phones.map((phoneE164, i) =>
      createPublicBooking(ctx, { serviceId: cleaning, staffId, startMs, fullName: `Racer ${i}`, phoneE164 }, NOW),
    ),
  );
  return { phones, results };
}

const outcomes = { slot_taken: 0, slot_unavailable: 0 };
function tally(results: Awaited<ReturnType<typeof raceFor>>["results"]) {
  for (const r of results) if (!r.ok && (r.reason === "slot_taken" || r.reason === "slot_unavailable")) outcomes[r.reason]++;
}

beforeAll(async () => {
  const [c] = await db.insert(clinics).values({ slug, nameEn: "Race clinic", nameAr: "عيادة السباق" }).returning({ id: clinics.id });
  clinicId = c!.id;
  ctx = { db, clinicId, userId: "00000000-0000-0000-0000-000000000000", role: "clinic_owner", clinicStatus: "trial" };
  await clinicsRepo.updateBookingRules(ctx, { bufferMinutes: 0, minLeadMinutes: 0, maxHorizonDays: 365, changeCutoffMinutes: 0, slotGranularityMinutes: 30 });
  await clinicsRepo.setBookingEnabled(ctx, true);
  cleaning = (await services.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  sara = (await staffRepo.createStaff(ctx, { displayNameEn: "Sara", displayNameAr: "سارة", titleEn: null, titleAr: null })).id;
  omar = (await staffRepo.createStaff(ctx, { displayNameEn: "Omar", displayNameAr: "عمر", titleEn: null, titleAr: null })).id;
  // Sundays 09:00–12:00 for both: six half-hour slots each.
  for (const id of [sara, omar]) await hours.replaceStaffHours(ctx, id, [{ dayOfWeek: 0, startMinute: 540, endMinute: 720 }]);
});

afterAll(async () => {
  console.info(`[race] refusals by layer — database constraint: ${outcomes.slot_taken}, availability check: ${outcomes.slot_unavailable}`);
  try {
    // Order matters: appointments restrict-reference patients, staff and services.
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(auditLog).where(eq(auditLog.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId)); // cascades patients, staff, services, hours
  } catch (error) {
    console.warn(`[race] cleanup of clinic ${slug} failed; the branch is disposable, reset it from dev.`, error);
  } finally {
    await pool.end();
  }
});

describe("many patients, one slot (DoD 4)", () => {
  for (const [h, m] of [[9, 0], [9, 30], [10, 0], [10, 30]] as const) {
    it(`exactly one of six simultaneous bookings wins ${h}:${String(m).padStart(2, "0")} with one dentist`, async () => {
      const { phones, results } = await raceFor(at(h, m), sara, 6);
      tally(results);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      for (const r of results) if (!r.ok) expect(["slot_taken", "slot_unavailable"]).toContain(r.reason);

      // The database agrees with what the callers were told.
      const rows = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.clinicId, clinicId), eq(appointments.staffId, sara), eq(appointments.startAt, new Date(at(h, m))), eq(appointments.status, "booked")));
      expect(rows).toHaveLength(1);

      // Losers left nothing behind, not even a patient row.
      const loserPhones = phones.filter((_, i) => !results[i]!.ok);
      expect(await db.select({ id: patients.id }).from(patients).where(and(eq(patients.clinicId, clinicId), inArray(patients.phoneE164, loserPhones)))).toEqual([]);
    });
  }

  for (const [h, m] of [[11, 0], [11, 30]] as const) {
    it(`"any dentist" never double-books ${h}:${String(m).padStart(2, "0")} when three patients arrive together`, async () => {
      const { results } = await raceFor(at(h, m), "any", 3);
      tally(results);

      const won = results.filter((r) => r.ok);
      // Two dentists are free, so at most two patients can fit, each with a different dentist.
      expect(won.length).toBeGreaterThanOrEqual(1);
      expect(won.length).toBeLessThanOrEqual(2);
      const staffIds = won.map((r) => (r.ok ? r.staffId : ""));
      expect(new Set(staffIds).size).toBe(won.length);
      for (const id of staffIds) expect([sara, omar]).toContain(id);
      for (const r of results) if (!r.ok) expect(["slot_taken", "slot_unavailable"]).toContain(r.reason);
    });
  }

  // Finding F1 (found by this file, 2026-11-27). With "any dentist", every patient
  // in the same instant is given the SAME dentist (fewest bookings, then a stable
  // order), so two of three are refused with slot_taken although the other dentist
  // is free. Nobody is double-booked; the patient just has to pick again. Fix to
  // propose: on slot_taken for "any", retry with the next free dentist.
  it.todo('"any dentist": simultaneous patients spill over to the next free dentist instead of being refused');

  it("never leaves two live appointments overlapping for one dentist", async () => {
    const live = await db
      .select({ staffId: appointments.staffId, startAt: appointments.startAt, endAt: appointments.endAt })
      .from(appointments)
      .where(and(eq(appointments.clinicId, clinicId), inArray(appointments.status, ["booked", "completed"])));
    for (const a of live) {
      const clashes = live.filter((b) => b !== a && b.staffId === a.staffId && b.startAt < a.endAt && a.startAt < b.endAt);
      expect(clashes).toEqual([]);
    }
  });
});
