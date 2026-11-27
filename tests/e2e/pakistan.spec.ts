/**
 * Week 2 (scope §13) in a real browser: a Pakistani clinic shows PKR prices
 * and its own phone example, takes a booking with a local 03… number, refuses
 * a Saudi local one, and has no Arabic names, so its Arabic page falls back
 * to English without a single blank.
 */
import { bookOnPublicPage } from "./support/booking";
import { expect, t, test } from "./support/fixtures";

test("a patient books at a Pakistani clinic with a local 03… number", async ({ page, seed, pkPhone }) => {
  await page.goto(`/en/c/${seed.pk.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: seed.pk.nameEn })).toBeVisible();
  await expect(page.getByText(/PKR\s?1,500/)).toBeVisible();

  const { tokenUrl } = await bookOnPublicPage(page, { slug: seed.pk.slug, locale: "en", dayIndex: 1, name: "Ali Khan", phone: pkPhone() });
  await expect(page).toHaveURL(tokenUrl);
  await expect(page.getByRole("heading", { level: 1, name: seed.pk.service.nameEn })).toBeVisible();
});

test("the same clinic refuses a Saudi local number and says why", async ({ page, seed }) => {
  await page.goto(`/en/c/${seed.pk.slug}`);
  const when = page.getByRole("region", { name: t.en("Booking.step3") });
  await when.getByRole("button").nth(1).click();
  await page.getByRole("radiogroup", { name: t.en("Booking.pickTime") }).getByRole("radio").nth(2).click();
  const form = page.getByRole("form", { name: t.en("Booking.step4") });
  await expect(form.getByLabel(t.en("Booking.phone"))).toHaveAttribute("placeholder", "03XX XXXXXXX");
  await form.getByLabel(t.en("Booking.fullName")).fill("Wrong Format");
  await form.getByLabel(t.en("Booking.phone")).fill("0512345678");
  await form.getByRole("checkbox").check();
  await form.getByRole("button").last().click();
  await expect(page.getByText(t.en("Booking.errors.phone"))).toBeVisible();
});

test("with no Arabic names, the Arabic page shows the English ones, right-to-left", async ({ page, seed }) => {
  await page.goto(`/ar/c/${seed.pk.slug}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: seed.pk.nameEn })).toBeVisible();
  await expect(page.getByText(seed.pk.service.nameEn).first()).toBeVisible();
  await expect(page.getByText(/null|undefined/)).toHaveCount(0);
});
