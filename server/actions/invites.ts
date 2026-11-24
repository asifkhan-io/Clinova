"use server";

import { hashPassword } from "better-auth/crypto";
import { headers } from "next/headers";
import { acceptInviteSchema } from "@/lib/validation/clinic";
import { auth } from "@/server/auth/config";
import { acceptInvite } from "@/server/db/repositories/invites";
import { hashToken } from "@/server/services/tokens";
import type { ActionResult } from "./result";

export type AcceptInviteError =
  | "invalid_input"
  | "password_mismatch"
  | "invalid"
  | "account_exists";
type AcceptInviteResult = ActionResult<undefined, AcceptInviteError>;

export async function acceptInviteAction(
  _prev: AcceptInviteResult | null,
  form: FormData,
): Promise<AcceptInviteResult> {
  const parsed = acceptInviteSchema.safeParse({
    token: form.get("token"),
    name: form.get("name"),
    password: form.get("password"),
    confirmPassword: form.get("confirmPassword"),
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((i) => i.path[0] === "confirmPassword");
    return { ok: false, error: mismatch ? "password_mismatch" : "invalid_input" };
  }

  const result = await acceptInvite({
    tokenHash: hashToken(parsed.data.token),
    name: parsed.data.name,
    passwordHash: await hashPassword(parsed.data.password),
  });
  if (!result.ok) return { ok: false, error: result.reason };

  // Sign the new owner straight in. nextCookies() lets this set the session cookie.
  await auth.api.signInEmail({
    body: { email: result.email, password: parsed.data.password },
    headers: await headers(),
  });
  return { ok: true, data: undefined };
}
