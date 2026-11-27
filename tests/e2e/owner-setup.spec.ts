/**
 * DoD 7, owner: an empty clinic goes from nothing to bookable through the
 * dashboard alone — service, opening hours, dentist, booking switch — and the
 * public page then offers real times.
 */
import { expect, signIn, test } from "./support/fixtures";

test("an owner sets up an empty clinic and patients can then book it", async ({ page, seed }) => {
  await signIn(page, seed.users.freshOwner.email);
  await expect(page.getByRole("heading", { name: "Setup checklist" })).toBeVisible();
  await expect(page.getByText("0 of 6 done")).toBeVisible();

  // Before setup the public page refuses bookings.
  const publicPage = await page.context().newPage();
  await publicPage.goto(`/en/c/${seed.fresh.slug}`);
  await expect(publicPage.getByRole("radio")).toHaveCount(0);
  await expect(publicPage.getByRole("region", { name: "1. Choose a service" })).toHaveCount(0);

  // 1. A service.
  await page.getByRole("navigation", { name: "Clinic" }).getByRole("link", { name: "Services" }).click();
  await page.getByLabel("Name (English)").fill("Whitening");
  await page.getByLabel(/^Name \(Arabic/).fill("تبييض");
  await page.getByLabel("Duration (minutes)").fill("45");
  await page.getByLabel(/^Price \(Saudi Riyal\)/).fill("300");
  await page.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByRole("heading", { name: "Your services (1)" })).toBeVisible();

  // 2. Opening hours: open one day, copy it to the whole week, save.
  await page.getByRole("navigation", { name: "Clinic" }).getByRole("link", { name: "Hours" }).click();
  const week = page.getByRole("list").first();
  await week.getByRole("listitem").first().getByRole("button", { name: "Open this day" }).click();
  await week.getByRole("listitem").first().getByRole("button", { name: "Copy to every day" }).click();
  await page.getByRole("button", { name: "Save week" }).click();
  await expect(page.getByRole("button", { name: "Open this day" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open this day" })).toHaveCount(0);

  // 3. A dentist: starts with every active service and the clinic's hours.
  await page.getByRole("navigation", { name: "Clinic" }).getByRole("link", { name: "Dentists" }).click();
  await page.getByLabel("Name (English)").fill("Dr Layla");
  await page.getByLabel(/^Name \(Arabic/).fill("د. ليلى");
  await page.getByRole("button", { name: "Add dentist" }).click();
  await expect(page.getByRole("heading", { name: "Your dentists (1)" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Dr Layla" })).toContainText("Whitening");

  // 4. Switch online booking on.
  await page.getByRole("navigation", { name: "Clinic" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Turn on online booking" }).click();
  await expect(page.getByRole("button", { name: "Turn off online booking" })).toBeVisible();

  // The checklist agrees (the address is optional and still empty).
  await page.getByRole("navigation", { name: "Clinic" }).getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("Online booking is ON")).toBeVisible();
  await expect(page.getByText("5 of 6 done")).toBeVisible();

  // The public page now offers this service, this dentist and real times.
  await publicPage.reload();
  await expect(publicPage.getByRole("button", { name: /Whitening/ })).toBeVisible();
  await expect(publicPage.getByRole("button", { name: "Dr Layla" })).toBeVisible();
  await publicPage.getByRole("region", { name: "3. Choose a day and time" }).getByRole("button").nth(2).click();
  await expect(publicPage.getByRole("radio").first()).toBeVisible();
});
