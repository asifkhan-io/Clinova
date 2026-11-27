/**
 * Phase 9d in a real browser: the owner erases a patient on request. The
 * record, the patient list and the patient's own private link all stop showing
 * them; clinic staff never see the erase control at all.
 */
import { bookOnPublicPage } from "./support/booking";
import { expect, signIn, t, test } from "./support/fixtures";

test("the owner erases a patient; their name, number and link are gone", async ({ page, seed, phone }) => {
  const name = `Erase Me ${seed.runId}`;
  const { tokenUrl } = await bookOnPublicPage(page, { slug: seed.ready.slug, locale: "en", dayIndex: 2, slotIndex: 4, name, phone: phone() });

  await signIn(page, seed.users.owner.email);
  await page.goto("/en/dashboard/patients");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // The closed section's heading; its button carries the same words.
  await page.locator("summary").filter({ hasText: t.en("Patients.eraseTitle") }).click();
  await page.getByLabel(t.en("Patients.eraseCheckbox")).check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: t.en("Patients.eraseButton") }).click();

  await expect(page.getByRole("heading", { level: 1, name: t.en("Patients.erasedName") })).toBeVisible();
  // toBeHidden, not toHaveCount(0): Next keeps the previously visited page (the
  // list, from before the erase) mounted but hidden for instant back navigation.
  await expect(page.getByText(name)).toBeHidden();
  await expect(page.getByRole("link", { name: t.en("Patients.whatsapp") })).toHaveCount(0);

  // A fresh load of the list: nothing cached, so the name must be absent entirely.
  await page.goto("/en/dashboard/patients");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  await expect(page.getByText(t.en("Patients.erasedName")).first()).toBeVisible();

  // The private link the patient was given no longer opens anything.
  await page.goto(tokenUrl);
  await expect(page.getByText(t.en("Appointment.invalid"))).toBeVisible();
});

test("clinic staff can open a patient record but never see the erase control", async ({ page, seed, phone }) => {
  const name = `Kept Patient ${seed.runId}`;
  await bookOnPublicPage(page, { slug: seed.ready.slug, locale: "en", dayIndex: 2, slotIndex: 6, name, phone: phone() });

  await signIn(page, seed.users.staff.email);
  await page.goto("/en/dashboard/patients");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: t.en("Patients.eraseTitle") })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.en("Patients.eraseButton") })).toHaveCount(0);
});
