# Integration tests (Phase 8e)

These run against a real Neon database with real concurrent connections, which
the PGlite unit tests cannot do (PGlite is one connection).

## One-time setup

1. In the Neon console, keep a branch named `test`, created from `dev`. It is
   disposable: if it ever gets messy, "Reset from parent".
2. Create `.env.test` in the repo root (it is gitignored by `.env*`) with one line:

   ```
   TEST_DATABASE_URL="postgresql://…@<test-endpoint>.neon.tech/neondb?sslmode=require"
   ```

   Use the **direct** (not `-pooler`) host of the `test` branch. Never the `main`
   (production) branch, and not `dev`.

## Run

```
npm run test:integration
```

The race test makes its own clinic (slug `race-…`), books against it from
several connections at once, then deletes the clinic. It refuses to start if
`TEST_DATABASE_URL` is unset or has the same host as `DATABASE_URL`.

`npm test` never runs these (they are excluded in `vitest.config.mts`).

## What a pass means

For every contested slot exactly one of the simultaneous patients is booked and
the rest are refused, and no refused patient leaves a row behind. The log line
`[race] refusals by layer` shows how many refusals came from the database
constraint (`slot_taken`) versus the availability re-check (`slot_unavailable`);
a healthy run usually shows some of both.
