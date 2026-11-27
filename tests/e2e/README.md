# Browser tests (Phase 8e, DoD 7)

Playwright clicks through every flow as a real user would, in English and
Arabic, as patient, owner and staff.

| Spec | What it proves |
| --- | --- |
| `patient.spec.ts` | Book on the public page → private link → calendar file → reschedule → cancel. A made-up link reveals nothing. |
| `owner-setup.spec.ts` | An empty clinic becomes bookable through the dashboard alone: service, hours, dentist, booking switch. |
| `staff.spec.ts` | Walk-in booking → calendar → WhatsApp links → cancel → slot free again. |
| `arabic.spec.ts` | Booking and dashboard in Arabic: `lang="ar"`, `dir="rtl"`, real translations, no stray English. |
| `access.spec.ts` | Signed-out redirects, wrong password, staff kept out of Settings and the admin area, no cross-clinic reads. |

## Setup (once)

1. `.env.test` with `TEST_DATABASE_URL` pointing at the Neon `test` branch
   (the same file the integration tests use).
2. `npx playwright install chromium` (about 150 MB, one time).

## Run

```
npm run test:e2e
```

Playwright starts its own dev server on port 3100 against `TEST_DATABASE_URL`,
with email switched off. It refuses to run if that URL is the database in
`.env.local`, and it never reuses a server you started yourself.

Each run creates its own clinics and users (`e2e-…-<runId>`) and deletes them
at the end. `E2E_KEEP=1 npm run test:e2e` keeps them for debugging.

The first run is slow: the dev server compiles each page the first time it is
visited.

On failure: `npx playwright show-trace test-results/<test>/trace.zip` replays it
step by step.
