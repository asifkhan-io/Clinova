/**
 * The clinic share kit in a real browser: from the overview the owner can
 * share the booking link on WhatsApp and open a printable QR poster.
 */
import { expect, signIn, t, test } from "./support/fixtures";

test("the owner shares the booking page: WhatsApp message and a QR poster", async ({ page, seed }) => {
  await signIn(page, seed.users.owner.email);
  const bookingPath = `/en/c/${seed.ready.slug}`;

  const whatsapp = page.getByRole("link", { name: t.en("Dashboard.shareWhatsApp") });
  const href = (await whatsapp.getAttribute("href")) ?? "";
  expect(href.startsWith("https://wa.me/?text=")).toBe(true);
  expect(decodeURIComponent(href)).toContain(bookingPath);

  await page.getByRole("link", { name: t.en("Dashboard.qrPoster") }).click();
  await expect(page.getByRole("heading", { level: 1, name: t.en("Share.title") })).toBeVisible();
  const poster = page.getByRole("region", { name: t.en("Share.posterLabel") });
  await expect(poster.getByText(seed.ready.nameEn)).toBeVisible();
  await expect(poster.getByRole("img")).toBeVisible();
  await expect(poster.getByText(new RegExp(`^https?://[^/]+${bookingPath}$`))).toBeVisible();
  expect(await page.getByRole("link", { name: t.en("Share.download") }).getAttribute("href")).toMatch(/^data:image\/svg\+xml;base64,/);
  await expect(page.getByRole("button", { name: t.en("Share.print") })).toBeVisible();
});

test("staff can open the share page too: it holds nothing private", async ({ page, seed }) => {
  await signIn(page, seed.users.staff.email);
  await page.goto("/en/dashboard/share");
  await expect(page.getByRole("heading", { level: 1, name: t.en("Share.title") })).toBeVisible();
});
