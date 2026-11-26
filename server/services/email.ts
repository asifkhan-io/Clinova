import "server-only";

/**
 * Sending email (Phase 8d), straight to Resend's HTTP API.
 *
 * No SDK: one POST is all we use, and a dependency we do not need is one more
 * thing to audit and update. Swapping provider (architecture §4.5 names SES as
 * the move at volume) means changing this file only.
 *
 * Without RESEND_API_KEY nothing is sent and nothing fails — tests, previews and
 * a fresh laptop all run without email, and the caller is told it was skipped.
 */

export type OutgoingEmail = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Resend refuses a second send with the same key, which makes cron retries safe. */
  idempotencyKey?: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; reason: "not_configured" | "no_recipients" | "rejected" | "unreachable" };

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, reason: "not_configured" };
  if (email.to.length === 0) return { ok: false, reason: "no_recipients" };

  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (email.idempotencyKey) headers["Idempotency-Key"] = email.idempotencyKey;

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to: email.to, subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // Status only. Resend's error body can echo the recipient address back.
      console.error(`email: Resend refused the message (${response.status})`);
      return { ok: false, reason: "rejected" };
    }
    const body = (await response.json()) as { id?: string };
    return { ok: true, id: body.id ?? "" };
  } catch {
    console.error("email: Resend could not be reached");
    return { ok: false, reason: "unreachable" };
  }
}
