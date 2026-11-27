import { COUNTRIES, type CountryCode } from "../../../lib/countries";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { clinicMembers, clinics, invites, users } from "../../../db/schema";
import type { AdminContext } from "./context";

// Platform-admin operations. They take an AdminContext, which only
// requirePlatformAdmin() can build. Clinic records only — no patient tables.

const INVITE_TTL_DAYS = 7;
const TRIAL_DAYS = 30;

/**
 * An invite always creates a NEW account (an existing account can't accept one
 * in the MVP), so creating a clinic for an email that already has an account
 * would produce an invite that can never be used. Checked up front.
 */
export async function emailHasAccount(ctx: AdminContext, email: string) {
  const rows = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

export async function listClinics(ctx: AdminContext) {
  // Three small queries merged in code, rather than correlated subqueries:
  // a platform has tens of clinics, and typed builder queries beat raw SQL here.
  const [rows, owners, pending] = await Promise.all([
    ctx.db
      .select({
        id: clinics.id,
        slug: clinics.slug,
        nameEn: clinics.nameEn,
        nameAr: clinics.nameAr,
        country: clinics.country,
        status: clinics.status,
        createdAt: clinics.createdAt,
      })
      .from(clinics)
      .orderBy(desc(clinics.createdAt)),
    ctx.db
      .select({ clinicId: clinicMembers.clinicId, email: users.email })
      .from(clinicMembers)
      .innerJoin(users, eq(users.id, clinicMembers.userId))
      .where(
        and(eq(clinicMembers.role, "clinic_owner"), eq(clinicMembers.isActive, true)),
      )
      .orderBy(asc(clinicMembers.createdAt)),
    ctx.db
      .select({ clinicId: invites.clinicId, email: invites.email })
      .from(invites)
      .where(and(isNull(invites.acceptedAt), gt(invites.expiresAt, sql`now()`)))
      .orderBy(desc(invites.createdAt)),
  ]);

  const ownerByClinic = new Map<string, string>();
  for (const o of owners) if (!ownerByClinic.has(o.clinicId)) ownerByClinic.set(o.clinicId, o.email);
  const inviteByClinic = new Map<string, string>();
  for (const i of pending) if (!inviteByClinic.has(i.clinicId)) inviteByClinic.set(i.clinicId, i.email);

  return rows.map((c) => ({
    ...c,
    ownerEmail: ownerByClinic.get(c.id) ?? null,
    pendingInviteEmail: inviteByClinic.get(c.id) ?? null,
  }));
}

/** Creates the clinic and its owner invite together: a clinic never exists without a way in. */
export async function createClinicWithOwnerInvite(
  ctx: AdminContext,
  input: { slug: string; nameEn: string; nameAr: string | null; country: CountryCode; ownerEmail: string },
  tokenHash: string,
) {
  return ctx.db.transaction(async (tx) => {
    const [clinic] = await tx
      .insert(clinics)
      .values({
        slug: input.slug,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        // The country picks the starting timezone; the owner can change the zone later, not the country.
        country: input.country,
        timezone: COUNTRIES[input.country].timezone,
        status: "trial",
        trialEndsAt: sql`now() + make_interval(days => ${TRIAL_DAYS})`,
      })
      .returning({ id: clinics.id });
    if (!clinic) throw new Error("clinic insert returned no row");

    await tx.insert(invites).values({
      clinicId: clinic.id,
      email: input.ownerEmail,
      role: "clinic_owner",
      tokenHash,
      expiresAt: sql`now() + make_interval(days => ${INVITE_TTL_DAYS})`,
      invitedByUserId: ctx.userId,
    });
    return clinic;
  });
}

/** Replaces a clinic's pending owner invite with a fresh one (lost or expired link). */
export async function reissueOwnerInvite(
  ctx: AdminContext,
  clinicId: string,
  ownerEmail: string,
  tokenHash: string,
) {
  return ctx.db.transaction(async (tx) => {
    await tx
      .delete(invites)
      .where(and(eq(invites.clinicId, clinicId), isNull(invites.acceptedAt)));
    await tx.insert(invites).values({
      clinicId,
      email: ownerEmail,
      role: "clinic_owner",
      tokenHash,
      expiresAt: sql`now() + make_interval(days => ${INVITE_TTL_DAYS})`,
      invitedByUserId: ctx.userId,
    });
  });
}

export async function getPendingInviteEmail(ctx: AdminContext, clinicId: string) {
  const rows = await ctx.db
    .select({ email: invites.email })
    .from(invites)
    .where(and(eq(invites.clinicId, clinicId), isNull(invites.acceptedAt)))
    .orderBy(desc(invites.createdAt))
    .limit(1);
  return rows[0]?.email ?? null;
}

export async function clinicExists(ctx: AdminContext, clinicId: string) {
  const rows = await ctx.db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return rows.length > 0;
}
