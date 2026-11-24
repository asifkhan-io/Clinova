import "server-only";
import { db } from "../db/client";
import type {
  AdminContext,
  ClinicContext,
  ClinicRole,
} from "../db/repositories/context";
import { findActiveMembership, isPlatformAdmin } from "../db/repositories/members";
import { AuthError } from "./errors";
import { getSession } from "./session";

const ROLE_RANK: Record<ClinicRole, number> = {
  clinic_staff: 1,
  clinic_owner: 2,
};

/**
 * First line of every private page, layout, Server Action and Route Handler
 * that touches clinic data. Proxy is NOT the boundary (architecture.md §3.2):
 * it can be bypassed, so authorization happens here, on every request.
 *
 * Returns the clinic_id from the membership row. It never accepts one.
 */
export async function requireClinicAccess(
  minRole: ClinicRole = "clinic_staff",
  options: { write?: boolean } = {},
): Promise<ClinicContext> {
  const session = await getSession();
  if (!session) throw new AuthError("unauthenticated");

  const membership = await findActiveMembership(session.user.id);
  if (!membership) throw new AuthError("forbidden");
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new AuthError("forbidden");
  }
  // Suspension is the commercial lever (scope §5): reads still work so a clinic
  // can see its calendar, writes are refused.
  if (options.write && membership.clinicStatus === "suspended") {
    throw new AuthError("clinic_suspended");
  }

  return {
    db,
    clinicId: membership.clinicId,
    userId: session.user.id,
    role: membership.role,
    clinicStatus: membership.clinicStatus,
  };
}

/** Platform admin: manages clinic records. Gets no ClinicContext, so no patient data. */
export async function requirePlatformAdmin(): Promise<AdminContext> {
  const session = await getSession();
  if (!session) throw new AuthError("unauthenticated");
  if (!(await isPlatformAdmin(session.user.id))) throw new AuthError("forbidden");
  return { db, userId: session.user.id };
}

/** Who is signed in and what they can reach. For routing decisions only. */
export async function getViewer() {
  const session = await getSession();
  if (!session) return null;
  const [admin, membership] = await Promise.all([
    isPlatformAdmin(session.user.id),
    findActiveMembership(session.user.id),
  ]);
  return { user: session.user, isPlatformAdmin: admin, membership };
}
