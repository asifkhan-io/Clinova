// user-flows.md §10: a bare "ar-SA"/"ar" locale resolves to the Umm al-Qura
// Islamic calendar AND Arabic-Indic digits. A confirmation that silently
// switches calendar system is a support ticket, so both are pinned here.
// Every date, time and number shown to a user goes through this file.

export function clinicDateTime(locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  });
}

export function clinicNumber(locale: string) {
  return new Intl.NumberFormat(locale, { numberingSystem: "latn" });
}

/**
 * Money is stored in minor units (halalas, paisa) in the clinic's own currency
 * (lib/countries.ts; one currency per clinic, never converted — scope §13).
 * Whole amounts drop the ".00": clinics price in whole riyals and rupees.
 */
export function clinicMoney(locale: string, minor: number, currency: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    numberingSystem: "latn",
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * A currency's name in the reader's language ("Pakistani Rupee", "روبية
 * باكستانية"), for labels. A bare ISO code ("SAR") reads as stray English on an
 * Arabic page. Computed on the server and passed down, so the browser's own
 * Intl data can never disagree with it during hydration.
 */
export function currencyName(locale: string, currency: string) {
  return new Intl.DisplayNames([locale], { type: "currency" }).of(currency) ?? currency;
}

/** Minutes from midnight -> "9:30 AM" / "9:30 ص", Latin digits. 1440 reads as midnight. */
export function clinicMinutes(locale: string, minutes: number) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    numberingSystem: "latn",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(1970, 0, 1, 0, minutes % 1440)));
}

/** Weekday name for 0 = Sunday … 6 = Saturday. 1 Jan 2023 was a Sunday. */
export function weekdayName(locale: string, dayOfWeek: number) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2023, 0, 1 + dayOfWeek)),
  );
}

/** A calendar date ("2027-03-10", no time, no zone) -> "Wed, 10 Mar 2027", Gregorian, Latin digits. */
export function clinicDate(locale: string, isoDate: string) {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** An instant as "9:30 AM" / "9:30 م" on the clinic's wall clock, Latin digits. */
export function clinicTime(locale: string, timeZone: string, at: Date | number) {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone, numberingSystem: "latn" }).format(at);
}

/** An instant as "Sun, 3 Jan 2027" on the clinic's calendar, Gregorian, Latin digits. */
export function clinicDay(locale: string, timeZone: string, at: Date | number) {
  return new Intl.DateTimeFormat(locale, { calendar: "gregory", numberingSystem: "latn", timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(at);
}

/** "09:30" on the clinic's wall clock: the value an <input type="time"> expects. */
export function wallClock(timeZone: string, at: Date | number) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);
}
