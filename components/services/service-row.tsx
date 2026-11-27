"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { toggleServiceAction } from "@/server/actions/services";
import { ServiceForm, type ServiceFormValues } from "./service-form";

type Props = {
  service: ServiceFormValues & { isActive: boolean };
  name: string;
  description: string | null;
  priceLabel: string;
  /** The clinic's currency, named in the page's language, for the edit form's price label. */
  currencyLabel: string;
  canEdit: boolean;
};

export function ServiceRow({ service, name, description, priceLabel, currencyLabel, canEdit }: Props) {
  const t = useTranslations("Services");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [toggleState, toggle, toggling] = useActionState(toggleServiceAction, null);

  useEffect(() => {
    if (toggleState?.ok) router.refresh();
  }, [toggleState, router]);

  return (
    <li className={`flex flex-col gap-3 rounded-lg border p-4 ${service.isActive ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium">
            {name}
            {!service.isActive && (
              <span className="ms-2 rounded bg-black/10 px-1.5 py-0.5 text-xs">{t("inactive")}</span>
            )}
          </span>
          {description && <span className="text-sm opacity-70">{description}</span>}
          <span className="text-sm">
            {t("minutes", { count: service.durationMinutes })} · {priceLabel}
          </span>
        </div>

        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="rounded-md border px-3 py-1 text-sm hover:bg-black/5"
            >
              {editing ? t("cancel") : t("edit")}
            </button>
            <form action={toggle}>
              <input type="hidden" name="id" value={service.id} />
              <input type="hidden" name="active" value={String(!service.isActive)} />
              <button
                type="submit"
                disabled={toggling}
                className="rounded-md border px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-60"
              >
                {service.isActive ? t("deactivate") : t("activate")}
              </button>
            </form>
          </div>
        )}
      </div>

      {toggleState && !toggleState.ok && (
        <p role="alert" className="text-sm text-red-600">{t(`errors.${toggleState.error}`)}</p>
      )}
      {editing && <ServiceForm currencyLabel={currencyLabel} service={service} onDone={() => setEditing(false)} />}
    </li>
  );
}
