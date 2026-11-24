"use server";

import { z } from "zod";
import type { AuthErrorCode } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import {
  createStaff,
  setStaffActive,
  setStaffServices,
  updateStaff,
} from "@/server/db/repositories/staff";
import { uuidSchema } from "@/lib/validation/service";
import { staffSchema } from "@/lib/validation/staff";
import { type ActionResult, authFailure } from "./result";

export type StaffActionError = AuthErrorCode | "invalid_input" | "not_found";
type Result = ActionResult<undefined, StaffActionError>;

async function ownerWrite() {
  return requireClinicAccess("clinic_owner", { write: true });
}

export async function saveStaffAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await ownerWrite();
  } catch (e) {
    return authFailure(e);
  }
  const parsed = staffSchema.safeParse({
    displayNameEn: form.get("displayNameEn") ?? "",
    displayNameAr: form.get("displayNameAr") ?? "",
    titleEn: form.get("titleEn") ?? "",
    titleAr: form.get("titleAr") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const id = form.get("id");
  if (id) {
    const validId = uuidSchema.safeParse(id);
    if (!validId.success) return { ok: false, error: "invalid_input" };
    if (!(await updateStaff(ctx, validId.data, parsed.data))) return { ok: false, error: "not_found" };
  } else {
    await createStaff(ctx, parsed.data);
  }
  return { ok: true, data: undefined };
}

export async function toggleStaffAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await ownerWrite();
  } catch (e) {
    return authFailure(e);
  }
  const id = uuidSchema.safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const ok = await setStaffActive(ctx, id.data, form.get("active") === "true");
  return ok ? { ok: true, data: undefined } : { ok: false, error: "not_found" };
}

export async function saveStaffServicesAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await ownerWrite();
  } catch (e) {
    return authFailure(e);
  }
  const staffId = uuidSchema.safeParse(form.get("staffId"));
  const serviceIds = z.array(uuidSchema).max(200).safeParse(form.getAll("serviceIds"));
  if (!staffId.success || !serviceIds.success) return { ok: false, error: "invalid_input" };

  const ok = await setStaffServices(ctx, staffId.data, serviceIds.data);
  return ok ? { ok: true, data: undefined } : { ok: false, error: "not_found" };
}
