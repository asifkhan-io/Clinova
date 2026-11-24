import { TransactionRollbackError, and, eq, gt, isNull, sql } from "drizzle-orm";
import { accounts, clinicMembers, clinics, invites, users } from "../../../db/schema";
import { db } from "../client";

// Token-based and pre-session: the invite token IS the authorization here,
// which is why every lookup goes through its hash and checks expiry + single use.

export async function findValidInvite(tokenHash: string) {
  const rows = await db
    .select({
      email: invites.email,
      role: invites.role,
      clinicNameEn: clinics.nameEn,
      clinicNameAr: clinics.nameAr,
    })
    .from(invites)
    .innerJoin(clinics, eq(clinics.id, invites.clinicId))
    .where(
      and(
        eq(invites.tokenHash, tokenHash),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type AcceptResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "account_exists" };

/**
 * Claims the invite and creates the account + membership in ONE transaction.
 * The UPDATE … WHERE accepted_at IS NULL is the single-use guarantee: two
 * concurrent submissions of the same link cannot both claim it.
 *
 * Writes the same rows Better Auth's sign-up would (users + a "credential"
 * account with the password hash). Public sign-up is disabled, so this and
 * scripts/create-admin.mjs are the only ways an account is created.
 */
export async function acceptInvite(input: {
  tokenHash: string;
  name: string;
  passwordHash: string;
}): Promise<AcceptResult> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .update(invites)
      .set({ acceptedAt: sql`now()` })
      .where(
        and(
          eq(invites.tokenHash, input.tokenHash),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: invites.id, clinicId: invites.clinicId, email: invites.email, role: invites.role });
    if (!invite) return { ok: false, reason: "invalid" } as const;

    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, invite.email.toLowerCase()))
      .limit(1);
    if (existing.length > 0) {
      // MVP: an invite creates a new account. Linking an existing account to a
      // second clinic needs a sign-in-then-accept flow; until then, refuse and
      // roll back so the invite stays usable.
      tx.rollback();
    }

    const [user] = await tx
      .insert(users)
      .values({ name: input.name, email: invite.email.toLowerCase(), emailVerified: true })
      .returning({ id: users.id });
    if (!user) throw new Error("user insert returned no row");

    await tx.insert(accounts).values({
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: input.passwordHash,
    });
    await tx.insert(clinicMembers).values({
      clinicId: invite.clinicId,
      userId: user.id,
      role: invite.role,
    });
    await tx
      .update(invites)
      .set({ acceptedByUserId: user.id })
      .where(eq(invites.id, invite.id));

    return { ok: true, email: invite.email } as const;
  }).catch((error: unknown) => {
    // tx.rollback() throws a TransactionRollbackError by design.
    if (error instanceof TransactionRollbackError) {
      return { ok: false, reason: "account_exists" } as const;
    }
    throw error;
  });
}
