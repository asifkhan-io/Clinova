import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { AcceptInviteForm } from "@/components/invite/accept-invite-form";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { findValidInvite } from "@/server/db/repositories/invites";
import { hashToken } from "@/server/services/tokens";

export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  const locale = await resolveLocale();
  const t = await getTranslations("Invite");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {/* The token is per-link URL data, so it streams in behind the static shell. */}
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <InviteBody params={params} locale={locale} />
      </Suspense>
    </main>
  );
}

async function InviteBody({
  params,
  locale,
}: {
  params: PageProps<"/[locale]/invite/[token]">["params"];
  locale: Locale;
}) {
  const { token } = await params;
  // A per-request database read: never part of a prerendered shell.
  await connection();
  const t = await getTranslations({ locale, namespace: "Invite" });
  const invite = await findValidInvite(hashToken(token));

  if (!invite) {
    // One message for unknown, used and expired links: don't help anyone probe tokens.
    return <p className="rounded-md border p-4">{t("invalid")}</p>;
  }

  if (invite.accountExists) {
    return (
      <div className="flex flex-col gap-4 rounded-md border border-amber-600 p-4">
        <p>{t("accountExists", { email: invite.email })}</p>
        <Link href="/sign-in" className="self-start rounded-md bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black">
          {t("signIn")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <p>
        {t("intro", { clinic: locale === "ar" ? invite.clinicNameAr : invite.clinicNameEn })}
      </p>
      <AcceptInviteForm token={token} email={invite.email} />
    </>
  );
}
