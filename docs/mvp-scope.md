# Clinova — MVP Scope

**Status:** LOCKED — 2026-11-21
**Product:** Multi-tenant online booking SaaS for dental clinics
**Launch market:** Saudi Arabia
**Supersedes:** section 4 of the project instructions
**Decided in:** the seven-question scoping walk, 2026-11-21

Changing anything in §5 or §6 requires a deliberate decision recorded here.

---

## 1. Decisions at a glance

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Launch market | **Saudi Arabia** | Largest GCC private dental market; Arabic+English is a real differentiator; PDPL permits offshore processing with safeguards, so the Vercel/Neon stack survives v1 |
| 2 | Target clinic size | **2–5 dentists**, one location | Real booking pain, owner decides alone, no procurement cycle. Per-dentist scheduling is a superset — solo clinics are the same engine with one `staff` row |
| 3 | Tenant unit | `clinic` = one physical location | Hours and timezone live at the right level from day one; branches arrive later as an `organization` table above clinics, with no migration |
| 4 | User roles | **3 logins** + patients as records | `platform_admin` (clinic records only), `clinic_owner`, `clinic_staff`. Dentists are bookable resources with an optional login. Patients never log in |
| 5 | Booking flow | **Guest, instant confirmed** | The only reason a clinic pays instead of staying on WhatsApp is that bookings land correctly without a human |
| 6 | Notifications | **No automated reminders** + one transactional patient email | SMS and WhatsApp Business API both need a registered company (§9). Email needs none, but is used for link delivery, not reminders |
| 7 | Payments | **None** | Patient deposits mean holding clinics' money (payment-facilitator status, per-clinic KYC, SAMA). Automated billing needs a Stripe-eligible entity — and `status` + manual invoicing already is the v1 billing system |

---

## 2. Target customer

A privately owned dental clinic in Saudi Arabia with **2–5 dentists**, one physical location, and a receptionist who currently manages appointments by phone, WhatsApp and a paper book or a shared Google Calendar.

The buyer is the **clinic owner** — usually also a practising dentist. They decide alone; there is no procurement process to survive.

**The problem being solved:** bookings arrive by phone during working hours, the receptionist is the bottleneck, double bookings happen, and no-shows go unrecorded.

**Supported but not targeted:** single-dentist clinics. The engine handles them at no extra cost, so the first clinic to say yes is not designed away — but marketing and UI assume 2–5.

**What we are not selling to:** multi-branch groups and DSOs (need integrations, SSO and reporting), hospitals.

---

## 3. Roles and permissions

Dentists are **bookable resources**, not necessarily users. A `staff` row holds a dentist's name, services and working hours, with a **nullable** link to a user account. A clinic can be fully configured with one login and three bookable dentists — this is deliberate: in a small clinic the receptionist does all the booking, and requiring logins for colleagues who will never sign in loses customers during onboarding.

| Role | Can do | Cannot do |
|---|---|---|
| `platform_admin` | Create, suspend and change the status of clinic **records** | **Read patient data or appointments.** No impersonation |
| `clinic_owner` | Everything within their clinic: staff, services, prices, hours, closures, booking rules, all appointments | Touch another clinic |
| `clinic_staff` | View calendar, create, reschedule and cancel appointments, manage patient records | Change services, prices, hours, staff, or clinic settings |
| patient | Book, reschedule and cancel via a signed link | Log in — there is no patient account |

Implementation: a `role` enum on a `clinic_members` table, enforced by **one** server-side authorization helper. Explicitly **not** a granular permissions table — over-engineering for three roles.

`platform_admin` lives in its own table, not as a third value in the clinic-role enum: it has no `clinic_id`, and a nullable one on the membership table would break the "every tenant row has a clinic" invariant that the whole isolation story rests on (`database-design.md` DB1).

**Why `platform_admin` cannot read patient data.** Reading it would make Asif a handler of sensitive health information with the §8 obligations attached, and the audit requirement in §5 already treats patient-data access as a sensitive act. Supporting a demo clinic plus three early clinics does not need it; a clinic can send a screenshot. If real support ever needs it, the answer is an explicit, audited, time-boxed impersonation flow — not a standing back door built before anyone asked.

