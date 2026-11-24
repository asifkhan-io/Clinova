"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/lib/i18n/navigation";
import { signInSchema } from "@/lib/validation/auth";

export function SignInForm() {
  const t = useTranslations("SignIn");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const parsed = signInSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      setError(t("errorInvalid"));
      return;
    }

    setPending(true);
    const { error: authError } = await authClient.signIn.email(parsed.data);
    setPending(false);

    if (authError) {
      // One message for every failure: never reveal whether the email exists.
      setError(t("errorInvalid"));
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("email")}</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          dir="ltr"
          required
          className="rounded-md border px-3 py-2 text-start"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("password")}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          className="rounded-md border px-3 py-2 text-start"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
