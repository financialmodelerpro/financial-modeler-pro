-- 221_fix_user_delete_fk_drift.sql
--
-- Aligns two foreign keys with the behavior the migration files always
-- CLAIMED, after a live admin delete was blocked by
-- admin_audit_log_target_user_id_fkey (2026-08-30).
--
-- WHAT PRODUCTION ACTUALLY HAS (probed behaviorally 2026-08-30, constraint
-- names read from the live violation messages; pg_constraint itself is
-- unreachable here, PostgREST has no catalog read and the direct DB
-- credential is stale):
--   * admin_audit_log.target_user_id -> users : ON DELETE NO ACTION (BLOCKS)
--   * admin_audit_log.admin_id       -> users : ON DELETE NO ACTION, NOT NULL
--   * user_permissions.created_by    -> users : ON DELETE NO ACTION (BLOCKS)
-- Migration 007 declares SET NULL for both audit columns and a nullable
-- admin_id; migration 006 declares SET NULL for created_by. None of that is
-- live: the audit table predates the migration log (CREATE IF NOT EXISTS
-- no-opped, the same drift class as `users` and the legacy `projects`), and
-- the live user_permissions carries 158's bare REFERENCES (no clause = NO
-- ACTION), so the 006-era table did not survive to today.
--
-- THE FIX:
--   1. target_user_id -> ON DELETE SET NULL. A deletion audit that vanishes
--      with the user is useless; the row survives, the target nulls, and the
--      account_deletions record (mig 219) keeps the identity mapping.
--   2. created_by -> ON DELETE SET NULL, restoring 006's declared intent.
--   3. admin_id is DELIBERATELY LEFT ALONE (NOT NULL, NO ACTION): it names
--      the ACTING admin, the engine refuses to delete admin accounts, and if
--      a demoted ex-admin with admin-actor rows is ever deleted, a loud block
--      beats silently losing who acted.
--
-- No data change. Constraint replacement only, idempotent, guarded so a
-- fresh environment (or one already fixed) is a no-op. The re-ADD validates
-- existing rows, which all reference live users, so it cannot fail on data.
--
-- The DELETE ENGINE (src/shared/account/deleteUserAccount.ts) nulls
-- target_user_id in code before deleting the users row, so account deletion
-- works whether or not this migration is applied; this aligns the schema so
-- the behavior is structural rather than one caller's discipline.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
      AND constraint_name = 'admin_audit_log_target_user_id_fkey'
  ) THEN
    ALTER TABLE public.admin_audit_log
      DROP CONSTRAINT admin_audit_log_target_user_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
  ) THEN
    ALTER TABLE public.admin_audit_log
      ADD CONSTRAINT admin_audit_log_target_user_id_fkey
      FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'user_permissions'
      AND constraint_name = 'user_permissions_created_by_fkey'
  ) THEN
    ALTER TABLE public.user_permissions
      DROP CONSTRAINT user_permissions_created_by_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_permissions'
  ) THEN
    ALTER TABLE public.user_permissions
      ADD CONSTRAINT user_permissions_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON CONSTRAINT admin_audit_log_target_user_id_fkey ON public.admin_audit_log IS
  'ON DELETE SET NULL since mig 221 (2026-08-30): audit rows survive the user they describe, target nulled; account_deletions keeps the identity. Was NO ACTION (pre-migration-log table; 007 never took effect) and blocked every user deletion.';