---

## 4. Core booking flow

### Patient (public, unauthenticated)

1. Lands on `/[locale]/c/[clinic-slug]` — Server Component, clinic name, address, services with duration and price
2. Picks a **service** (duration comes from the service — this is what makes slot maths possible)
3. Picks a **dentist, or "any available"**
4. Sees **genuinely open slots**, computed server-side in the clinic's timezone from: dentist working hours − existing appointments − closures and date overrides − buffer − minimum lead time − booking horizon
5. Enters **name and phone**, plus an **optional email**
6. **Confirms** → single transaction: re-check availability, insert under a DB-level overlap constraint
7. Confirmation page with an **`.ics` download** and a **signed link** to reschedule or cancel. If an email was given, the same link and `.ics` are emailed

**Prices are displayed, never charged.** The service list and the confirmation must carry explicit bilingual copy — "pay at the clinic" / «الدفع في العيادة» — so a patient who sees `SAR 300` next to a confirm button cannot think they have paid.

**The signed link:** 32 random bytes in the URL, only the SHA-256 hash stored. The appointment's own id never appears in a patient-facing URL, so the row is non-enumerable and no database key reaches an access log.

### Clinic (authenticated)

- Day and week calendar, per dentist and combined
- Manual booking for walk-ins and phone calls (staff can override availability rules)
- Reschedule, cancel
- Appointment status: `booked`, `completed`, `cancelled`, `no_show`
- Patient list scoped to the clinic — name, phone, appointment history
- One-tap `wa.me` link per appointment so staff send reminders from their own WhatsApp
- Email: booking alert, plus a morning digest of the day's appointments

### Edge cases that are in scope

- **Concurrent booking of the last slot** — prevented by a Postgres exclusion constraint on a `tstzrange` per dentist, not an application-level check. The app catches the violation and tells the second patient the slot just went.
- **Closures and date-specific hour overrides** — required, not optional. Ramadan hours differ sharply from normal hours and Eid closures are certain. A clinic that can only set one weekly schedule produces wrong slots for a month of the year.
- **Hours changed after bookings exist** — existing appointments survive; never cascade-delete.
- **Duplicate patient** — one patient record per `(clinic_id, phone)`.
- **Timezone** — all timestamps stored UTC, clinic timezone stored as an IANA name. Saudi does not observe DST, which removes the nastiest class of scheduling bug at launch; the engine must still be correct for the next market.

---

## 5. In scope

