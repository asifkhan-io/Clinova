/**
 * One-tap WhatsApp from the clinic's own phone (scope §4: no WhatsApp Business
 * API in the MVP). wa.me wants the international number without "+".
 * The link opens WhatsApp; nothing is sent until the staff member presses send.
 */
export function whatsappLink(phoneE164: string, text: string) {
  return `https://wa.me/${phoneE164.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}
