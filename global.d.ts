import type { routing } from "@/lib/i18n/routing";
import type messages from "./messages/en.json";

// Makes a missing or misspelled translation key a type error, not a blank on screen.
// en.json is the source of truth; ar.json must carry the same keys.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
