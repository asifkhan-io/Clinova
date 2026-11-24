-- Hand-written (database-design.md §7). Never run `drizzle-kit push`: it would
-- silently drop this constraint, which is the only thing that makes a double
-- booking impossible rather than merely unlikely.

-- 7.1 One dentist cannot be in two places at once, even when two patients press
-- "Book" on the last slot in the same millisecond: the second INSERT fails.
-- Only booked/completed rows block, so a cancellation frees its slot with no
-- sweep job. The buffer is deliberately NOT here (D13): it is a soft rule in
-- slot generation, and staff may still squeeze a walk-in in back to back.
-- Also applies to UPDATE, which is what makes reschedule-in-place safe (D11).
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('booked', 'completed'));
--> statement-breakpoint

-- 7.5 Append-only intent for the audit log. NOTE: on Neon the app connects as
-- the table owner, which REVOKE FROM PUBLIC does not restrict; real
-- immutability needs a separate, non-owner app role (tracked for Phase 9).
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
