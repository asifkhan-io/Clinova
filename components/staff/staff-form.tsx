"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { saveStaffAction } from "@/server/actions/staff";

export type StaffFormValues = {
  id: string;
  displayNameEn: string;
  displayNameAr: string;
  titleEn: string | null;
  titleAr: string | null;
};

const field = "rounded-md border px-3 py-2 text-start";

export function StaffForm({ member, onDone }: { member?: StaffFormValues; onDone?: () => void }) {
  const t = useTranslations("Dentists");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(saveStaffAction, null);

  useEffect(() => {
    if (state?.ok) {
      if (!member) formRef.current?.reset();
      router.refresh();
      onDone?.();
    }
  }, [state, member, router, onDone]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2">
      {member && <input type="hidden" name="id" value={member.id} />}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("nameEn")}</span>
        <input name="displayNameEn" required dir="ltr" placeholder="Dr. Sara Ahmed" defaultValue={member?.displayNameEn} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("nameAr")}</span>
        <input name="displayNameAr" required dir="rtl" placeholder="د. سارة أحمد" defaultValue={member?.displayNameAr} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("titleEn")}</span>
        <input name="titleEn" dir="ltr" placeholder="Orthodontist" defaultValue={member?.titleEn ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("titleAr")}</span>
        <input name="titleAr" dir="rtl" placeholder="أخصائية تقويم" defaultValue={member?.titleAr ?? ""} className={field} />
      </label>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">{t(`errors.${state.error}`)}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 sm:col-span-2 dark:bg-white dark:text-black"
      >
        {pending ? t("saving") : member ? t("save") : t("add")}
      </button>
    </form>
  );
}
