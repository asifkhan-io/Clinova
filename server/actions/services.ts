"use server";

import type { AuthErrorCode } from "@/server/auth/errors";
import { requireClinicAccess } from "@/server/auth/guards";
import {
  createService,
  setServiceActive,
  updateService,
} from "@/server/db/repositories/services";
import { serviceSchema, uuidSchema } from "@/lib/validation/service";
import { type ActionResult, authFailure } from "./result";

export type ServiceActionError = AuthErrorCode | "invalid_input" | "not_found";
type Result = ActionResult<undefined, ServiceActionError>;

function parseService(form: FormData) {
  return serviceSchema.safeParse({
    nameEn: form.get("nameEn") ?? "",
    nameAr: form.get("nameAr") ?? "",
    descriptionEn: form.get("descriptionEn") ?? "",
    descriptionAr: form.get("descriptionAr") ?? "",
    durationMinutes: form.get("durationMinutes"),
    priceMinor: form.get("price") ?? "",
  });
}

// guard (owner, write) -> Zod -> repository. The clinic comes from the guard,
// never from the form: a forged hidden field cannot reach another clinic.

export async function saveServiceAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await requireClinicAccess("clinic_owner", { write: true });
  } catch (e) {
    return authFailure(e);
  }
  const parsed = parseService(form);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const id = form.get("id");
  if (id) {
    const validId = uuidSchema.safeParse(id);
    if (!validId.success) return { ok: false, error: "invalid_input" };
    const updated = await updateService(ctx, validId.data, parsed.data);
    if (!updated) return { ok: false, error: "not_found" };
  } else {
    await createService(ctx, parsed.data);
  }
  return { ok: true, data: undefined };
}

export async function toggleServiceAction(_prev: Result | null, form: FormData): Promise<Result> {
  let ctx;
  try {
    ctx = await requireClinicAccess("clinic_owner", { write: true });
  } catch (e) {
    return authFailure(e);
  }
  const id = uuidSchema.safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const ok = await setServiceActive(ctx, id.data, form.get("active") === "true");
  return ok ? { ok: true, data: undefined } : { ok: false, error: "not_found" };
}
