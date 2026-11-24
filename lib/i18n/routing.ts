import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ar"],
  defaultLocale: "en",
  // Every URL carries its locale (/en, /ar). A shared booking link then opens
  // in the language it was sent in, whatever the patient's browser prefers.
  localePrefix: "always",
});
