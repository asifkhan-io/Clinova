/**
 * Throwaway data for the browser tests. Every run makes its own clinics and
 * users with a unique suffix, so tests never depend on (or damage) a real
 * account, and runs can't collide with each other. cleanup() removes them.
 *
 * Writes the same rows the app would: users + a Better Auth "credential"
 * account (as scripts/create-admin.mjs does), clinic_members, and the
 * clinic's schedule. Never pointed at production: see playwright.config.ts.
 */
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

export const PASSWORD = "e2e-Password-123";

export type Seed = {
  runId: string;
  /** Fully configured, booking on: the patient and staff flows use it. */
  ready: { id: string; slug: string; nameEn: string; nameAr: string; service: { id: string; nameEn: string; nameAr: string }; dentists: { id: string; nameEn: string; nameAr: string }[] };
  /** Empty clinic: the owner sets it up through the UI. */
  fresh: { id: string; slug: string; nameEn: string };
  /** A Pakistani clinic (scope §13): PKR prices, local 03… numbers, no Arabic names at all. */
  pk: { id: string; slug: string; nameEn: string; service: { id: string; nameEn: string }; dentist: { id: string; nameEn: string } };
  users: {
    owner: { email: string; clinic: "ready" };
    staff: { email: string; clinic: "ready" };
    freshOwner: { email: string; clinic: "fresh" };
  };
};

export function connect(url: string) {
  const u = new URL(url);
  if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "verify-full");
  return new pg.Client({ connectionString: u.toString() });
}

async function createUser(db: pg.Client, email: string, name: string, hash: string) {
  const { rows } = await db.query<{ id: string }>(
    "insert into users (name, email, email_verified) values ($1, $2, true) returning id",
    [name, email],
  );
  const id = rows[0]!.id;
  await db.query("insert into accounts (account_id, provider_id, user_id, password) values ($1, 'credential', $2, $3)", [id, id, hash]);
  return id;
}

