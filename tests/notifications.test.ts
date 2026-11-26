/**
 * Phase 8d. Email must reach the right people, carry the patient's link to the
 * patient only, keep patient names and phones out of clinic mail, never block
 * or fail a booking, and send each morning digest at most once.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clinicMembers, clinics, notificationRuns, users } from "@/db/schema";
import { localToUtc } from "@/lib/time/zoned";
import { createTestDb } from "./helpers/db";

const testDb = await createTestDb();
const db = testDb.db;
vi.mock("@/server/db/client", () => ({ db: testDb.db }));
// after() exists only inside a real request; here the work is collected so a
// test can wait for it, exactly as the platform would after the response.
const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => {
    pending.push(Promise.resolve().then(task));
  },
}));

const services = await import("@/server/db/repositories/services");
const staffRepo = await import("@/server/db/repositories/staff");
const hours = await import("@/server/db/repositories/hours");
const staffSvc = await import("@/server/services/staff-appointments");
const { appointmentNotice } = await import("@/server/db/repositories/notifications");
const notify = await import("@/server/services/notifications");
const { sendEmail } = await import("@/server/services/email");
const { hashToken } = await import("@/server/services/tokens");
const { GET: cron } = await import("@/app/api/cron/morning-digest/route");

const TZ = "Asia/Riyadh";
const DAY = "2027-01-03";
const NOW = Date.UTC(2027, 0, 1);
const BASE = "https://clinova.test";
const PATIENT = { fullName: "Layla Omar", phoneE164: "+966512340000" };
const ids = {} as Record<"clinic" | "suspended" | "owner" | "service" | "dentist" | "appointment", string>;
let token = "";

const flush = async () => {
  await Promise.all(pending.splice(0));
};
const fetchMock = vi.fn();
type Sent = { to: string[]; subject: string; html: string; text: string };
const sent = (): Sent[] => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Sent);

beforeAll(async () => {
  const [clinic, suspended] = await db
    .insert(clinics)
    .values([
      // A clinic name with markup, to prove the templates escape it.
      { slug: "smile", nameEn: "Smile <b>Dental</b>", nameAr: "عيادة ابتسامة", timezone: TZ },
      { slug: "closed", nameEn: "Closed", nameAr: "مغلقة", timezone: TZ, status: "suspended" },
    ])
    .returning({ id: clinics.id });
  ids.clinic = clinic!.id;
  ids.suspended = suspended!.id;

  const people = await db
    .insert(users)
    .values([
      { name: "Owner", email: "owner@smile.test" },
      { name: "Desk", email: "desk@smile.test" },
      { name: "Former", email: "former@smile.test" },
      { name: "Elsewhere", email: "owner@closed.test" },
    ])
    .returning({ id: users.id });
  ids.owner = people[0]!.id;
  await db.insert(clinicMembers).values([
    { clinicId: ids.clinic, userId: people[0]!.id, role: "clinic_owner" },
    { clinicId: ids.clinic, userId: people[1]!.id, role: "clinic_staff" },
    { clinicId: ids.clinic, userId: people[2]!.id, role: "clinic_staff", isActive: false },
    { clinicId: ids.suspended, userId: people[3]!.id, role: "clinic_owner" },
  ]);

  const ctx = { db, clinicId: ids.clinic, userId: ids.owner, role: "clinic_owner", clinicStatus: "trial" } as const;
  ids.service = (await services.createService(ctx, { nameEn: "Cleaning", nameAr: "تنظيف", descriptionEn: null, descriptionAr: null, durationMinutes: 30, priceMinor: null })).id;
  ids.dentist = (await staffRepo.createStaff(ctx, { displayNameEn: "Dr Sara", displayNameAr: "د. سارة", titleEn: null, titleAr: null })).id;
  await hours.replaceStaffHours(ctx, ids.dentist, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 480, endMinute: 1080 })));
  const booked = await staffSvc.createStaffAppointment(
    ctx,
    { serviceId: ids.service, staffId: ids.dentist, startMs: localToUtc(DAY, 9 * 60, TZ)!, ...PATIENT },
    NOW,
  );
  if (!booked.ok) throw new Error("setup: booking failed");
  ids.appointment = booked.appointmentId;
  token = booked.token;
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Clinova <onboarding@resend.dev>");
  vi.stubEnv("BETTER_AUTH_URL", `${BASE}/`);
  vi.stubEnv("CRON_SECRET", "s3cret-value");
});

afterEach(async () => {
  await flush();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("what the emails say", () => {
  it("gives the patient their own link and calendar file, in the language they booked in", async () => {
    const notice = (await appointmentNotice(db, ids.appointment))!;
    const mail = notify.patientBookingEmail(notice, token, "ar", BASE);
    expect(mail.html).toContain(`${BASE}/ar/a/${token}`);
    expect(mail.html).toContain(`${BASE}/api/public/a/${token}/ics?lang=ar`);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.subject).toContain("عيادة ابتسامة");
    expect(mail.text).toContain("الدفع في العيادة");
  });

  it("escapes clinic-typed text, so a name cannot inject markup", async () => {
    const notice = (await appointmentNotice(db, ids.appointment))!;
    const mail = notify.patientBookingEmail(notice, token, "en", BASE);
    expect(mail.html).toContain("Smile &lt;b&gt;Dental&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Dental</b>");
  });

  it("tells the clinic what changed in both languages, and never the patient's name or phone", async () => {
    const notice = (await appointmentNotice(db, ids.appointment))!;
    const mail = notify.clinicAlertEmail(notice, "booked", BASE);
    expect(mail.html).toContain('lang="ar"');
    expect(mail.html).toContain('lang="en"');
    expect(mail.html).toContain(`${BASE}/en/dashboard/appointments/${ids.appointment}`);
    expect(mail.html).toContain(`${BASE}/ar/dashboard/appointments/${ids.appointment}`);
    for (const part of [mail.subject, mail.html, mail.text]) {
      expect(part).not.toContain("Layla");
      expect(part).not.toContain("512340000");
      expect(part).not.toContain(token);
    }
  });
});

describe("delivery after a booking", () => {
  it("emails the patient once, and each active clinic member separately", async () => {
    notify.notifyPublicBooking({ appointmentId: ids.appointment, token, locale: "en", patientEmail: "layla@example.test" });
    await flush();
    const recipients = sent().map((m) => m.to);
    expect(recipients).toHaveLength(3);
    for (const to of recipients) expect(to).toHaveLength(1);
    expect(recipients.flat().sort()).toEqual(["desk@smile.test", "layla@example.test", "owner@smile.test"]);
    const toPatient = sent().find((m) => m.to[0] === "layla@example.test")!;
    expect(toPatient.html).toContain(`/en/a/${token}`);
    for (const m of sent().filter((m) => m.to[0] !== "layla@example.test")) expect(m.html).not.toContain(token);
  });

  it("only alerts the clinic when the patient gave no address", async () => {
    notify.notifyPublicBooking({ appointmentId: ids.appointment, token, locale: "en" });
    await flush();
    expect(sent().map((m) => m.to[0]).sort()).toEqual(["desk@smile.test", "owner@smile.test"]);
  });

  it("alerts the clinic when a patient moves or cancels through their link", async () => {
    notify.notifyPatientChange(hashToken(token), "cancelled");
    await flush();
    expect(sent()).toHaveLength(2);
    expect(sent()[0]!.subject).toContain("cancelled by the patient");
  });

  it("sends nothing, and fails nothing, when email is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    notify.notifyPublicBooking({ appointmentId: ids.appointment, token, locale: "en", patientEmail: "layla@example.test" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a provider failure instead of surfacing it", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    notify.notifyPublicBooking({ appointmentId: ids.appointment, token, locale: "en" });
    await expect(flush()).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

describe("the sender", () => {
  it("posts one message to Resend with the key and an idempotency key", async () => {
    const result = await sendEmail({ to: ["a@b.test"], subject: "s", html: "<p>h</p>", text: "h", idempotencyKey: "k1" });
    expect(result).toEqual({ ok: true, id: "em_1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("k1");
  });

  it("reports a refusal without throwing", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 422 }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail({ to: ["a@b.test"], subject: "s", html: "h", text: "h" })).toEqual({ ok: false, reason: "rejected" });
    quiet.mockRestore();
  });
});

describe("the morning digest", () => {
  const at = (day: string, hour: number, minute = 0) => localToUtc(day, hour * 60 + minute, TZ)!;

  it("waits for 07:00 on the clinic's own clock", async () => {
    const run = await notify.runMorningDigests(at(DAY, 8, 30), db);
    expect(run.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the day's list once, however many times the cron fires", async () => {
    const first = await notify.runMorningDigests(at(DAY, 7, 10), db);
    expect(first.sent).toBe(1);
    expect(sent().map((m) => m.to[0]).sort()).toEqual(["desk@smile.test", "owner@smile.test"]);
    const digest = sent()[0]!;
    expect(digest.subject).toContain("1 appointment");
    expect(digest.html).toContain("Dr Sara");
    expect(digest.html).not.toContain("Layla");

    fetchMock.mockClear();
    const second = await notify.runMorningDigests(at(DAY, 7, 40), db);
    expect(second.sent).toBe(0);
    expect(second.alreadySent).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays quiet on a day with nothing booked", async () => {
    const run = await notify.runMorningDigests(at("2027-01-04", 7, 5), db);
    expect(run.empty).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a suspended clinic entirely", async () => {
    await notify.runMorningDigests(at("2027-01-05", 7, 5), db);
    const claims = await db.select().from(notificationRuns).where(eq(notificationRuns.clinicId, ids.suspended));
    expect(claims).toEqual([]);
  });
});

describe("GET /api/cron/morning-digest", () => {
  const call = (auth?: string) =>
    cron(new Request("https://clinova.test/api/cron/morning-digest", auth ? { headers: { authorization: auth } } : {}));

  it("refuses everyone when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer anything")).status).toBe(503);
  });

  it("refuses a missing or wrong secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-value")).status).toBe(401);
  });

  it("runs for Vercel's own request", async () => {
    const response = await call("Bearer s3cret-value");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: expect.any(Number) });
  });
});
