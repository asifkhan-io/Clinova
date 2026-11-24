/**
 * RFC 5545 calendar file for one appointment. Pure, so it is unit-tested.
 *
 * - UID is stable per appointment and SEQUENCE comes from ics_sequence, so a
 *   reschedule (Phase 6) UPDATES the event in the patient's calendar instead of
 *   adding a second one.
 * - Times are UTC ("Z"); the patient's calendar shows them in local time.
 * - No patient name or phone in the file: it travels through mail apps and
 *   calendars we don't control.
 */
export function buildIcs(input: {
  uid: string;
  sequence: number;
  startMs: number;
  endMs: number;
  summary: string;
  location: string | null;
  description: string | null;
  cancelled?: boolean;
  nowMs: number;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Clinova//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${utc(input.nowMs)}`,
    `DTSTART:${utc(input.startMs)}`,
    `DTEND:${utc(input.endMs)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    ...(input.description ? [`DESCRIPTION:${escapeText(input.description)}`] : []),
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT2H",
    `DESCRIPTION:${escapeText(input.summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** 20270103T060000Z */
function utc(ms: number) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 §3.3.11: escape backslash, semicolon, comma and newlines. */
export function escapeText(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: lines longer than 75 octets are folded (CRLF + space), never mid-character. */
export function fold(line: string) {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes.encode(current + ch).length > limit) {
      out.push(current);
      current = ch;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}
