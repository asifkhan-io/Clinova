/**
 * DoD 7, who can see what. The unit tests prove the guards; these prove the
 * real pages use them.
 */
import { clinicDate, expect, signIn, test } from "./support/fixtures";

test("signed-out visitors are sent to sign in from every dashboard page", async ({ page }) => {
  for (const path of ["/en/dashboard", "/en/dashboard/calendar", "/en/dashboard/patients", "/en/dashboard/settings", "/en/admin"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/en\/sign-in/);
  }
});

test("a wrong password is refused with a clear message", async ({ page, seed }) => {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(seed.users.owner.email);
  await page.getByLabel("Password").fill("not-the-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("staff don't get the owner-only settings, and clinic users don't get the platform admin", async ({ page, seed }) => {
  await signIn(page, seed.users.staff.email);
  await expect(page.getByRole("navigation", { name: "Clinic" }).getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/en/dashboard/settings");
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByRole("button", { name: "Turn off online booking" })).toHaveCount(0);
  // The admin area answers "not found" rather than "forbidden", so it doesn't
  // even confirm it exists to someone who isn't the platform admin.
  // (The dev server streams, so check the page rather than the status code.)
  await page.goto("/en/admin");
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Platform admin" })).toHaveCount(0);
});

test("an owner can't open another clinic's appointment, even with its exact address", async ({ page, seed, phone }) => {
  // The ready clinic's owner books something...
  await signIn(page, seed.users.owner.email);
  const day = clinicDate(4);
  await page.goto(`/en/dashboard/calendar/new?date=${day}`);
  await page.getByRole("button", { name: "2:00 PM" }).first().click();
  await page.getByLabel("Patient name").fill("Private Person");
  await page.getByLabel(/^Mobile number/).fill(phone());
  await page.getByRole("button", { name: "Book appointment" }).click();
  const href = await page.getByRole("link", { name: "Open appointment" }).getAttribute("href");
  expect(href).toMatch(/\/en\/dashboard\/appointments\//);

  // ...and the other clinic's owner, with that exact URL, sees nothing of it.
  await page.context().clearCookies();
  await signIn(page, seed.users.freshOwner.email);
  await page.goto(href!);
  await expect(page.getByText("Private Person")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel appointment" })).toHaveCount(0);
});
