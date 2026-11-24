import { getTranslations } from "next-intl/server";
import { SignInForm } from "@/components/auth/sign-in-form";
import { resolveLocale } from "@/lib/i18n/server";

export default async function SignInPage({
  params,
}: PageProps<"/[locale]/sign-in">) {
  await resolveLocale(params);
  const t = await getTranslations("SignIn");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <SignInForm />
    </main>
  );
}
