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

/** Money is stored in minor units (halalas); SAR only in the MVP (scope §6). */
export function clinicMoney(locale: string, minor: number) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "SAR",
    numberingSystem: "latn",
  }).format(minor / 100);
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