**Platform**
- Multi-tenant: shared database, `clinic_id` on every tenant-owned table, all tenant queries through one data-access layer
- English + Arabic via next-intl, no hardcoded strings; `dir="rtl"` for Arabic; Tailwind logical utilities only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`)
- Locale-aware formatting of dates, times, numbers and currency (SAR)
- `clinic.status` (`trial` | `active` | `suspended`) and `trial_ends_at`, checked in the authorization layer — this is the v1 billing mechanism
- One protected `platform_admin` route to create and suspend clinics

**Clinic setup**
- Clinic profile: name, slug, address, phone, IANA timezone, `clinic_type` (`dental`)
- Services: name (en/ar), duration, price, active flag
- Staff: dentists as bookable resources, optional user link
- Weekly working hours per dentist
- Closures and date-specific hour overrides
- Booking rules: buffer between appointments, minimum lead time, maximum booking horizon, change cutoff, slot granularity
- Invite a `clinic_staff` user

**Public booking** — as §4

**Clinic dashboard** — as §4

**Notifications**
- To the clinic: booking alert email, morning digest of the day's appointments
- To the patient: **one transactional email** on booking, reschedule and cancel, carrying the signed link and the `.ics` — only when an address was given
- Staff `wa.me` one-tap links for manual reminders

**Demo clinic and seed data**
- A seed script creating **two** clinics: a realistic Saudi demo clinic (Arabic and English names, 3 dentists, SAR-priced services, Sunday–Thursday hours with split shifts, a Ramadan `custom_hours` override, an Eid closure, a spread of appointments, patients both with and without an email), and a **minimal second clinic** so tenant isolation is testable at all
- The demo clinic's owner is also linked to a `staff` row, since a clinic owner is usually a practising dentist
- Idempotent; refuses to run against production
- Realistic enough to double as the sales demo later — `Test Dentist 1` fails that second job

**Security**
- Every private route, Server Action and Route Handler authenticated and authorized server-side
- All untrusted input validated with Zod, schemas shared client and server
- Rate limiting on the public booking endpoint and on login
- Audit log for bookings, cancellations, role changes and patient-data access
- Secrets in environment variables only
- **No clinical data**: no notes, no diagnoses, no free-text reason-for-visit field. The service selection already says why the patient is coming.

**Tests**
- Availability engine (hours, closures, buffers, lead time, timezone)
- Double-booking prevention under concurrency
- Tenant isolation — no query returns another clinic's data
- Authorization — every role boundary

---

## 6. Out of scope

Explicitly **not** in v1. Adding any of these requires a decision to change this document.

**Patient-facing:** patient accounts and login · "my appointments" page · patient profiles beyond name, phone and optional email · self-service data-subject requests (see §7.6 and §8)

**Messaging:** SMS · WhatsApp Business API · **automated reminders to patients in any channel** · any patient email beyond the transactional booking, reschedule and cancel notice

**Money:** in-app payment of any kind · patient deposits and prepayment · subscription billing · invoicing · plan and pricing fields in the schema · promo codes · multi-currency

**Structure:** multi-branch and the organization layer · non-dental clinic types in the UI (the schema stays generic; no UI) · dentist self-service logins · chair and operatory scheduling

**Clinical:** notes · diagnoses · treatment plans · multi-visit course-of-treatment booking · x-ray and file uploads · insurance, claims and NPHIES

**Administration:** `platform_admin` read access to patient data or appointments · impersonation of any kind · a real platform-admin product

**Growth and ops:** clinic logo and photo uploads (introduces a storage vendor, image optimization and moderation inside a small-looking feature) · a cross-clinic directory or patient-facing clinic search (the drift that turns a SaaS into a marketplace, and the first deliberately cross-tenant query) · family or multi-slot bookings in one confirmation (breaks the one-appointment-per-transaction model) · patient no-show history flags (patient profiling, a different compliance question) · waitlists and cancellation auto-fill · Google and Outlook calendar sync · reviews and ratings · marketing campaigns and loyalty · analytics beyond the day view · public API and embeddable widget · mobile apps

---

## 7. Known limitations (accepted, not overlooked)

1. **Scheduling is by dentist, not by chair.** A clinic with four dentists and two operatories cannot physically run four simultaneous appointments, and the engine will offer them. At 2–5 dentists chairs roughly equal dentists, so this rarely bites — but it is the first wall a larger clinic hits.
2. **No automated reminders**, which is often the feature clinics ask for first. Two partial mitigations, both free: the `.ics` download means the patient's own phone reminds them, and the staff `wa.me` links put a one-tap reminder in the channel that actually works in this market. Properly solved only after §9.
3. **A patient who gave no email and loses the confirmation link must call the clinic.** The transactional email closes this for everyone who provides an address.
4. **No patient-side booking history.** There is no account to hold one.
5. **Fake bookings** are deterred, not prevented: IP and phone rate limits, a per-phone daily cap, minimum lead time, and staff cancellation. Phone numbers are unverified; SMS OTP arrives with the SMS work.
6. **No self-service data-subject requests.** A patient asking for erasure is handled manually. The *mechanism* is pre-decided — see §8 — so that nobody implements it as a `DELETE`.
7. **Manual invoicing does not scale** past roughly 20 clinics. At 5 clinics it is an advantage — every invoice is a forced conversation with a customer who can tell you why they nearly churned.

---

## 8. Compliance constraints that shaped this scope

Treat all patient data as sensitive health information. **This section is a risk summary, not legal advice** — a lawyer is needed before real patient data is accepted.

**Saudi Arabia (chosen market).** The PDPL does not itself mandate localisation, provided transfer and processing outside the Kingdom complies with the law ([Chambers](https://gpg-pdf.chambers.com/view/158325293/368)). But health data is treated as high-risk, and transfers abroad require Saudi-aligned standard contractual clauses plus a documented transfer risk assessment ([Al Tamimi](https://www.tamimi.com/law-update/the-healthcare-issue/articles/cloud-ai-and-healthcare-outsourcing-in-saudi-arabia-building-regulatory-readiness/)). The Implementing Regulations defer health data to the Ministry of Health and the Saudi Health Council ([Baker McKenzie](https://resourcehub.bakermckenzie.com/en/resources/global-data-and-cyber-handbook/emea/saudi-arabia/topics/key-data-and-cybersecurity-laws)). Proposed amendments to Article 23 raise the open question of whether permission to transfer data abroad also permits **ongoing storage** on offshore cloud infrastructure — so this headroom may narrow. Note also that the PDPL reaches entities **outside** Saudi Arabia that process the data of people inside the Kingdom ([CMS](https://cms.law/en/are/legal-updates/one-year-anniversary-saudi-personal-data-protection-law)) — operating from Pakistan is not an exemption.

**UAE (rejected for launch).** Federal Law No. 2 of 2019 prohibits storing, processing, generating or transferring UAE health data outside the UAE without authority approval, and a copy must be kept in-country even where a transfer is permitted ([Latham & Watkins](https://lw.com/thoughtLeadership/lw-new-uae-law-regulates-healthcare-data), [Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2021/08/me-health-data-in-the-uae-how-the-health-data-law-works-what-it-protects-and-what-exemptions-exist)). It covers DIFC and ADGM. With no UAE hosting region available on the current stack, this would mean a hosting rewrite before customer one.

**Design consequences:** collect the minimum (name, phone, optional email, service, time), no clinical data, never log patient details or put them in URLs or error trackers, and keep data classification clean so classified personal data can be relocated to an in-Kingdom region later without redesign.

### Erasure: anonymize, never delete

A patient may ask for their data to be erased. The schema makes a literal deletion **impossible on purpose**: `appointments → patients` is `ON DELETE RESTRICT`, so that no single statement can wipe a clinic's booking history.

The intended mechanism, recorded now so it is never implemented as a `DELETE` or "fixed" with `CASCADE`:

- Overwrite `full_name` and `phone_e164` with placeholders; keep the appointment rows, so the clinic's history and the audit log stay intact.
- This needs a nullable `anonymized_at` column and `patients_clinic_phone_key` made **partial** (`WHERE anonymized_at IS NULL`) — otherwise two anonymized patients collide on the unique phone index.
- Both are a two-line migration, so they are **not** in the v1 schema. They are pre-designed, not pre-built.

Reaching for `ON DELETE CASCADE` to make an erasure request succeed would destroy a clinic's booking history to satisfy one patient. That is the failure this section exists to prevent.

---

## 9. The entity milestone

Two of three monetization paths are blocked by the same missing piece — a **registered company**:

- **SMS.** Alphanumeric sender ID pre-registration is mandatory for all Saudi A2P traffic, requiring a company registration certificate, an Arabic delegation letter and the authorised person's national ID; every message must match a CST-registered template; URLs in the body must be separately registered or they are filtered; approval runs ~10 business days for international companies. Twilio's Saudi rate is around $0.19/message, which at two messages per booking and 200 bookings/month is roughly $76 per clinic per month — a margin problem against a ~SAR 300 subscription. Local aggregators (Unifonic, Taqnyat, Msegat) are far cheaper but generally want a Saudi entity. ([sent.dm](https://sent.dm/en/resources/sms-compliance/sa-sms-guidance), [Infobip](https://www.infobip.com/docs/essentials/mena-registration/saudi-arabia-letter-of-authorization-loa-guidelines/local-sms-sender-and-template-registration-guideline), [Clickatell](https://clickatell.com/sms-country-regulations/saudi-arabia))
- **Card billing.** Stripe does not operate in Pakistan.

Make incorporation a **deliberate milestone after 2–3 clinics say they would pay** — not a surprise discovered the week you first try to invoice. The MVP's job is to earn the right to spend money on it.

Useful detail for later: transactional and service messages are permitted 24/7 in Saudi Arabia, so appointment confirmations are not restricted to the promotional sending window.

**Patient deposits are a separate thing, with a separate trigger.** They would make Clinova a payment facilitator — per-clinic KYC, split payouts, refunds on clinic-side cancellation, SAMA exposure for holding funds that are not yours. If it ever happens it is a Connect-style marketplace flow where the clinic is the merchant, never a plain checkout where the money lands in Asif's account. The trigger is not "I have an entity" but **a clinic saying no-shows cost them real money and they would charge a deposit.**

---

## 10. Definition of done

The MVP ships when:

1. A clinic can be onboarded end to end — services, dentists, hours, closures, booking rules — **without Asif touching the database**
2. A patient can book, reschedule and cancel in both English and Arabic, with correct RTL layout
3. The availability engine is correct under test for hours, closures, Ramadan overrides, buffers and lead times
4. Concurrent booking of the same slot is impossible, proven by a test
5. Tenant isolation is proven by a test — no query path returns another clinic's data
6. Every role boundary is enforced server-side and tested
7. **Every flow has been run end to end against the demo clinic, in English and Arabic, in all three roles** — clinic owner, clinic staff, and patient

**Phase 10 — first customers (post-MVP):** three real clinics live and taking bookings.

Criterion 7 replaced "three real clinics" because Asif cannot approach clinics yet. Note what was given up: the old criterion forced contact with real users, which is what kept scope honest. Self-testing proves the software works; it cannot tell you the workflow is right — a receptionist's real day is phone-ringing, walk-in, "any time Thursday afternoon", and that is where booking products fail. The compensating rule is in §5: the demo clinic's data must be good enough to show a Saudi clinic owner.

---

## 11. Open questions

| Question | Why it matters | When |
|---|---|---|
| **Better Auth — explicit go-ahead** | `docs/architecture.md` ARCH1 resolves this in favour of Better Auth (Auth.js is security-patch-only since Sept 2025; v5 never left beta). It contradicts instructions §5, so it needs a conscious yes | **Before Phase 0 installs it** — blocks every schema table that references `users.id` |
| **D6 — the availability precedence chain** | `database-design.md` A1 assumes precedence rather than intersection, because intersection drops the evening half of a Ramadan split shift. Confirming costs one query now; changing it after Phase 4 costs a migration | Before Phase 4 |
| Hosting region strategy | Whether to start on a nearest-region deployment or plan in-Kingdom hosting, given §8 | Before first real patient data |
| Does a dental appointment record legally count as "health data"? | Determines how much of §8 actually binds you | Lawyer, before first clinic goes live |
| Data-subject rights in practice | Erasure, access and correction are legal obligations, not features. §8 pre-decides the mechanism; the process and who answers the request are undecided | Lawyer, before first real patient data |
| Audit-log retention policy | PDPL data minimization implies the log cannot grow forever, and patient-access events are the sensitive ones (`database-design.md` DB7) | Before real patient data |
| Pricing | Monthly SAR price, trial length, per-dentist or flat | Before first sales conversation |
| Incorporation jurisdiction | Pakistan, Saudi, or elsewhere — gates SMS and card billing | After 2–3 clinics confirm willingness to pay |

---

## 12. Next steps

Scoping is closed. The build order lives in `docs/architecture.md` §5.

1. **Better Auth go-ahead** (§11 row 1)
2. **Phase 0** — dependencies, Neon project, Drizzle wired, enums + `clinics` migrated, Resend domain verification started
3. **Phase 1** — i18n and RTL shell before any feature
4. **Phase 2** — auth and tenancy, with the isolation and authorization tests
5. **Phase 3** — clinic configuration
6. **Phase 4** — the availability engine, no UI
