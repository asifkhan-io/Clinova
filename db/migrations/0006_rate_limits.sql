-- Hand-written (architecture ARCH2). Fixed-window rate limiting in Postgres:
-- one upsert per request, so there is no Redis to pay for and no second
-- datastore to keep alive. Slightly less precise than a sliding window at a
-- window boundary, which does not matter for abuse prevention.
--
-- No clinic_id on purpose: this table protects the platform from a caller, and
-- a caller is not tenant data, so the "clinic_id on every tenant-owned table"
-- rule does not apply. identifier_hash is ALWAYS a sha256 of the bucket plus
-- the caller's address or phone number, so a dump of this table reveals
-- neither (scope §8).

CREATE TABLE rate_limits (
  bucket text NOT NULL,
  identifier_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT rate_limits_pk PRIMARY KEY (bucket, identifier_hash, window_start),
  CONSTRAINT rate_limits_count_positive CHECK (count > 0)
);
--> statement-breakpoint

-- The sweep deletes whole expired windows; without this it would seq-scan.
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);
