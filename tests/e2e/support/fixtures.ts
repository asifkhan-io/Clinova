import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { PASSWORD, type Seed } from "./seed";
import { SEED_FILE } from "./paths";

let counter = 0;

/**
 * Next phone suffix for this run. Kept in a file beside SEED_FILE, not in a
 * module variable: Playwright loads this module afresh for each spec file, so
 * a variable restarted at 0 and two files booked with the same number — and
 * one patient per phone (D7) then merged them into one record. One worker
 * (playwright.config.ts) means no two tests ever increment it at once.
 */
function nextPhoneSeq() {
  const file = `${SEED_FILE}.phone-seq`;
  const next = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
  writeFileSync(file, String(next));
  return next;
}

/**
 * Each test looks like a different visitor (its own address), and books with
 * its own phone numbers, so the booking rate limits (5 per address per hour,
 * 10 per phone per day) never trip across repeated runs.
 */
export const test = base.extend<{ seed: Seed; phone: () => string; pkPhone: () => string }>({
  seed: async ({}, provide) => {
    await provide(JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed);
  },
  extraHTTPHeaders: async ({}, provide, info) => {
    const n = (Date.now() + info.testId.length * 7919 + ++counter) % 65_000;
    await provide({ "x-forwarded-for": `10.${(n >> 8) & 255}.${n & 255}.${(info.retry + 1) % 255}` });
  },
  phone: async ({ seed }, provide) => {
    // Saudi mobile: 05 + 8 digits, unique per run (runId) and per call (phoneSeq).
    await provide(() => `05${seed.runId.slice(-5)}${String(nextPhoneSeq() % 1000).padStart(3, "0")}`);
  },
  pkPhone: async ({ seed }, provide) => {
    // Pakistani mobile as people there type it: 03 + 9 digits.
    await provide(() => `03${seed.runId.slice(-5)}${String(nextPhoneSeq() % 10000).padStart(4, "0")}`);
  },
});
export { expect };

type Messages = typeof en;
const lookup = (messages: Messages, key: string) =>
  key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages) as string;
/** The app's own strings, so tests check the real translations rather than copies. */
export const t = { en: (key: string) => lookup(en, key), ar: (key: string) => lookup(ar as Messages, key) };

export async function signIn(page: Page, email: string, locale: "en" | "ar" = "en") {
  await page.goto(`/${locale}/sign-in`);
  await page.getByLabel(t[locale]("SignIn.email")).fill(email);
  await page.getByLabel(t[locale]("SignIn.password")).fill(PASSWORD);
  await page.getByRole("button", { name: t[locale]("SignIn.submit") }).click();
  await page.waitForURL(/\/dashboard/);
}

/** YYYY-MM-DD in the clinic's time zone, `days` from now. */
export function clinicDate(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
}
