import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { PrintButton } from "@/components/share/print-button";
import { Link } from "@/lib/i18n/navigation";
import { resolveLocale } from "@/lib/i18n/server";
import { whatsappShareLink } from "@/lib/whatsapp";
import { requireClinicPage } from "@/server/auth/page-guards";
import { getOwnClinic } from "@/server/db/repositories/clinics";
import { publicBookingUrl, qrDataUrl, requestOrigin } from "@/server/services/share";

/** A printable poster for the reception desk: clinic name, QR code, link. Any clinic member. */
export default async function SharePage() {
  const locale = await resolveLocale();
  const t = await getTranslations("Share");
  return (
    <main className="flex flex-col gap-6">
      <Suspense fallback={<p className="opacity-60">{t("loading")}</p>}>
        <ShareBody locale={locale} />
      </Suspense>
    </main>
  );
}

async function ShareBody({ locale }: { locale: Locale }) {
  const ctx = await requireClinicPage(locale);
  await connection();
  const clinic = await getOwnClinic(ctx);
  if (!clinic) return null;

  const t = await getTranslations({ locale, namespace: "Share" });
  const name = (locale === "ar" ? clinic.nameAr : clinic.nameEn) || clinic.nameEn;
  const url = publicBookingUrl(await requestOrigin(), locale, clinic.slug);
  const message = t("whatsappMessage", { clinic: name, url });

  return (
    <>
      <header className="flex flex-col gap-2 print:hidden">
        <Link href="/dashboard" className="self-start text-sm underline">{t("back")}</Link>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm opacity-80">{t("hint")}</p>
        {!clinic.bookingEnabled && <p role="status" className="rounded-lg border border-amber-400 p-3 text-sm">{t("bookingOff")}</p>}
      </header>

      {/* The poster: what prints. */}
      <section aria-label={t("posterLabel")} className="flex flex-col items-center gap-4 rounded-lg border p-8 text-center print:border-0">
        <p className="text-3xl font-semibold">{name}</p>
        <p className="text-xl">{t("posterHeading")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL; next/image adds nothing here */}
        <img src={qrDataUrl(url)} alt={t("qrAlt", { clinic: name })} width={280} height={280} className="h-auto w-64 sm:w-72" />
        <p>{t("scan")}</p>
        <p dir="ltr" className="break-all font-mono text-sm">{url}</p>
      </section>

      <div className="flex flex-wrap gap-2 print:hidden">
        <PrintButton />
        <a href={qrDataUrl(url)} download={`${clinic.slug}-booking-qr.svg`} className="rounded-md border px-4 py-2 text-sm">{t("download")}</a>
        <a href={whatsappShareLink(message)} target="_blank" rel="noopener noreferrer" className="rounded-md border px-4 py-2 text-sm">{t("whatsapp")}</a>
      </div>
    </>
  );
}
