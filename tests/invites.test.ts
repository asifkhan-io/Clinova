/** The invite is the only way into a clinic: it must be single-use, expiring and unguessable. */
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { invites, users } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const testDb = await createTestDb();
vi.mock("@/server/db/client", () => ({ db: testDb.db }));
// The admin actions run behind requirePlatformAdmin; these tests act as the admin.
vi.mock("@/server/auth/guards", () => ({ requirePlatformAdmin: async () => adminCtx }));

const { createClinicWithOwnerInvite, reissueOwnerInvite } =
  await import("@/server/db/repositories/admin-clinics");
const { acceptInvite, findValidInvite } =
  await import("@/server/db/repositories/invites");
const { findActiveMembership } =
  await import("@/server/db/repositories/members");
const { hashToken, newToken } = await import("@/server/services/tokens");

const [admin] = await testDb.db
  .insert(users)
  .values({ name: "Admin", email: "admin@test.local" })
  .returning({ id: users.id });
const adminCtx = { db: testDb.db, userId: admin!.id } as never;

async function newClinic(slug: string, ownerEmail: string) {
  const { token, hash } = newToken();
  const clinic = await createClinicWithOwnerInvite(
    adminCtx,
    { slug, nameEn: slug, nameAr: slug, ownerEmail },
    hash,
  );
  return { clinic, token };
}

describe("owner invites", () => {
  it("stores only the token's hash, never the token", async () => {
    const { token } = await newClinic("hash-check", "h@test.local");
    const stored = await testDb.db
      .select({ tokenHash: invites.tokenHash })
      .from(invites);
    expect(stored.map((s) => s.tokenHash)).not.toContain(token);
    expect(stored.map((s) => s.tokenHash)).toContain(hashToken(token));
  });

  it("creates the owner account and membership, then refuses a second use", async () => {
    const { clinic, token } = await newClinic("single-use", "owner@test.local");
    const first = await acceptInvite({
      tokenHash: hashToken(token),
      name: "Owner",
      passwordHash: "x",
    });
    expect(first).toEqual({ ok: true, email: "owner@test.local" });

    const [owner] = await testDb.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "owner@test.local"));
    await expect(findActiveMembership(owner!.id)).resolves.toMatchObject({
      clinicId: clinic.id,
      role: "clinic_owner",
    });

    const second = await acceptInvite({
      tokenHash: hashToken(token),
      name: "Thief",
      passwordHash: "x",
    });
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses expired and unknown links", async () => {
    const { token } = await newClinic("expired", "late@test.local");
    await testDb.db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invites.tokenHash, hashToken(token)));

    expect(await findValidInvite(hashToken(token))).toBeNull();
    expect(await findValidInvite(hashToken("not-a-real-token"))).toBeNull();
  });

  it("refuses an email that already has an account, and keeps the invite usable", async () => {
    const { token } = await newClinic("taken-email", "owner@test.local");
    const result = await acceptInvite({
      tokenHash: hashToken(token),
      name: "X",
      passwordHash: "x",
    });
    expect(result).toEqual({ ok: false, reason: "account_exists" });
    expect(await findValidInvite(hashToken(token))).not.toBeNull();
  });

  it("kills the old link when a new one is issued", async () => {
    const { clinic, token: oldToken } = await newClinic(
      "reissue",
      "re@test.local",
    );
    const fresh = newToken();
    await reissueOwnerInvite(adminCtx, clinic.id, "re@test.local", fresh.hash);

    expect(await findValidInvite(hashToken(oldToken))).toBeNull();
    expect(await findValidInvite(fresh.hash)).not.toBeNull();
  });

  it("rejects a duplicate public address at the database", async () => {
    await newClinic("dupe-slug", "d1@test.local");
    await expect(newClinic("dupe-slug", "d2@test.local")).rejects.toThrow();
  });
});

describe("creating a clinic for an email that already has an account", () => {
  it("is detected up front, case-insensitively, so no unusable invite is made", async () => {
    const { emailHasAccount } = await import("@/server/db/repositories/admin-clinics");
    expect(await emailHasAccount(adminCtx, "ADMIN@test.local")).toBe(true);
    expect(await emailHasAccount(adminCtx, "brand-new-owner@test.local")).toBe(false);
  });
});

describe("an invite addressed to an email that already has an account", () => {
  it("is flagged when the link is opened, so the page offers Sign in instead of a dead form", async () => {
    // Made directly, the way invites existed before the up-front check.
    const { token } = await newClinic("old-dead-invite", "admin@test.local");
    expect(await findValidInvite(hashToken(token))).toMatchObject({ accountExists: true });
    const { token: ok } = await newClinic("fresh-invite", "fresh-owner@test.local");
    expect(await findValidInvite(hashToken(ok))).toMatchObject({ accountExists: false });
  });

  it("can be re-sent to a different email by the admin; an email with an account is refused", async () => {
    const { reissueInviteAction } = await import("@/server/actions/admin");
    const { clinic } = await newClinic("fix-me", "admin@test.local");
    const form = (ownerEmail: string) => {
      const f = new FormData();
      f.set("clinicId", clinic.id);
      f.set("locale", "en");
      f.set("ownerEmail", ownerEmail);
      return f;
    };
    expect(await reissueInviteAction(null, form("Admin@Test.local"))).toEqual({ ok: false, error: "email_has_account" });
    expect(await reissueInviteAction(null, form("not-an-email"))).toEqual({ ok: false, error: "invalid_input" });

    const result = await reissueInviteAction(null, form("Real.Owner@test.local"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const token = result.data.inviteUrl.split("/invite/")[1]!;
    expect(await findValidInvite(hashToken(token))).toMatchObject({ email: "real.owner@test.local", accountExists: false });
  });
});
