/**
 * DoD 7, patient: book on the public page, then use the private link to
 * reschedule and cancel. English; the Arabic run is in arabic.spec.ts.
 */
import { expect, t, test } from "./support/fixtures";
import { bookOnPublicPage } from "./support/booking";

test("a patient books, reschedules and cancels through their private link", async ({ page, seed, phone }) => {
  const { tokenUrl } = await bookOnPublicPage(page, { slug: seed.ready.slug, locale: "en", dayIndex: 1, name: "Noura Patient", phone: phone() });

  // The confirmation page is the private link itself.
  await expect(page).toHaveURL(tokenUrl);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: seed.ready.service.nameEn })).toBeVisible();
  const firstWhen = await page.getByRole("definition").nth(1).innerText();

  // The calendar file downloads for this appointment.
  const ics = await page.request.get(await page.getByRole("link", { name: "Add to calendar" }).getAttribute("href") as string);
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  expect(await ics.text()).toContain("BEGIN:VEVENT");

  // Reschedule to another day.
  const changes = page.getByRole("region", { name: "Change or cancel" });
  await page.getByRole("button", { name: "Change time" }).click();
  await changes.getByRole("button", { name: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) / }).nth(2).click();
  await page.getByRole("radio").nth(3).click();
  await page.getByRole("button", { name: /^Move to / }).click();
  await expect(changes.getByRole("status")).toContainText("your appointment has been moved");
  await expect(page.getByRole("definition").nth(1)).not.toHaveText(firstWhen);

  // A reload proves the move was saved, not just shown.
  await page.reload();
  await expect(page.getByRole("definition").nth(1)).not.toHaveText(firstWhen);

  // Cancel.
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByText("This appointment has been cancelled.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change time" })).toHaveCount(0);
});

test("a made-up link shows nothing about anyone's appointment", async ({ page }) => {
  // Same neutral message for unknown, expired and suspended links, by design:
  // the page must not help anyone probe which links exist.
  await page.goto("/en/a/this-token-does-not-exist-0000000000000000000");
  await expect(page.getByText(t.en("Appointment.invalid"))).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel appointment" })).toHaveCount(0);
});
