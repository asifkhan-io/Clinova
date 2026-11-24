import { Suspense } from "react";
import { DashboardNav, type NavKey } from "@/components/dashboard/dashboard-nav";
import { getViewer } from "@/server/auth/guards";

export default function DashboardLayout({ children }: LayoutProps<"/[locale]/dashboard">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
      {/* Which tabs to show depends on who is signed in, so it streams in. */}
      <Suspense fallback={<div className="h-10 border-b" aria-hidden />}>
        <NavForViewer />
      </Suspense>
      {children}
    </div>
  );
}

/**
 * Tabs follow what each account can actually open. This is presentation only:
 * every page still runs its own guard, so a typed URL is checked the same way.
 */
async function NavForViewer() {
  const viewer = await getViewer();
  if (!viewer) return null;

  const keys: NavKey[] = ["overview"];
  if (viewer.membership) {
    keys.push("services", "dentists", "hours", "closures");
    if (viewer.membership.role === "clinic_owner") keys.push("settings");
  }
  if (viewer.isPlatformAdmin) keys.push("admin");
  return <DashboardNav keys={keys} />;
}
