/**
 * Phase 2 definition of done, criteria 5 and 6:
 *   5. Tenant isolation — a member of clinic A can never reach clinic B's rows.
 *   6. Authorization — every role gets exactly what it should, and no more.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clinicMembers, clinics, platformAdmins, users } from "@/db/schema";
import { createTestDb } from "./helpers/db";

const testDb = await createTestDb();

// Repositories and guards import the real Neon client; point them at PGlite.
vi.mock("@/server/db/client", () => ({ db: testDb.db }));

// The guards read the session from request cookies; tests choose who is signed in.
let currentUserId: string | null = null;
vi.mock("@/server/auth/session", () => ({
  getSession: async () =>
    currentUserId ? { user: { id: currentUserId, email: "test@example.com" } } : null,
}));

const { requireClinicAccess, requirePlatformAdmin } = await import("@/server/auth/guards");
const { AuthError } = await import("@/server/auth/errors");
const { getOwnClinic } = await import("@/server/db/repositories/clinics");
const { listClinics } = await import("@/server/db/repositories/admin-clinics");

const ids = {} as Record<
  "clinicA" | "clinicB" | "ownerA" | "staffA" | "ownerB" | "admin" | "outsider" | "formerStaffA",
  string
>;

async function user(name: string) {
  const [u] = await testDb.db
    .insert(users)
    .values({ name, email: `${name}@test.local`, emailVerified: true })
    .returning({ id: users.id });
  return u!.id;
}

async function expectAuthError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AuthError);
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  const [a] = await testDb.db
    .insert(clinics)
    .values({ slug: "clinic-a", nameEn: "Clinic A", nameAr: "عيادة أ" })
    .returning({ id: clinics.id });
  const [b] = await testDb.db
    .insert(clinics)
    .values({ slug: "clinic-b", nameEn: "Clinic B", nameAr: "عيادة ب", status: "suspended" })
    .returning({ id: clinics.id });
  ids.clinicA = a!.id;
  ids.clinicB = b!.id;

  ids.ownerA = await user("owner-a");
  ids.staffA = await user("staff-a");
  ids.ownerB = await user("owner-b");
  ids.admin = await user("admin");
  ids.outsider = await user("outsider");
  ids.formerStaffA = await user("former-staff-a");

  await testDb.db.insert(clinicMembers).values([
    { clinicId: ids.clinicA, userId: ids.ownerA, role: "clinic_owner" },
    { clinicId: ids.clinicA, userId: ids.staffA, role: "clinic_staff" },
    { clinicId: ids.clinicB, userId: ids.ownerB, role: "clinic_owner" },
    { clinicId: ids.clinicA, userId: ids.formerStaffA, role: "clinic_staff", isActive: false },
  ]);
  await testDb.db.insert(platformAdmins).values({ userId: ids.admin });
});

beforeEach(() => {
  currentUserId = null;
});

describe("tenant isolation (DoD 5)", () => {
  it("gives each member a context for their own clinic only", async () => {
    currentUserId = ids.ownerA;
    const ctxA = await requireClinicAccess();
    currentUserId = ids.ownerB;
    const ctxB = await requireClinicAccess();

    expect(ctxA.clinicId).toBe(ids.clinicA);
    expect(ctxB.clinicId).toBe(ids.clinicB);
  });

  it("reads only the context's clinic, never the other one", async () => {
    currentUserId = ids.ownerA;
    const clinicSeenByA = await getOwnClinic(await requireClinicAccess());
    currentUserId = ids.ownerB;
    const clinicSeenByB = await getOwnClinic(await requireClinicAccess());

    expect(clinicSeenByA?.id).toBe(ids.clinicA);
    expect(clinicSeenByA?.nameEn).toBe("Clinic A");
    expect(clinicSeenByB?.id).toBe(ids.clinicB);
  });

  it("takes clinic_id from the membership row, so staff land in their own clinic", async () => {
    currentUserId = ids.staffA;
    const ctx = await requireClinicAccess();
    expect(ctx.clinicId).toBe(ids.clinicA);
    expect(ctx.role).toBe("clinic_staff");
  });
});

describe("authorization (DoD 6)", () => {
  it("rejects requests with no session", async () => {
    await expectAuthError(requireClinicAccess(), "unauthenticated");
    await expectAuthError(requirePlatformAdmin(), "unauthenticated");
  });

  it("rejects a signed-in user who belongs to no clinic", async () => {
    currentUserId = ids.outsider;
    await expectAuthError(requireClinicAccess(), "forbidden");
  });

  it("rejects a member whose access was revoked", async () => {
    currentUserId = ids.formerStaffA;
    await expectAuthError(requireClinicAccess(), "forbidden");
  });

  it("keeps owner-only actions away from staff", async () => {
    currentUserId = ids.staffA;
    await expectAuthError(requireClinicAccess("clinic_owner"), "forbidden");

    currentUserId = ids.ownerA;
    await expect(requireClinicAccess("clinic_owner")).resolves.toMatchObject({
      role: "clinic_owner",
    });
  });

  it("lets a suspended clinic read but not write", async () => {
    currentUserId = ids.ownerB;
    await expect(requireClinicAccess()).resolves.toMatchObject({
      clinicStatus: "suspended",
    });
    await expectAuthError(requireClinicAccess("clinic_staff", { write: true }), "clinic_suspended");
  });

  it("allows platform admin pages only to platform admins", async () => {
    currentUserId = ids.ownerA;
    await expectAuthError(requirePlatformAdmin(), "forbidden");

    currentUserId = ids.admin;
    const adminCtx = await requirePlatformAdmin();
    const all = await listClinics(adminCtx);
    expect(all.map((c) => c.slug).sort()).toEqual(["clinic-a", "clinic-b"]);
  });

  it("gives a platform admin no clinic context, so no route to patient data", async () => {
    currentUserId = ids.admin;
    await expectAuthError(requireClinicAccess(), "forbidden");
  });
});
