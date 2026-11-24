"use server";

import { requirePlatformAdmin } from "@/server/auth/guards";
import {
  clinicExists,
  createClinicWithOwnerInvite,
  getPendingInviteEmail,
  reissueOwnerInvite,
} from "@/server/db/repositories/admin-clinics";
import { newToken } from "@/server/services/tokens";
import { createClinicSchema } from "@/lib/validation/clinic";
import { routing } from "@/lib/i18n/routing";
import type { AuthErrorCode } from "@/server/auth/errors";
import { type ActionResult, authFailure, isUniqueViolation } from "./result";

export type AdminActionError =
  | AuthErrorCode
  | "invalid_input"
  | "slug_taken"
  | "no_pending_invite";
type InviteLinkResult = ActionResult<{ inviteUrl: string }, AdminActionError>;

function inviteUrl(locale: string, token: string) {
  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  const loc = (routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale;
  return `${base}/${loc}/invite/${token}`;
}

// guard -> Zod -> repository (architecture.md: server/actions pattern)

export async function createClinicAction(
  _prev: InviteLinkResult | null,
  form: FormData,
): Promise<InviteLinkResult> {
  let ctx;
  try {
    ctx = await requirePlatformAdmin();
  } catch (e) {
    return authFailure(e);
  }

  const parsed = createClinicSchema.safeParse({
    slug: form.get("slug"),
    nameEn: form.get("nameEn"),
    nameAr: form.get("nameAr"),
    ownerEmail: form.get("ownerEmail"),
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const { token, hash } = newToken();
  try {
    await createClinicWithOwnerInvite(ctx, parsed.data, hash);
  } catch (e) {
    if (isUniqueViolation(e, "clinics_slug_key")) return { ok: false, error: "slug_taken" };
    throw e;
  }
  // The raw token is shown once, here, and never stored.
  return { ok: true, data: { inviteUrl: inviteUrl(String(form.get("locale")), token) } };
}

export async function reissueInviteAction(
  _prev: InviteLinkResult | null,
  form: FormData,
): Promise<InviteLinkResult> {
  let ctx;
  try {
    ctx = await requirePlatformAdmin();
  } catch (e) {
    return authFailure(e);
  }
  const clinicId = String(form.get("clinicId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(clinicId) || !(await clinicExists(ctx, clinicId))) {
    return { ok: false, error: "invalid_input" };
  }
  const email = await getPendingInviteEmail(ctx, clinicId);
  if (!email) return { ok: false, error: "no_pending_invite" };

  const { token, hash } = newToken();
  await reissueOwnerInvite(ctx, clinicId, email, hash);
  return { ok: true, data: { inviteUrl: inviteUrl(String(form.get("locale")), token) } };
}
