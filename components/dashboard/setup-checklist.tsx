import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import type { SetupStep } from "@/server/services/onboarding";

export async function SetupChecklist({ steps, locale }: { steps: SetupStep[]; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "Setup" });
  const done = steps.filter((s) => s.done).length;

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <span className="text-sm opacity-70">{t("progress", { done, total: steps.length })}</span>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${s.done ? "border-green-700 bg-green-700 text-white" : ""}`}>
              {s.done ? "✓" : ""}
            </span>
            <span className={s.done ? "opacity-60" : ""}>
              {t(`steps.${s.key}`)}
              {!s.required && <span className="ms-1 opacity-60">({t("optional")})</span>}
            </span>
            {!s.done && (
              <Link href={s.href} className="ms-auto shrink-0 underline">
                {t("go")}
              </Link>
            )}
            <span className="sr-only">{s.done ? t("doneSr") : t("todoSr")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
