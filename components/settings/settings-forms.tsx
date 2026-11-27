"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { COUNTRIES, countryOf } from "@/lib/countries";
import { useRouter } from "@/lib/i18n/navigation";
import { CLINIC_TIMEZONES, SLOT_STEPS, timezoneKey } from "@/lib/validation/clinic-settings";
import { saveBookingRulesAction, saveProfileAction, setBookingEnabledAction } from "@/server/actions/settings";

type Result = Awaited<ReturnType<typeof saveProfileAction>>;
const field = "rounded-md border px-3 py-2 text-start";
const submit = "self-start rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black";

function useSave(action: (p: Result | null, f: FormData) => Promise<Result>) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [state, run, pending] = useActionState(async (prev: Result | null, form: FormData) => {
    const result = await action(prev, form);
    setSaved(result.ok);
    if (result.ok) router.refresh();
    return result;
  }, null);
  return { state, run, pending, saved };
}

function Status({ state, saved }: { state: Result | null; saved: boolean }) {
  const t = useTranslations("Settings");
  if (state && !state.ok) return <p role="alert" className="text-sm text-red-600">{t(`errors.${state.error}`)}</p>;
  if (saved) return <p className="text-sm text-green-700">{t("saved")}</p>;
  return null;
}

export function BookingSwitch({ enabled, ready }: { enabled: boolean; ready: boolean }) {
  const t = useTranslations("Settings");
  const { state, run, pending, saved } = useSave(setBookingEnabledAction);
  return (
    <form action={run} className="flex flex-col gap-2">
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <p className="text-sm">{enabled ? t("bookingIsOn") : ready ? t("bookingIsOffReady") : t("bookingIsOffNotReady")}</p>
      <button type="submit" disabled={pending || (!enabled && !ready)} className={submit}>
        {enabled ? t("turnOff") : t("turnOn")}
      </button>
      <Status state={state} saved={saved} />
    </form>
  );
}

type Profile = {
  nameEn: string; nameAr: string | null; addressEn: string | null; addressAr: string | null;
  phone: string | null; mapsUrl: string | null; timezone: string; country: string;
};

export function ProfileForm({ clinic }: { clinic: Profile }) {
  const t = useTranslations("Settings");
  const { state, run, pending, saved } = useSave(saveProfileAction);
  return (
    <form action={run} className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1"><span className="text-sm font-medium">{t("nameEn")}</span>
        <input name="nameEn" required dir="ltr" defaultValue={clinic.nameEn} className={field} /></label>
      <label className="flex flex-col gap-1"><span className="text-sm font-medium">{t("nameAr")}</span>
        <input name="nameAr" dir="rtl" defaultValue={clinic.nameAr ?? ""} className={field} /></label>
      <label className="flex flex-col gap-1"><span className="text-sm font-medium">{t("addressEn")}</span>
        <textarea name="addressEn" rows={2} dir="ltr" defaultValue={clinic.addressEn ?? ""} className={field} /></label>
      <label className="flex flex-col gap-1"><span className="text-sm font-medium">{t("addressAr")}</span>
        <textarea name="addressAr" rows={2} dir="rtl" defaultValue={clinic.addressAr ?? ""} className={field} /></label>
      <label className="flex flex-col gap-1"><span className="text-sm font-medium">{t("phone")}</span>
        <input name="phone" type="tel" dir="ltr" placeholder={COUNTRIES[countryOf(clinic.country)].localExample} defaultValue={clinic.phone ?? ""} className={field} /></label>
      <label className="flex flex-col gap-1"><span className="text-sm font-medium">{t("mapsUrl")}</span>
        <input name="mapsUrl" type="url" dir="ltr" placeholder="https://maps.app.goo.gl/…" defaultValue={clinic.mapsUrl ?? ""} className={field} /></label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-sm font-medium">{t("timezone")}</span>
        {/* The value stays the IANA id the database stores; only the label is translated (F2). */}
        <select name="timezone" defaultValue={clinic.timezone} className={field}>
          {CLINIC_TIMEZONES.map((tz) => <option key={tz} value={tz}>{t(`timezones.${timezoneKey(tz)}`)}</option>)}
        </select></label>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Status state={state} saved={saved} />
        <button type="submit" disabled={pending} className={submit}>{pending ? t("saving") : t("save")}</button>
      </div>
    </form>
  );
}

type Rules = {
  bufferMinutes: number; minLeadMinutes: number; maxHorizonDays: number;
  changeCutoffMinutes: number; slotGranularityMinutes: number;
};

/** Options in plain units; the current value is always offered even if it's not a preset. */
function options(presets: number[], current: number) {
  return [...new Set([...presets, current])].sort((a, b) => a - b);
}

export function BookingRulesForm({ rules }: { rules: Rules }) {
  const t = useTranslations("Settings");
  const { state, run, pending, saved } = useSave(saveBookingRulesAction);
  const minutesLabel = (m: number) => (m === 0 ? t("none") : m % 1440 === 0 ? t("days", { count: m / 1440 }) : m % 60 === 0 ? t("hours", { count: m / 60 }) : t("minutes", { count: m }));

  const select = (name: keyof Rules, presets: number[], label: (v: number) => string, hint: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{t(`rules.${name}`)}</span>
      <select name={name} defaultValue={rules[name]} className={field}>
        {options(presets, rules[name]).map((v) => <option key={v} value={v}>{label(v)}</option>)}
      </select>
      <span className="text-xs opacity-60">{hint}</span>
    </label>
  );

  return (
    <form action={run} className="grid gap-4 sm:grid-cols-2">
      {select("minLeadMinutes", [0, 60, 120, 240, 720, 1440, 2880], minutesLabel, t("rules.minLeadHint"))}
      {select("maxHorizonDays", [7, 14, 30, 60, 90, 180], (d) => t("days", { count: d }), t("rules.maxHorizonHint"))}
      {select("bufferMinutes", [0, 5, 10, 15, 20, 30], minutesLabel, t("rules.bufferHint"))}
      {select("slotGranularityMinutes", [...SLOT_STEPS], (m) => t("minutes", { count: m }), t("rules.granularityHint"))}
      {select("changeCutoffMinutes", [0, 60, 120, 240, 720, 1440], minutesLabel, t("rules.cutoffHint"))}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Status state={state} saved={saved} />
        <button type="submit" disabled={pending} className={submit}>{pending ? t("saving") : t("save")}</button>
      </div>
    </form>
  );
}
