-- Hand-written (Phase 9b). Makes the audit log append-only FOR REAL.
--
-- 0005 revoked UPDATE/DELETE on audit_log from PUBLIC, but the app connected as
-- the table OWNER, and an owner's rights can't be revoked that way. From now on
-- the app connects as `clinova_app`, a role that owns nothing:
--   * every table: SELECT, INSERT, UPDATE, DELETE (what the app does today)
--   * audit_log:   SELECT, INSERT only. A bug, a stolen session or a bad
--                  query can add history but can never rewrite or erase it.
-- Migrations and scripts keep using the owner (DATABASE_URL_UNPOOLED).
--
-- The role itself (and its password) is created in the Neon console or API,
-- never here: a password must not live in git. If the role doesn't exist yet
-- (local dev, PGlite tests, a fresh branch) this migration does nothing, and
-- re-running it after creating the role is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinova_app') THEN
    GRANT USAGE ON SCHEMA public TO clinova_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clinova_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clinova_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM clinova_app;

    -- Tables a future migration creates get the same rights automatically.
    -- (A future append-only table must REVOKE in its own migration, as above.)
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinova_app',
      current_user
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO clinova_app',
      current_user
    );
  END IF;
END $$;
