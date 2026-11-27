"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { saveServiceAction } from "@/server/actions/services";

export type ServiceFormValues = {
  id: string;
  nameEn: string;
  nameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  durationMinutes: number;
  priceMinor: number | null;
};

const field = "rounded-md border px-3 py-2 text-start";

/** One form for create (no `service`) and edit (with `service`). */
export function ServiceForm({ service, currency, onDone }: { service?: ServiceFormValues; currency: string; onDone?: () => void }) {
  const t = useTranslations("Services");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(saveServiceAction, null);

  useEffect(() => {
    if (state?.ok) {
      if (!service) formRef.current?.reset();
      router.refresh();
      onDone?.();
    }
  }, [state, service, router, onDone]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      {service && <input type="hidden" name="id" value={service.id} />}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("nameEn")}</span>
        <input name="nameEn" required dir="ltr" defaultValue={service?.nameEn} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("nameAr")}</span>
        <input name="nameAr" dir="rtl" defaultValue={service?.nameAr ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("descriptionEn")}</span>
        <textarea name="descriptionEn" rows={2} dir="ltr" defaultValue={service?.descriptionEn ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("descriptionAr")}</span>
        <textarea name="descriptionAr" rows={2} dir="rtl" defaultValue={service?.descriptionAr ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("duration")}</span>
        <input
          name="durationMinutes"
          type="number"
          required
          min={5}
          max={480}
          step={5}
          dir="ltr"
          defaultValue={service?.durationMinutes ?? 30}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("price", { currency })}</span>
        <input
          name="price"
          inputMode="decimal"
          dir="ltr"
          placeholder="150"
          defaultValue={service?.priceMinor == null ? "" : String(service.priceMinor / 100)}
          className={field}
        />
        <span className="text-xs opacity-60">{t("priceHint")}</span>
      </label>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {t(`errors.${state.error}`)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 sm:col-span-2 dark:bg-white dark:text-black"
      >
        {pending ? t("saving") : service ? t("save") : t("add")}
      </button>
    </form>
  );
}
