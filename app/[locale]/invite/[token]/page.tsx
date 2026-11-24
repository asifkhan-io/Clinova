import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AcceptInviteForm } from "@/components/invite/accept-invite-form";
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
  const t = await getTranslations({ locale, namespace: "Invite" });
  const invite = await findValidInvite(hashToken(token));

  if (!invite) {
    // One message for unknown, used and expired links: don't help anyone probe tokens.
    return <p className="rounded-md border p-4">{t("invalid")}</p>;
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
