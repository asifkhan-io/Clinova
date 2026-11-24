-- Hand-written: constraints Drizzle cannot express (database-design.md §7).
-- Kept in its own migration so `drizzle-kit generate` never overwrites it.
-- NEVER use `drizzle-kit push` on this database: it would silently drop these.

-- Lets one exclusion constraint mix "=" on a uuid with "&&" on a range.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- A dentist's weekly intervals cannot overlap on the same weekday.
-- Back-to-back is fine: '[)' ranges, so 09:00-13:00 and 13:00-17:00 do not clash.
ALTER TABLE staff_hours
  ADD CONSTRAINT staff_hours_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    day_of_week WITH =,
    int4range(start_minute, end_minute, '[)') WITH &&
  );
--> statement-breakpoint

-- Same for the clinic template.
ALTER TABLE clinic_hours
  ADD CONSTRAINT clinic_hours_no_overlap
  EXCLUDE USING gist (
    clinic_id WITH =,
    day_of_week WITH =,
    int4range(start_minute, end_minute, '[)') WITH &&
  );
--> statement-breakpoint

-- Overrides of the SAME scope cannot cover overlapping dates. All clinic-wide
-- rows share one sentinel, so they cannot overlap each other; one dentist's rows
-- cannot overlap each other; a clinic row and a dentist row on the same date
-- coexist, which the D6 precedence chain needs.
ALTER TABLE schedule_overrides
  ADD CONSTRAINT schedule_overrides_no_overlap
  EXCLUDE USING gist (
    clinic_id WITH =,
    (COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );
--> statement-breakpoint

-- One override's intervals cannot overlap each other (Ramadan 10-14 and 20-24: fine).
ALTER TABLE schedule_override_intervals
  ADD CONSTRAINT schedule_override_intervals_no_overlap
  EXCLUDE USING gist (
    override_id WITH =,
    int4range(start_minute, end_minute, '[)') WITH &&
  );
