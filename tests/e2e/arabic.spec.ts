/**
 * DoD 7 in Arabic: the patient journey and the dashboard, right-to-left, with
 * the app's own translations and no English left on the page.
 */
import type { Page } from "@playwright/test";
import { bookOnPublicPage } from "./support/booking";
import { expect, signIn, t, test } from "./support/fixtures";

/**
 * Latin words left on an Arabic page. Legitimately Latin text is removed first:
 * anything the markup deliberately marks dir="ltr" (phone numbers, e-mail
 * inputs), e-mail addresses, URLs and paths. Time zones are translated city
 * names since F2 was fixed, so they are checked like any other text. Clinic and dentist names
 * are entered in Arabic by the seed, so they must not trip this. Brand names
 * stay Latin on purpose.
 */
const ALLOWED = new Set(["Clinova", "Google"]);
async function latinWords(page: Page) {
  const text = await page.locator("main").last().evaluate((main) => {
    let all = (main as HTMLElement).innerText;
    for (const el of main.querySelectorAll<HTMLElement>('[dir="ltr"]')) all = all.replace(el.innerText, " ");
    return all;
  });
  return (
    text
      .replace(/\S+@\S+/g, " ")
      .replace(/(https?:\/\/|\/)[^\s]*/g, " ")
      .match(/[A-Za-z]{2,}/g)
      ?.filter((w) => !ALLOWED.has(w)) ?? []
  );
}

async function expectRtl(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.locator("main").last().evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
}

test("a patient books and cancels entirely in Arabic", async ({ page, seed, phone }) => {
  await page.goto(`/ar/c/${seed.ready.slug}`);
  await expectRtl(page);
  await expect(page.getByRole("heading", { level: 1, name: seed.ready.nameAr })).toBeVisible();
  for (const key of ["Booking.step1", "Booking.step2", "Booking.step3"]) {
    await expect(page.getByRole("heading", { name: t.ar(key) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: new RegExp(t.ar("Booking.anyDentist")) })).toBeVisible();
  expect(await latinWords(page)).toEqual([]);

  await bookOnPublicPage(page, { slug: seed.ready.slug, locale: "ar", dayIndex: 2, slotIndex: 1, name: "نورة اختبار", phone: phone(), dentist: seed.ready.dentists[0]!.nameAr });
  await expectRtl(page);
  await expect(page.getByRole("heading", { level: 1, name: seed.ready.service.nameAr })).toBeVisible();
  await expect(page.getByText(seed.ready.dentists[0]!.nameAr)).toBeVisible();
  expect(await latinWords(page)).toEqual([]);

  await page.getByRole("button", { name: t.ar("Appointment.cancel") }).click();
  await page.getByRole("button", { name: t.ar("Appointment.cancelConfirm") }).click();
  await expect(page.getByText(t.ar("Appointment.cancelledNotice"))).toBeVisible();
});

test("the clinic dashboard is fully Arabic and right-to-left", async ({ page, seed }) => {
  await signIn(page, seed.users.owner.email, "ar");
  await expectRtl(page);
  const nav = page.getByRole("navigation").first();
  for (const key of ["Nav.calendar", "Nav.patients", "Nav.services", "Nav.settings"]) {
    await expect(nav.getByRole("link", { name: t.ar(key) })).toBeVisible();
  }
  expect(await latinWords(page)).toEqual([]);

  for (const path of ["calendar", "services", "dentists", "hours", "settings"]) {
    await page.goto(`/ar/dashboard/${path}`);
    await expectRtl(page);
    await expect(page.locator("main").last().getByRole("heading", { level: 1 })).toBeVisible();
    expect(await latinWords(page), `English left on /ar/dashboard/${path}`).toEqual([]);
  }
});
