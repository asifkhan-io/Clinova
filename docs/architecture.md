# Clinova — Architecture, Setup and Build Order

**Status:** Proposal for review — nothing installed yet
**Date:** 2026-11-21
**Amended:** 2026-11-21 — §3.4 added (Cache Components, ARCH8); §4.1 rewritten to match the scaffold as it now stands
**Depends on:** `mvp-scope.md`, `user-flows.md`, `database-design.md`
**Feeds into:** Phase 0 setup
**Resolves:** scope §11 open question 1 (Auth.js vs Better Auth)

---

## 1. The auth decision — resolved, and it amends the stack

Project instructions §5 names Auth.js and asks me to **confirm it is actively
maintained** and compare it with Better Auth before committing. I checked. It is
not, and this is the one place where the instructions' own premise has gone
stale.

**What the evidence says:**

- In **September 2025** the Auth.js team joined the Better Auth project, and
  Auth.js moved to **security-patch-only mode** — critical fixes continue, no new
  feature development. The Better Auth maintainers now publish Auth.js security
  advisories themselves, and did so for four CVEs in July 2026 across
  `@auth/core`, next-auth v4 and next-auth v5.
- **v5 never shipped stable.** As of late 2026 the npm `latest` tag for
  `next-auth` still resolves to the **v4** line (4.24.15); v5 sits on the beta
  tag at `5.0.0-beta.32`, roughly three years into beta. Many teams run that beta
  in production, which mattered when a **critical fail-open vulnerability** was
  disclosed against v5 beta in July 2026.
- **Vercel acquired Better Auth in July 2026**, so both projects share an owner —
  and that owner recommends Better Auth for new projects.
- Better Auth is on the ~1.7.x line with roughly 2.3M weekly downloads and active
  feature development.

**Recommendation: Better Auth.** Three reasons specific to Clinova, in order of
weight:

1. **"Actively maintained" was a requirement, not a preference.** Building a
   product that will hold patient data on a library in security-patch-only mode,
   whose current release is a three-year beta with a recent fail-open CVE, is the
   wrong foundation. This is the whole reason §5 asked the question.
2. **It has the primitives this product needs natively** — organizations,
   members, invitations, role-based access, 2FA and passkeys. Auth.js has none of
   those; you would build them. Two-factor for clinic owners is a plausible
   near-term ask once real patient data is in there.
3. **The migration cost is zero today and non-trivial in two months.** Nothing is
   built yet.

**What it costs:** a smaller community and less accumulated Stack Overflow
history than Auth.js's eight years — a real cost for someone learning backend
work. Mitigated by better first-party docs and type inference, and by the fact
that Clinova uses auth for email/password plus sessions, not an exotic
provider matrix.

**What changes in the schema: nothing.** `database-design.md` assumption A2 kept
every Clinova column out of `users` precisely so this decision stayed cheap.
Better Auth owns four tables; our ten domain tables reference `users.id` and
nothing else.

Two mechanical notes for Phase 2:

- Better Auth's default table names are **singular** (`user`, `session`,
  `account`, `verification`). Our foreign keys say `users`. Map the names in
  Better Auth's schema config rather than renaming our FKs — the domain schema
  should not bend to the auth library.
- **Do not adopt the organization plugin for clinics.** It is tempting — it
  models organizations, members and invitations, which looks like `clinics` +
  `clinic_members` + `invites`. But `clinics` carries fifteen domain columns
  (timezone, booking rules, status, slug, `booking_enabled`) that do not belong
  in an auth plugin's table, the authorization guard must check
  `clinic.status`, and `database-design.md` §6's composite foreign keys need
  `clinics.id` as a stable domain key. Use Better Auth for **identity only**.
  **[ARCH1]**

**One finding that confirms an existing decision.** The 2025–2026 Next.js auth
CVEs demonstrated that middleware-only authentication is unsafe — middleware can
be bypassed. `user-flows.md` §1 already requires every Server Action and private
route to call the guard itself. Keep that absolutely: **middleware is for locale
routing and redirect UX, never the authorization boundary.**

