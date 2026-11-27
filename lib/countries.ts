/**
 * Everything that differs between markets, in one place (scope §13: "anything
 * country-specific lives in clinic settings, never hardcoded"). A clinic stores
 * only its country code; the rest is read from here. Adding a market means
 * adding an entry, not a migration. Client-safe: no server imports.
 */
export const COUNTRIES = {
  SA: {
    dialCode: "966",
    /** A mobile number as people there type it: 05XXXXXXXX. */
    localMobile: /^05\d{8}$/,
    localExample: "05X XXX XXXX",
    currency: "SAR",
    timezone: "Asia/Riyadh",
  },
  PK: {
    dialCode: "92",
    /** A mobile number as people there type it: 03XXXXXXXXX. */
    localMobile: /^03\d{9}$/,
    localExample: "03XX XXXXXXX",
    currency: "PKR",
    timezone: "Asia/Karachi",
  },
} as const;

export type CountryCode = keyof typeof COUNTRIES;
export const COUNTRY_CODES = Object.keys(COUNTRIES) as [CountryCode, ...CountryCode[]];

export const isCountryCode = (v: string): v is CountryCode => Object.hasOwn(COUNTRIES, v);

/**
 * A clinic's stored country, read defensively. The database only checks the
 * shape (two capital letters), so an unknown code is possible in principle;
 * it falls back to the column default rather than crashing a booking page.
 */
export function countryOf(code: string | null | undefined): CountryCode {
  return code && isCountryCode(code) ? code : "SA";
}
