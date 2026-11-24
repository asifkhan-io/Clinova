import { and, asc, eq } from "drizzle-orm";
import { clinicMembers, clinics, platformAdmins } from "../../../db/schema";
import { db } from "../client";
import type { ClinicRole, ClinicStatus } from "./context";

// Called by the guards BEFORE a context exists, so these take a userId from the
// verified session rather than a ClinicContext. Nothing else may call them.

export type Membership = {
  clinicId: string;
  role: ClinicRole;
  clinicStatus: ClinicStatus;
};

/**
 * The user's active membership. MVP: one clinic per user. If someone belongs to
 * several, the oldest membership wins until a clinic switcher exists.
 */
export async function findActiveMembership(
  userId: string,
): Promise<Membership | null> {
  const rows = await db
    .select({
      clinicId: clinicMembers.clinicId,
      role: clinicMembers.role,
      clinicStatus: clinics.status,
    })
    .from(clinicMembers)
    .innerJoin(clinics, eq(clinics.id, clinicMembers.clinicId))
    .where(
      and(eq(clinicMembers.userId, userId), eq(clinicMembers.isActive, true)),
    )
    .orderBy(asc(clinicMembers.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return rows.length > 0;
}
