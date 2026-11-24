"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/lib/i18n/navigation";

const items = [
  { href: "/dashboard", key: "overview" },
  { href: "/dashboard/services", key: "services" },
] as const;

export function DashboardNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b pb-2">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
              active ? "bg-black/10 font-medium" : "hover:bg-black/5"
            }`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
