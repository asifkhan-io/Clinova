"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { parseTime } from "@/lib/validation/hours";
import { createOverrideAction } from "@/server/actions/overrides";

type Result = Awaited<ReturnType<typeof createOverrideAction>>;
type Row = { start: string; end: string };

const field = "rounded-md border px-3 py-2 text-start";

export function OverrideForm({ dentists }: { dentists: { id: string; name: string }[] }) {
  const t = useTranslations("Closures");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<"closed" | "custom_hours">("closed");
  const [rows, setRows] = useState<Row[]>([{ start: "10:00", end: "14:00" }]);
  const [startDate, setStartDate] = useState("");

  const [state, action, pending] = useActionState(async (prev: Result | null, form: FormData) => {
    const result = await createOverrideAction(prev, form);
    if (result.ok) {
      formRef.current?.reset();
      setType("closed");
      setRows([{ start: "10:00", end: "14:00" }]);
      setStartDate("");
      router.refresh();
    }
    return result;
  }, null);

  const intervals = rows.map((r) => ({ startMinute: parseTime(r.start), endMinute: parseTime(r.end, true) }));

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-sm font-medium">{t("appliesTo")}</span>
        <select name="staffId" defaultValue="" className={field}>
          <option value="">{t("wholeClinic")}</option>
          {dentists.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">{t("kind")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="type" value="closed" checked={type === "closed"} onChange={() => setType("closed")} />
          {t("closed")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="type" value="custom_hours" checked={type === "custom_hours"} onChange={() => setType("custom_hours")} />
          {t("specialHours")}
        </label>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("from")}</span>
        <input name="startDate" type="date" required dir="ltr" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("to")}</span>
        <input name="endDate" type="date" required dir="ltr" min={startDate || undefined} defaultValue="" className={field} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("labelEn")}</span>
        <input name="labelEn" dir="ltr" placeholder="Eid al-Fitr" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("labelAr")}</span>
        <input name="labelAr" dir="rtl" placeholder="عيد الفطر" className={field} />
      </label>

      {type === "custom_hours" && (
        <div className="flex flex-col gap-2 rounded-md bg-black/5 p-3 sm:col-span-2">
          <span className="text-sm font-medium">{t("hoursOnThoseDays")}</span>
          {rows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                dir="ltr"
                aria-label={t("from")}
                value={row.start}
                onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, start: e.target.value } : x)))}
                className="w-28 rounded-md border px-2 py-1 text-start"
              />
              <span aria-hidden>–</span>
              <input
                type="time"
                dir="ltr"
                aria-label={t("to")}
                value={row.end}
                onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, end: e.target.value } : x)))}
                className="w-28 rounded-md border px-2 py-1 text-start"
              />
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((r) => r.filter((_, i) => i !== idx))} aria-label={t("remove")} className="rounded-md px-2 py-1 text-sm hover:bg-black/10">
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setRows((r) => [...r, { start: "20:00", end: "00:00" }])} className="self-start rounded-md border px-2 py-0.5 text-xs hover:bg-black/10">
            {t("addShift")}
          </button>
          <span className="text-xs opacity-60">{t("ramadanHint")}</span>
        </div>
      )}
      <input type="hidden" name="intervals" value={JSON.stringify(type === "custom_hours" ? intervals : [])} />

      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">{t(`errors.${state.error}`)}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 sm:col-span-2 dark:bg-white dark:text-black"
      >
        {pending ? t("saving") : t("add")}
      </button>
    </form>
  );
}
