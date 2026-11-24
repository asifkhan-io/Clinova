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
