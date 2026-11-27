/**
 * DoD 7, staff: a walk-in booked from the dashboard shows on the calendar,
 * offers the one-tap WhatsApp reminder, and can be cancelled by the clinic.
 */
import { clinicDate, expect, signIn, test } from "./support/fixtures";

test("staff book a walk-in, find it on the calendar, and cancel it", async ({ page, seed, phone }) => {
  const mobile = phone();
  const e164 = `966${mobile.slice(1)}`;
  const day = clinicDate(3);
  await signIn(page, seed.users.staff.email);
  await expect(page.getByText("Staff", { exact: true })).toBeVisible();

  await page.goto(`/en/dashboard/calendar/new?date=${day}`);
  await page.getByLabel("Dentist").selectOption({ label: seed.ready.dentists[1]!.nameEn });
  await page.getByLabel("Date").fill(day);
  await page.getByRole("button", { name: "11:00 AM" }).click();
  await page.getByLabel("Patient name").fill("Fahad Walkin");
  await page.getByLabel(/^Mobile number/).fill(mobile);
  await page.getByRole("button", { name: "Book appointment" }).click();

  await expect(page.getByRole("status")).toContainText("Booked:");
  // The patient's private link is shown once, for the clinic to send.
  await expect(page.getByRole("code")).toContainText("/en/a/");

  // It's on the day view, with the WhatsApp link to the right number.
  await page.goto(`/en/dashboard/calendar?view=day&date=${day}`);
  const row = page.getByRole("listitem").filter({ hasText: "Fahad Walkin" });
  await expect(row).toContainText(seed.ready.dentists[1]!.nameEn);
  await expect(row.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", new RegExp(`^https://wa\\.me/${e164}`));

  // Appointment page: both reminder languages, then cancel.
  await row.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Fahad Walkin" })).toBeVisible();
  await expect(page.getByRole("link", { name: "In English" })).toHaveAttribute("href", new RegExp(`^https://wa\\.me/${e164}\\?text=Hello`));
  await expect(page.getByRole("link", { name: "بالعربية" })).toHaveAttribute("href", new RegExp(`^https://wa\\.me/${e164}\\?text=`));

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  const confirm = page.getByRole("button", { name: /^(Yes|Confirm)/ });
  if (await confirm.count()) await confirm.first().click();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();

  // The slot is free again for the next patient.
  await page.goto(`/en/dashboard/calendar/new?date=${day}`);
  await page.getByLabel("Dentist").selectOption({ label: seed.ready.dentists[1]!.nameEn });
  await expect(page.getByRole("button", { name: "11:00 AM" })).toBeVisible();
});