export async function seed(db: pg.Client, runId: string): Promise<Seed> {
  const hash = await hashPassword(PASSWORD);
  const email = (who: string) => `e2e-${who}-${runId}@example.test`;
  await db.query("BEGIN");
  try {
    const ready = { slug: `e2e-ready-${runId}`, nameEn: `E2E Smile ${runId}`, nameAr: `عيادة ابتسامة ${runId}` };
    const { rows: c1 } = await db.query<{ id: string }>(
      `insert into clinics (slug, name_en, name_ar, address_en, address_ar, phone, booking_enabled,
         buffer_minutes, min_lead_minutes, max_horizon_days, change_cutoff_minutes, slot_granularity_minutes)
       values ($1, $2, $3, 'King Fahd Rd, Riyadh', 'طريق الملك فهد، الرياض', '+966112345678', true, 0, 0, 60, 0, 30) returning id`,
      [ready.slug, ready.nameEn, ready.nameAr],
    );
    const readyId = c1[0]!.id;
    const service = { nameEn: "Cleaning", nameAr: "تنظيف" };
    const { rows: s } = await db.query<{ id: string }>(
      "insert into services (clinic_id, name_en, name_ar, duration_minutes) values ($1, $2, $3, 30) returning id",
      [readyId, service.nameEn, service.nameAr],
    );
    const dentists = [
      { nameEn: "Dr Sara", nameAr: "د. سارة" },
      { nameEn: "Dr Omar", nameAr: "د. عمر" },
    ];
    const dentistRows = [];
    for (const d of dentists) {
      const { rows } = await db.query<{ id: string }>(
        "insert into staff (clinic_id, display_name_en, display_name_ar) values ($1, $2, $3) returning id",
        [readyId, d.nameEn, d.nameAr],
      );
      const staffId = rows[0]!.id;
      dentistRows.push({ id: staffId, ...d });
      await db.query("insert into staff_services (clinic_id, staff_id, service_id) values ($1, $2, $3)", [readyId, staffId, s[0]!.id]);
      // Every day, 08:00–22:00 clinic time, so a free slot exists whenever the tests run.
      for (let day = 0; day < 7; day++) {
        await db.query(
          "insert into staff_hours (clinic_id, staff_id, day_of_week, start_minute, end_minute) values ($1, $2, $3, 480, 1320)",
          [readyId, staffId, day],
        );
      }
    }
    for (let day = 0; day < 7; day++) {
      await db.query("insert into clinic_hours (clinic_id, day_of_week, start_minute, end_minute) values ($1, $2, 480, 1320)", [readyId, day]);
    }

    const pk = { slug: `e2e-pk-${runId}`, nameEn: `E2E Islamabad ${runId}` };
    const { rows: c3 } = await db.query<{ id: string }>(
      `insert into clinics (slug, name_en, name_ar, country, timezone, booking_enabled,
         buffer_minutes, min_lead_minutes, max_horizon_days, change_cutoff_minutes, slot_granularity_minutes)
       values ($1, $2, null, 'PK', 'Asia/Karachi', true, 0, 0, 60, 0, 30) returning id`,
      [pk.slug, pk.nameEn],
    );
    const pkId = c3[0]!.id;
    const pkService = { nameEn: "Scaling" };
    const { rows: ps } = await db.query<{ id: string }>(
      "insert into services (clinic_id, name_en, name_ar, duration_minutes, price_minor) values ($1, $2, null, 30, 150000) returning id",
      [pkId, pkService.nameEn],
    );
    const pkDentist = { nameEn: "Dr Ayesha" };
    const { rows: pd } = await db.query<{ id: string }>(
      "insert into staff (clinic_id, display_name_en, display_name_ar) values ($1, $2, null) returning id",
      [pkId, pkDentist.nameEn],
    );
    await db.query("insert into staff_services (clinic_id, staff_id, service_id) values ($1, $2, $3)", [pkId, pd[0]!.id, ps[0]!.id]);
    for (let day = 0; day < 7; day++) {
      await db.query(
        "insert into staff_hours (clinic_id, staff_id, day_of_week, start_minute, end_minute) values ($1, $2, $3, 480, 1320)",
        [pkId, pd[0]!.id, day],
      );
    }

    const fresh = { slug: `e2e-fresh-${runId}`, nameEn: `E2E Fresh ${runId}` };
    const { rows: c2 } = await db.query<{ id: string }>(
      "insert into clinics (slug, name_en, name_ar) values ($1, $2, $3) returning id",
      [fresh.slug, fresh.nameEn, `عيادة جديدة ${runId}`],
    );
    const freshId = c2[0]!.id;

    const ownerId = await createUser(db, email("owner"), "E2E Owner", hash);
    const staffUserId = await createUser(db, email("staff"), "E2E Staff", hash);
    const freshOwnerId = await createUser(db, email("fresh"), "E2E Fresh Owner", hash);
    await db.query(
      `insert into clinic_members (clinic_id, user_id, role) values
         ($1, $2, 'clinic_owner'), ($1, $3, 'clinic_staff'), ($4, $5, 'clinic_owner')`,
      [readyId, ownerId, staffUserId, freshId, freshOwnerId],
    );
    await db.query("COMMIT");
    return {
      runId,
      ready: { id: readyId, ...ready, service: { id: s[0]!.id, ...service }, dentists: dentistRows },
      fresh: { id: freshId, ...fresh },
      pk: { id: pkId, ...pk, service: { id: ps[0]!.id, ...pkService }, dentist: { id: pd[0]!.id, ...pkDentist } },
      users: {
        owner: { email: email("owner"), clinic: "ready" },
        staff: { email: email("staff"), clinic: "ready" },
        freshOwner: { email: email("fresh"), clinic: "fresh" },
      },
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/** Removes every clinic and user this run created (appointments first: they restrict deletes). */
export async function cleanup(db: pg.Client, runId: string) {
  const clinics = await db.query<{ id: string }>("select id from clinics where slug like $1", [`e2e-%-${runId}`]);
  const ids = clinics.rows.map((r) => r.id);
  if (ids.length) {
    await db.query("delete from appointments where clinic_id = any($1)", [ids]);
    await db.query("delete from audit_log where clinic_id = any($1)", [ids]);
    await db.query("delete from clinics where id = any($1)", [ids]);
  }
  await db.query("delete from users where email like $1", [`e2e-%-${runId}@example.test`]);
}
