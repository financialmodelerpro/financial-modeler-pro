-- 227_admin_audit_log_admin_id_declare_live_shape.sql
--
-- Makes the migration set REPRODUCE PRODUCTION for admin_audit_log.admin_id.
--
-- THIS IS A NO-OP AGAINST THE LIVE DATABASE, DELIBERATELY. Read from
-- pg_constraint on 2026-08-31 (the first session with a working direct
-- connection; every earlier statement about this column was a behavioural
-- inference):
--
--   admin_id        NOT NULL = true   admin_audit_log_admin_id_fkey:
--                                     FOREIGN KEY (admin_id) REFERENCES users(id)
--                                     -- no ON DELETE clause, so NO ACTION
--   71 rows, 0 NULLs in admin_id
--
-- Production is already exactly what this migration declares. What is NOT
-- already true is the REBUILD: migration 007 declares
--
--   admin_id  uuid REFERENCES users(id) ON DELETE SET NULL
--
-- (nullable, SET NULL), and no later migration alters it. 007's clause never
-- took effect because it opens `CREATE TABLE IF NOT EXISTS admin_audit_log` on
-- a table that already existed, which makes the whole column list a no-op: the
-- audit table predates the migration log. So a database built from this repo
-- has ended up with a DIFFERENT shape from production for this column, and
-- nothing in the repo said so.
--
-- Migration 221 made the decision and recorded it in prose:
--
--   "3. admin_id is DELIBERATELY LEFT ALONE (NOT NULL, NO ACTION): it names
--       the ACTING admin, the engine refuses to delete admin accounts, and if
--       a demoted ex-admin with admin-actor rows is ever deleted, a loud block
--       beats silently losing who acted."
--
-- ...but it did not ALTER anything, because live already matched the decision.
-- A decision recorded only in a comment is not reproducible. This migration
-- writes it into the schema.
--
-- WHY NOT EDIT 007 INSTEAD: a migration records what RAN. Rewriting 007 to say
-- NO ACTION would claim history that did not happen and would destroy the only
-- evidence that this drift ever existed, which is the evidence that found it.
-- Existing migrations are never edited (see the Do NOT touch list in CLAUDE.md).
--
-- SAFETY. Idempotent and guarded at every step: a missing table, an
-- already-correct column and a re-run are all no-ops. The one thing that can
-- fail is SET NOT NULL against rows with a NULL admin_id, which can only exist
-- in a database rebuilt from 007's nullable declaration. That case RAISES with
-- an explicit message rather than deleting or rewriting audit rows: an audit
-- row whose actor is unknown is a question for a human, not something a
-- migration should silently resolve.
--
-- No data change on production. No behaviour change on production. The delete
-- engine (src/shared/account/deleteUserAccount.ts) is unaffected: it already
-- refuses to delete admin accounts and nulls target_user_id in code.

DO $$
DECLARE
  null_actors bigint;
BEGIN
  -- Nothing to do if the table is not here (a partial or future rebuild).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
  ) THEN
    RAISE NOTICE '227: admin_audit_log not present, nothing to do.';
    RETURN;
  END IF;

  -- 1. The foreign key: state ON DELETE NO ACTION EXPLICITLY.
  --
  -- NO ACTION is the Postgres default, so `REFERENCES users(id)` alone already
  -- produces it and pg_get_constraintdef will not print the clause back. It is
  -- written out anyway so the intent is on the page: the next reader sees a
  -- deliberate choice rather than an omission, and cannot "helpfully" add
  -- SET NULL on the assumption that the missing clause was an oversight.
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
      AND constraint_name = 'admin_audit_log_admin_id_fkey'
  ) THEN
    ALTER TABLE public.admin_audit_log
      DROP CONSTRAINT admin_audit_log_admin_id_fkey;
  END IF;

  ALTER TABLE public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE NO ACTION;

  -- 2. NOT NULL. Already true on production; only a 007-shaped rebuild can
  --    have NULLs here, and that is a data question, not a migration's call.
  SELECT count(*) INTO null_actors
  FROM public.admin_audit_log WHERE admin_id IS NULL;

  IF null_actors > 0 THEN
    RAISE EXCEPTION
      '227: % audit row(s) have a NULL admin_id, so NOT NULL cannot be set. These rows record an action with no known actor, which is what this constraint exists to prevent. Decide deliberately (attribute them, or delete them) and re-run; this migration will not guess.',
      null_actors;
  END IF;

  ALTER TABLE public.admin_audit_log
    ALTER COLUMN admin_id SET NOT NULL;
END $$;

COMMENT ON CONSTRAINT admin_audit_log_admin_id_fkey ON public.admin_audit_log IS
  'ON DELETE NO ACTION, deliberately (mig 221 decided it, mig 227 declared it). admin_id names the ACTING admin: deleting an admin who has audit rows must BLOCK loudly rather than silently lose who acted. The engine refuses to delete admin accounts, so this fires only for a demoted ex-admin. Migration 007 declared SET NULL and nullable; that never took effect (CREATE IF NOT EXISTS on a pre-existing table) and 227 aligns the declaration with the live shape.';

COMMENT ON COLUMN public.admin_audit_log.admin_id IS
  'The acting admin. NOT NULL since before the migration log; declared NOT NULL by mig 227. An audit row with no actor is not an audit row.';
