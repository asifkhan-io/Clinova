/**
 * Phase 9b: the audit log is append-only for the role the app runs as.
 *
 * Connects as `clinova_app` (TEST_APP_DATABASE_URL in .env.test, the Neon
 * `test` branch) and proves it can add history but never rewrite or erase it,
 * while ordinary app writes still work. Every write here is rolled back.
 */
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const url = process.env.TEST_APP_DATABASE_URL;
if (!url) {
  throw new Error("TEST_APP_DATABASE_URL is not set. Put the Neon `test` branch URL for role clinova_app in .env.test.");
}
const forbidden = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED, process.env.APP_DATABASE_URL].filter(Boolean) as string[];
if (forbidden.some((u) => new URL(u).hostname.replace("-pooler", "") === new URL(url).hostname.replace("-pooler", ""))) {
  throw new Error("TEST_APP_DATABASE_URL points at the app's own database. Refusing to run.");
}

const u = new URL(url);
u.searchParams.set("sslmode", "verify-full");
const pool = new pg.Pool({ connectionString: u.toString(), max: 2, connectionTimeoutMillis: 20_000 });
afterAll(() => pool.end());

/** Runs fn in a transaction that is always rolled back; returns the Postgres error code, if any. */
async function attempt(fn: (c: pg.PoolClient) => Promise<unknown>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await fn(c);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

describe("audit_log is append-only for the app role", () => {
  it("connects as clinova_app, not as the owner", async () => {
    const { rows } = await pool.query<{ who: string; owner: string }>(
      "select current_user as who, (select tableowner from pg_tables where tablename = 'audit_log') as owner",
    );
    expect(rows[0]!.who).toBe("clinova_app");
    expect(rows[0]!.owner).not.toBe("clinova_app");
  });

  it("can add an audit event", async () => {
    expect(
      await attempt((c) =>
        c.query("insert into audit_log (actor_type, action, entity_type) values ('system', 'test.append_only', 'test')"),
      ),
    ).toBeNull();
  });

  it.each([
    ["rewrite", "update audit_log set action = 'tampered' where true"],
    ["delete", "delete from audit_log where true"],
    ["truncate", "truncate audit_log"],
    ["drop", "drop table audit_log"],
  ])("cannot %s it (42501 permission denied)", async (_, sql) => {
    expect(await attempt((c) => c.query(sql))).toBe("42501");
  });

  it("cannot grant itself the rights back (Postgres ignores it with a warning; the right stays absent)", async () => {
    const c = await pool.connect();
    try {
      await c.query("grant update, delete on audit_log to clinova_app").catch(() => undefined);
      const { rows } = await c.query<{ upd: boolean; del: boolean }>(
        "select has_table_privilege('audit_log', 'UPDATE') as upd, has_table_privilege('audit_log', 'DELETE') as del",
      );
      expect(rows[0]).toEqual({ upd: false, del: false });
    } finally {
      c.release();
    }
  });

  it("still does everything else the app does (reads and writes on the other tables)", async () => {
    expect(
      await attempt(async (c) => {
        await c.query("select count(*) from appointments");
        await c.query("insert into rate_limits (bucket, identifier_hash, window_start, count) values ('test.role', 'x', now(), 1)");
        await c.query("update rate_limits set count = count + 1 where bucket = 'test.role'");
        await c.query("delete from rate_limits where bucket = 'test.role'");
        await c.query("delete from verifications where false");
      }),
    ).toBeNull();
  });
});
