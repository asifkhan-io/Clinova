"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { saveStaffServicesAction, toggleStaffAction } from "@/server/actions/staff";
import { StaffForm, type StaffFormValues } from "./staff-form";

type Props = {
  member: StaffFormValues & { isActive: boolean; serviceIds: string[] };
  name: string;
  title: string | null;
  services: { id: string; name: string; isActive: boolean }[];
  canEdit: boolean;
};

export function StaffRow({ member, name, title, services, canEdit }: Props) {
  const t = useTranslations("Dentists");
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "edit" | "services">("none");
  // Follow-ups run when the action settles, not in an effect: no extra render pass.
  const [toggleState, toggle, toggling] = useActionState(
    async (prev: Awaited<ReturnType<typeof toggleStaffAction>> | null, form: FormData) => {
      const result = await toggleStaffAction(prev, form);
      if (result.ok) router.refresh();
      return result;
    },
    null,
  );
  const [servicesState, saveServices, savingServices] = useActionState(
    async (prev: Awaited<ReturnType<typeof saveStaffServicesAction>> | null, form: FormData) => {
      const result = await saveStaffServicesAction(prev, form);
      if (result.ok) {
        setPanel("none");
        router.refresh();
      }
      return result;
    },
    null,
  );

  const performed = services.filter((s) => member.serviceIds.includes(s.id));
  const error = (toggleState && !toggleState.ok && toggleState.error) || (servicesState && !servicesState.ok && servicesState.error);

  return (
    <li className={`flex flex-col gap-3 rounded-lg border p-4 ${member.isActive ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium">
            {name}
            {!member.isActive && <span className="ms-2 rounded bg-black/10 px-1.5 py-0.5 text-xs">{t("inactive")}</span>}
          </span>
          {title && <span className="text-sm opacity-70">{title}</span>}
          <span className="text-sm">
            {performed.length === 0 ? (
              <span className="text-amber-700">{t("noServices")}</span>
            ) : (
              performed.map((s) => s.name).join(" · ")
            )}
          </span>
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPanel(panel === "services" ? "none" : "services")} className="rounded-md border px-3 py-1 text-sm hover:bg-black/5">
              {t("chooseServices")}
            </button>
            <button type="button" onClick={() => setPanel(panel === "edit" ? "none" : "edit")} className="rounded-md border px-3 py-1 text-sm hover:bg-black/5">
              {panel === "edit" ? t("cancel") : t("edit")}
            </button>
            <form action={toggle}>
              <input type="hidden" name="id" value={member.id} />
              <input type="hidden" name="active" value={String(!member.isActive)} />
              <button type="submit" disabled={toggling} className="rounded-md border px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-60">
                {member.isActive ? t("deactivate") : t("activate")}
              </button>
            </form>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{t(`errors.${error}`)}</p>}

      {panel === "edit" && <StaffForm member={member} onDone={() => setPanel("none")} />}

      {panel === "services" && (
        <form action={saveServices} className="flex flex-col gap-3 rounded-md bg-black/5 p-3">
          <input type="hidden" name="staffId" value={member.id} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("servicesLegend", { name })}</legend>
            {services.length === 0 && <p className="text-sm opacity-70">{t("noServicesYet")}</p>}
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={member.serviceIds.includes(s.id)} />
                <span>
                  {s.name}
                  {!s.isActive && <span className="ms-1 opacity-60">({t("inactive")})</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={savingServices} className="self-start rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black">
            {savingServices ? t("saving") : t("saveServices")}
          </button>
        </form>
      )}
    </li>
  );
}