Sources:
- [Auth.js security update, July 2026 (Better Auth)](https://better-auth.com/blog/security-update-july-2026)
- [Auth.js (NextAuth.js) review, v5 status](https://startwithidentity.com/vendors/open-source/authjs/)
- [Next.js App Router authentication in 2026](https://heyneuron.com/en/blog/nextjs-app-router-authentication-guide-2026)
- [Auth.js vs Better Auth 2026](https://gautamkhorana.com/authentication/compare/authjs-vs-better-auth/)
- [next-auth discussion #13382 — v5 beta duration](https://github.com/nextauthjs/next-auth/discussions/13382)

---

## 2. Folder structure

```
clinova/
├── app/
│   ├── [locale]/
│   │   ├── layout.tsx                      # lang + dir + fonts + NextIntlClientProvider
│   │   ├── (public)/
│   │   │   ├── c/[slug]/page.tsx            # clinic page (Server Component)
│   │   │   ├── c/[slug]/book/page.tsx       # booking wizard
│   │   │   └── a/[token]/page.tsx           # view / reschedule / cancel
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── invite/[token]/page.tsx
│   │   ├── (dashboard)/dashboard/
│   │   │   ├── layout.tsx                   # calls requireClinicAccess()
│   │   │   ├── page.tsx                     # today
│   │   │   ├── setup/page.tsx               # onboarding checklist (derived state)
│   │   │   ├── calendar/page.tsx
│   │   │   ├── services/page.tsx
│   │   │   ├── staff/page.tsx
│   │   │   ├── hours/page.tsx
│   │   │   ├── closures/page.tsx
│   │   │   ├── patients/page.tsx
│   │   │   ├── patients/[id]/page.tsx
│   │   │   ├── team/page.tsx
│   │   │   └── settings/page.tsx
│   │   └── (admin)/admin/
│   │       ├── layout.tsx                   # calls requirePlatformAdmin()
│   │       └── clinics/{page.tsx,new/page.tsx}
│   ├── api/
│   │   ├── auth/[...all]/route.ts           # Better Auth handler
│   │   ├── public/c/[slug]/availability/route.ts
│   │   ├── public/a/[token]/calendar.ics/route.ts
│   │   └── cron/morning-digest/route.ts
│   └── globals.css
│
├── server/                                  # never imported from a Client Component
│   ├── auth/
│   │   ├── config.ts                        # Better Auth instance
│   │   ├── session.ts                       # cached session read
│   │   └── guards.ts                        # requireClinicAccess, requirePlatformAdmin
│   ├── db/
│   │   ├── client.ts                        # the ONLY file that constructs `db`
│   │   └── repositories/                    # clinic-scoped queries live here, nowhere else
│   │       ├── clinics.ts    services.ts    staff.ts
│   │       ├── hours.ts      overrides.ts   patients.ts
│   │       ├── appointments.ts              members.ts
│   │       └── audit.ts
│   ├── services/                            # business logic, no SQL, no React
│   │   ├── availability/
│   │   │   ├── resolve-intervals.ts         # the precedence chain (pure)
│   │   │   ├── generate-slots.ts            # intervals -> slot instants (pure)
│   │   │   └── query.ts                     # the SQL from database-design §9
│   │   ├── booking.ts                       # create / reschedule / cancel
│   │   ├── onboarding.ts                    # derived checklist state
│   │   └── rate-limit.ts
│   ├── actions/                             # Server Actions: guard -> Zod -> service
│   │   ├── clinics.ts    services.ts    staff.ts
│   │   ├── hours.ts      booking.ts     team.ts
│   └── email/
│       ├── client.ts
│       └── templates/{booking-alert.tsx,morning-digest.tsx,invite.tsx}
│
├── db/
│   ├── schema/
│   │   ├── enums.ts    auth.ts      clinics.ts
│   │   ├── members.ts  services.ts  staff.ts
│   │   ├── hours.ts    patients.ts  appointments.ts
│   │   ├── audit.ts    index.ts
│   └── migrations/
│       ├── 0001_init.sql                    # drizzle-kit generate
│       └── 0002_constraints.sql             # HAND-WRITTEN — database-design §7
│
├── lib/                                     # shared, client-safe
│   ├── i18n/{routing.ts,request.ts,format.ts}
│   ├── validation/                          # Zod schemas — client AND server
│   │   ├── booking.ts  clinic.ts  service.ts  staff.ts  hours.ts
│   ├── time/{minutes.ts,zones.ts}
│   └── tokens.ts                            # generate + sha256
│
├── components/
│   ├── ui/                                  # shadcn primitives
│   ├── booking/{service-picker,dentist-picker,date-picker,slot-grid}.tsx
│   └── dashboard/{calendar-day,calendar-week,hours-editor}.tsx
│
├── messages/{en.json,ar.json}
├── tests/
│   ├── unit/availability/                   # the big one
│   ├── integration/{tenant-isolation,authorization,concurrency}.test.ts
│   ├── fixtures/seed.ts
│   └── e2e/{book-en.spec.ts,book-ar.spec.ts}
├── docs/                                    # mvp-scope, user-flows, database-design, architecture
├── .github/workflows/ci.yml                 # lint + typecheck
├── drizzle.config.ts  middleware.ts  vitest.config.ts  playwright.config.ts
└── .env.example                             # committed; .env.local is not
```

Three structural rules carry the project instructions' §9 point 5 (business logic
separate from UI):

**`app/` holds no business logic and no SQL.** A page renders; a Server Action
calls a guard, parses with Zod, and delegates to a service. If a file in `app/`
imports from `server/db/`, that is the smell.

**`server/services/` holds no SQL and no React.** It takes a tenant context and a
parsed input, calls repositories, and returns typed results. This is what makes
the availability engine testable as pure functions in Phase 4 before any UI
exists.

**`lib/` is client-safe; `server/` is not.** The Zod schemas in
`lib/validation/` are imported by both sides — that is the "shared between client
and server" requirement from §5, and it only works if those files import nothing
from `server/`.

---

## 3. The three cross-cutting layers

### 3.1 Tenant isolation — how "scoped by clinic" stops being optional

The instructions require every tenant query to be scoped through one data-access
layer. The hard part is *enforcement*: a convention that every query carries
`where clinicId = …` is one forgotten line away from a cross-tenant leak, and
that leak looks like a data bug rather than a security bug.

Three ways to enforce it:

| Approach | Protects | Cost |
|---|---|---|
| Convention + code review | nothing mechanically | free, and fails the first tired evening |
| **Repository layer + restricted imports** | missing filters on reads, by construction | one lint rule, one module boundary |
| Postgres RLS (`SET LOCAL app.clinic_id`) | missing filters even in ad-hoc SQL | every read needs a transaction on a pooled connection; policies are as easy to get wrong as a `where`, and harder to debug |

**Recommendation: the repository layer now, RLS as the upgrade path** when there
is a second engineer or an audit requirement. Two mechanisms do the work:

```ts
// server/db/repositories/appointments.ts
// Every exported function takes the context as its first argument. There is no
// overload without it, so "forgetting" the clinic filter is a type error.
export async function listForDay(ctx: ClinicContext, day: Date) {
  return ctx.db.select().from(appointments)
    .where(and(eq(appointments.clinicId, ctx.clinicId), /* … */));
}
```

```js
// eslint.config.js — the module boundary, checked in CI
{
  files: ['app/**', 'components/**', 'server/services/**', 'server/actions/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/server/db/client'],
        message: 'Import a repository from server/db/repositories instead. ' +
                 'Only repositories may construct queries.',
      }],
    }],
  },
}
```

Note what this does **not** cover: bad *writes*. A repository will happily insert
a row whose `clinic_id` is clinic A and whose `staff_id` belongs to clinic B.
That is what `database-design.md` §6's composite foreign keys are for. The two
mechanisms are complementary — the lint rule guards reads, the database guards
writes — and together they make definition-of-done criterion 5 a short test
rather than an audit.

### 3.2 The authorization guard

```ts
// server/auth/guards.ts
export type ClinicContext = {
  db: Database;
  clinicId: string;          // from the session membership — NEVER from a URL or form
  userId: string;
  role: 'clinic_owner' | 'clinic_staff';
  clinicStatus: 'trial' | 'active' | 'suspended';
};

export async function requireClinicAccess(
  minRole: 'clinic_owner' | 'clinic_staff' = 'clinic_staff',
): Promise<ClinicContext>;

export async function requirePlatformAdmin(): Promise<AdminContext>;
```

One function, one query joining `clinic_members` to `clinics`, called as the
first line of every private route, layout, Server Action and Route Handler.

It returns the `clinic_id`. It never accepts one. `user-flows.md` §1 names a
caller-supplied `clinic_id` as the single most likely tenant-isolation bug, and
the signature above is what makes it unavailable.

`clinicStatus` comes back so mutations can refuse on `suspended` — the commercial
lever from scope §5 enforced in the authorization layer, exactly where it was
specified.

**Middleware does not call this.** Middleware handles locale and redirects
unauthenticated users for UX. The 2025–2026 Next.js CVEs showed middleware can be
bypassed; treating it as the boundary is how products get breached.

### 3.3 i18n, RTL and the middleware matcher

```ts
// middleware.ts
import createMiddleware from 'next-intl/middleware';
import { routing } from '@/lib/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Locale handling applies to pages only. API routes must never be rewritten:
  // /api/public/* is consumed by fetch, /api/cron/* by a scheduler, and
  // /api/auth/* by Better Auth — none of them have a locale.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

```ts
// lib/i18n/format.ts — user-flows.md §10
// A bare 'ar-SA' locale resolves to the Umm al-Qura Islamic calendar AND
// Arabic-Indic digits. A confirmation that silently changes calendar system is a
// support ticket. Pin both.
export function clinicDateTime(locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  });
}
```

`app/[locale]/layout.tsx` sets `lang` and `dir` from the locale and loads a font
with real Arabic coverage (IBM Plex Sans Arabic or Cairo, per instructions §6)
through `next/font`.

**Tailwind logical utilities only** — `ms-`, `me-`, `ps-`, `pe-`, `start-`,
`end-`. Add an ESLint rule or a review checklist item banning `ml-`, `mr-`,
`left-`, `right-`; it is far cheaper than finding them in Phase 7.

### 3.4 Cache Components — the fourth cross-cutting layer, already switched on

`next.config.ts` ships with `cacheComponents: true` and `partialPrefetching:
true`. These are the `create-next-app` defaults in Next 16.4, not an opt-in to
weigh later: the app is already in this model, and both options disappear in the
next major when the behaviour becomes universal. Three consequences, ordered by
how expensive they are to discover late.

**1. `GET` Route Handlers prerender like pages.** With Cache Components enabled, a
`GET` Route Handler follows the same prerendering model as a page. That lands
directly on `app/api/public/c/[slug]/availability/route.ts` — the one endpoint in
this product that must never serve a stale answer, because a prerendered slot
grid is a double-booking funnel that the exclusion constraint will then have to
catch at the last moment. It must read request-time data so it is never lifted
into the static shell. Prove it in Phase 5: book a slot, immediately re-request
availability, assert the slot is gone.

**2. A session read cannot be prerendered.** `requireClinicAccess()` reads the
session cookie, so every layout, page, Server Action and Route Handler that calls
it is request-time by definition, and the dashboard shell streams behind a
`<Suspense>` boundary instead of sitting in the static shell. Three mechanics
worth knowing before Phase 2:

- `use cache` and `use cache: remote` **cannot** call `cookies()` or `headers()`.
  Do not try to wrap the guard in one.
- `use cache: private` is the only scope that can read them. It keeps the result
  in the browser and never on the server.
- `export const instant = false` on a page or layout lets it keep blocking on the
  server while you learn the model. A stepping stone, not a destination.

Next ships the guide locally, which is the version that matches what is
installed:
`node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`.

**3. Never put a server cache in front of tenant data.** A cache directive keys on
its arguments *and* on anything captured from an enclosing scope, so a cached
function returning patient or appointment rows is a cross-tenant leak waiting for
one mistaken key — and a copy of patient data living in a cache layer is a PDPL
surface that `mvp-scope.md` §8 does not account for. The rule: **no cache
directive anywhere in `server/db/repositories/`, and none on any function that
returns patient data.** `use cache: private` is not an exemption; the data still
leaves the database.

**What the model buys, used deliberately.** The public clinic page splits cleanly
along exactly the right seam. Clinic name, address and the service list change
rarely and are identical for every visitor: cache those with an explicit
`cacheLife` and a per-clinic `cacheTag`, invalidated when the owner edits
services, so the page shell prerenders and prefetches. The slot grid streams in
behind it at request time. Instant page, live slots — which is the correct shape
for the money path in Phase 5.

Pair **every** cache directive with a `cacheLife`; without one the implicit
`default` profile applies, and an unintended lifetime on clinic configuration is
a clinic wondering why its new service has not appeared. **[ARCH8]**

---

## 4. Phase 0 — setup commands

Run these in order. Each step says what you should see.

### 4.1 Scaffold — done

The app exists: `clinova/` on `main`, pushed to `asifkhan-io/Clinova`, deployed to
Vercel. Installed: **Next 16.4.6**, React 19.3.0, TypeScript 5 with `strict`,
**Tailwind v4.3.3** (CSS-first — no `tailwind.config`, theme in `app/globals.css`,
loaded through the `@tailwindcss/turbopack` rule in `next.config.ts`), ESLint 9
flat config. `app/` at the root, no `src/`, import alias `@/*`.

Applied 2026-11-21, before any feature work:

- `tsconfig.json` — `"noUncheckedIndexedAccess": true`. Catches `slots[i]` being
  possibly `undefined`, which is Phase 4's main bug class.
- `package.json` — `"typecheck": "next typegen && tsc --noEmit"`. The order
  matters: `app/layout.tsx` uses the generated `LayoutProps<"/">` global, so a
  bare `tsc --noEmit` fails in a clean checkout. `next typegen` writes those
  route types without a full build.
- `package.json` — `"engines": { "node": ">=20.9.0" }`, which is `next@16.4.6`'s
  own requirement.
- `.gitignore` — `!.env.example`. The scaffold's `.env*` rule would otherwise
  have silently ignored the example file §4.6 asks you to commit.
- `.github/workflows/ci.yml` — lint + typecheck on push and pull request. Keep
  the workflow's Node version in step with the Vercel project's.

Still open in Phase 0: dependencies (§4.2), the Drizzle client (§4.3), Neon
(§4.4), Resend domain verification (§4.5), `.env.example` (§4.6).

### 4.2 Dependencies

```bash
# Database — driver choice matters, see 4.3
npm i drizzle-orm @neondatabase/serverless
npm i -D drizzle-kit

# Validation, i18n, auth
npm i zod next-intl better-auth

# UI
npx shadcn@latest init

# Tests
npm i -D vitest @vitejs/plugin-react vite-tsconfig-paths
npm init playwright@latest
```

**What is deliberately absent:** no date library (`Intl` plus the
minutes-from-midnight arithmetic from `database-design.md` A3 covers everything,
and a date library invites local-time arithmetic, which is the bug class we are
avoiding); no state manager (Server Components plus `useState`); no ORM other
than Drizzle; no rate-limit vendor yet (§4.5).

### 4.3 The Drizzle driver trap — read before writing `client.ts`

Neon offers three Drizzle entry points and **one of them will break Phase 5**:

| Entry point | Interactive transactions |
|---|---|
| `drizzle-orm/neon-http` (via `neon()`) | **No** |
| `drizzle-orm/neon-serverless` (via `Pool`) | Yes |
| `drizzle-orm/node-postgres` | Yes |

The booking flow needs real transactions: `createPublicBooking` re-checks
availability, upserts the patient and inserts the appointment as one unit, and
`reschedulePublicBooking` does `SELECT … FOR UPDATE` first. The HTTP driver
cannot express that. Starting on `neon-http` because it appears in most tutorials
means rewriting the data layer the week you implement booking.

```ts
// server/db/client.ts — the only file that constructs `db`
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '@/db/schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });
export type Database = typeof db;
```

If your Node version has no global `WebSocket`, set
`neonConfig.webSocketConstructor` from the `ws` package — check before assuming
either way.

### 4.4 Database

Create a Neon project, then **two** connection strings in the environment: the
pooled one for the app, and a direct one for migrations. DDL — especially the
`CREATE EXTENSION` and exclusion constraints in `0002_constraints.sql` — should
not go through a connection pooler.

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
  strict: true,
  verbose: true,
});
```

```jsonc
// package.json
"scripts": {
  "db:generate": "drizzle-kit generate",
  "db:migrate":  "drizzle-kit migrate",
  "typecheck":   "next typegen && tsc --noEmit",
  "test":        "vitest run",
  "test:e2e":    "playwright test"
  // NOTE: no "db:push". Deliberately. See below.
}
```

**There is no `db:push` script and that is the point.** `drizzle-kit push`
diffs the schema and applies changes directly — and because Drizzle cannot
express exclusion constraints, it does not know about `appointments_no_overlap`
and will drop it. That constraint is the only thing preventing double bookings.
Not having the script in `package.json` means nobody runs it at 2am by muscle
memory.

### 4.5 Two service decisions, with costs

Instructions §5 requires justifying any added service. Both of these are needed
in Phase 8 but one has **external lead time**, so it starts now.

**Email — Resend.** Needed for clinic booking alerts and the morning digest
(`user-flows.md` §4, §10). Why: simple API and React email templates, so the
bilingual templates reuse components. Cost: a free tier that comfortably covers
three clinics' alert volume — verify the current limits, they change.
Alternative: AWS SES, materially cheaper at scale and more setup, including a
production-access request. **Start on Resend, move to SES if volume ever makes it
matter.**

⚠️ **Verify the sending domain in Phase 0, not Phase 8.** DNS propagation plus
provider verification has real lead time, and nothing about it is in your
control. A Phase 8 that stalls on DNS is an avoidable stall.

**Rate limiting — Postgres, not a vendor.** Needed on the public booking
endpoint, on login, and for the per-phone daily cap (`user-flows.md` §6, §7).

| Option | Verdict |
|---|---|
| Upstash Redis + `@upstash/ratelimit` | Purpose-built and fast, but a new vendor, and IP-derived data lands in a third system — a PDPL surface (scope §8) for no MVP benefit |
| **Postgres fixed-window counter table** | No new vendor, no new secret, one table. Costs one upsert per public request, which is nothing at this scale. **Recommended.** |
| Vercel firewall rules | Good coarse IP flood protection at the platform edge; cannot express a per-phone daily cap. Use *alongside*, not instead |

The per-phone cap has to live in application code against our own data anyway, so
a Redis limiter would only ever cover half the requirement.

**This adds a table that `database-design.md` does not have:**
`rate_limit_counters (key text, window_start timestamptz, count int)` with a
primary key on `(key, window_start)` and a periodic delete of old windows. Small,
but it is a schema change and should be recorded rather than smuggled in.
**[ARCH2]**

### 4.6 Environment variables

```bash
# .env.example — committed. .env.local is gitignored and holds the real values.
DATABASE_URL=                 # Neon pooled — the app
DATABASE_URL_UNPOOLED=        # Neon direct — migrations only
BETTER_AUTH_SECRET=           # openssl rand -base64 32
BETTER_AUTH_URL=              # http://localhost:3000 in dev
RESEND_API_KEY=
EMAIL_FROM=
CRON_SECRET=                  # the morning-digest route must verify this
APP_TOKEN_PEPPER=             # extra entropy for appointment-token hashing
```

Secrets in environment variables only, never committed (instructions §7).
`.env.example` carries the *names* so the next person knows what to fill in.

### 4.7 Cron — check your plan before relying on hourly

`user-flows.md` §10 requires the morning digest to run **hourly**, so it can mail
each clinic at 07:00 *local* time; a single daily cron cannot serve two
timezones, and the next market will have several.

Vercel's cron frequency limits depend on your plan, and the lower tiers have
historically been restricted to daily. Check yours before Phase 8 depends on it.
If hourly is not available, an external scheduler calling the route with
`CRON_SECRET` works and costs nothing. Either way the route verifies the secret
and is idempotent per clinic per day.

---

## 5. Build order

Two principles shape this, and both cut against the obvious ordering.

**Vertical slices, not horizontal layers.** Do not build all the schema, then all
the services, then all the UI. Each phase goes end to end on a narrow slice, so
you find integration problems while they are cheap.

**Risk first.** Auth-plus-tenancy and the availability engine are the two things
that are expensive to get wrong and expensive to retrofit. They come early, not
last. Notice that definition-of-done criteria 5 and 6 — the tenant-isolation and
authorization tests — land in Phase 2 rather than in a hardening phase at the
end, where they would be discovering problems far too late.

| Phase | What | Done when |
|---|---|---|
| **0** | Scaffold ✅, CI type-check ✅, deps, strict TS ✅, Neon, Drizzle wired, enums + `clinics` migrated. **Start Resend domain verification.** | `db:migrate` applies to a Neon branch; `typecheck` passes in CI |
| **1** | i18n + RTL shell: `[locale]` routing, next-intl, both message files, Arabic font, `dir` switching, the pinned formatter | One page renders correctly at `/en` and `/ar`; Arabic shows Gregorian dates and Latin digits |
| **2** | **Auth + tenancy.** Better Auth, `clinic_members`, `invites`, `platform_admins`, the guards, the restricted-import lint rule, the §3.4 session-read pattern. Admin creates a clinic → owner is invited → claims → empty dashboard | Two clinics exist and neither can read the other's rows. **DoD 5 and 6 tests pass.** |
| **3** | Clinic configuration: services, staff, `staff_services`, hours, overrides, all owner CRUD, derived onboarding checklist | **DoD 1** — a clinic fully configured without touching the database |
| **4** | **Availability engine. No UI.** Precedence resolver, slot generation, the §9 SQL, the fixture database, the Vitest matrix | **DoD 3** — correct for every precedence rule, buffers, lead time, horizon, Ramadan, Eid, split shifts, and `Europe/Berlin` DST |
| **5** | Public booking: clinic page, wizard, availability Route Handler (request-time, §3.4), `createPublicBooking`, token page, `.ics` | **DoD 2 (book) and 4** — concurrent booking of the last slot proven impossible |
| **6** | Reschedule + cancel, patient and staff variants, `ics_sequence` | **DoD 2** complete in both locales |
| **7** | Dashboard operations: day/week calendar, manual booking, statuses, patient list, `wa.me` links | A receptionist can run a day without the phone book |
| **8** | Email alerts, morning digest cron, rate limiting, audit-log surfacing, Playwright happy paths in both locales | Green E2E in `en` and `ar` |
| **9** | Deploy, domain, hosting-region decision, onboard clinic one | **DoD 7** — the only criterion that actually matters |

Four notes on the ordering.

**Phase 1 before any feature.** Instructions §6 and `user-flows.md` §10 both say
RTL from the start, and the flows doc is specific that the risk concentrates in
the date picker and the slot grid. Those get built in Phase 5. If Arabic arrives
after them, Phase 5 gets rebuilt. Arabic is not a phase — it is a constraint from
the first component.

**Phase 4 ships no UI, on purpose.** The availability engine is the riskiest logic
in the product and the cheapest place to test it is a pure function against a
fixture database. Build the slot grid first and you will debug precedence rules
through a date picker, which is slow and teaches you nothing.

**Phase 5 is the money path.** Everything before it is setup; it is the first
phase where the product does the thing a clinic would pay for. If a phase has to
be cut, cut from 7 and 8.

**Phase 2's tests are not ceremony.** "No query returns another clinic's data" is
a sentence you either prove in Phase 2 or discover in production. With the
repository boundary and the composite FKs in place, proving it is a short test.

No week estimates here deliberately — I do not know your velocity, and a schedule
invented by me would be fiction you then feel behind on. The *order* is the part
that is worth being opinionated about.

---

## 6. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | The precedence resolver and slot generation as pure functions — the biggest and most valuable suite |
| Integration | Vitest + a real Neon branch | Tenant isolation, every authorization boundary, concurrent booking against the exclusion constraint |
| E2E | Playwright | Book / reschedule / cancel in `en` and `ar`, including `dir="rtl"` layout |

**Use Neon branching for test isolation.** A branch per CI run gives every test
suite a real Postgres with the real exclusion constraints — which matters, because
the three correctness guarantees in this product (no overlap, no cross-tenant
row, cancelled slots freeing themselves) are all enforced by the database and
cannot be tested against a mock. This is a genuine reason the Neon choice earns
its place rather than just being a hosted Postgres.

**The concurrency test needs two real connections.** Fire two `createPublicBooking`
calls at the same slot from separate clients and assert exactly one succeeds and
the other gets the typed "slot just taken" error. A sequential test proves
nothing about a race.

---

## 7. Decisions taken in this document

| # | Decision | Status |
|---|---|---|
| ARCH1 | **Better Auth, not Auth.js** — identity only, no organization plugin | **Recommended — amends instructions §5** |
| ARCH2 | Rate limiting in Postgres, not Upstash; adds `rate_limit_counters` | Recommended — amends `database-design.md` |
| ARCH3 | `drizzle-orm/neon-serverless` (Pool), not `neon-http` — transactions | Recommended |
| ARCH4 | Repository layer + restricted-import lint rule; RLS deferred | Recommended |
| ARCH5 | No `db:push` script in `package.json`, ever | Recommended |
| ARCH6 | Resend for email; domain verification starts in Phase 0 | Recommended |
| ARCH7 | No date library; `Intl` + integer minutes | Recommended |
| ARCH8 | **Cache Components policy** — availability and all authenticated reads are request-time; `use cache` only for clinic-public, non-patient data, always with an explicit `cacheLife` and `cacheTag`; no cache directive in `server/db/repositories/` | Recommended — new |

### Open after this document

- **ARCH1 needs your yes** before Phase 0 installs anything. It contradicts the
  stack in instructions §5, so it should be a conscious change, not a silent one.
- **D6** — still assumed as the precedence chain (`database-design.md` A1). Phase
  4 is where it becomes concrete; confirming before then costs one query to
  change, after then costs a migration.
- **`mvp-scope.md` §5 is now three fields behind the design**: D8's consent
  columns, D12's `change_cutoff_minutes`, DB2's `slot_granularity_minutes`.
- **Hosting region** (scope §11) — decide before Phase 9, since §8's PDPL
  transfer analysis depends on it.
- **DB7** — audit-log retention policy, before real patient data.
