import { expect, type Page } from "@playwright/test";
import { t } from "./fixtures";

/**
 * The public booking wizard, in either language: service (pre-selected when
 * there is one) → dentist → day → time → details → book. Returns the private
 * link the patient lands on.
 */
export async function bookOnPublicPage(
  page: Page,
  o: { slug: string; locale: "en" | "ar"; dayIndex: number; name: string; phone: string; dentist?: string; slotIndex?: number },
) {
  const m = t[o.locale];
  await page.goto(`/${o.locale}/c/${o.slug}`);
  if (o.dentist) await page.getByRole("region", { name: m("Booking.step2") }).getByRole("button", { name: o.dentist }).click();
  const when = page.getByRole("region", { name: m("Booking.step3") });
  // Day buttons come first in this region; tomorrow or later avoids "too soon" slots.
  await when.getByRole("button").nth(o.dayIndex).click();
  await page.getByRole("radiogroup", { name: m("Booking.pickTime") }).getByRole("radio").nth(o.slotIndex ?? 0).click();

  const form = page.getByRole("form", { name: m("Booking.step4") });
  await form.getByLabel(m("Booking.fullName")).fill(o.name);
  await form.getByLabel(m("Booking.phone")).fill(o.phone);
  await form.getByRole("checkbox").check();
  await form.getByRole("button").last().click();

  await page.waitForURL(new RegExp(`/${o.locale}/a/[^/]+$`));
  await expect(page.getByText(m("Appointment.status.booked"), { exact: true })).toBeVisible();
  return { tokenUrl: page.url() };
}
