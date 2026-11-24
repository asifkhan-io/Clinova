"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/lib/i18n/navigation";

export const NAV_ITEMS = {
  overview: "/dashboard",
  services: "/dashboard/services",
  dentists: "/dashboard/dentists",
  hours: "/dashboard/hours",
  closures: "/dashboard/closures",
  settings: "/dashboard/settings",
  admin: "/admin",
} as const;
export type NavKey = keyof typeof NAV_ITEMS;

/** Renders only the tabs the server decided this account can use. */
export function DashboardNav({ keys }: { keys: NavKey[] }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b pb-2">
      {keys.map((key) => {
        const href = NAV_ITEMS[key];
        const active = pathname === href;
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${active ? "bg-black/10 font-medium" : "hover:bg-black/5"}`}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
