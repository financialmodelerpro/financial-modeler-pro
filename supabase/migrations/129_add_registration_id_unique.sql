-- ═══════════════════════════════════════════════════════════════════════════════
-- 129: Add UNIQUE constraint on training_registrations_meta.registration_id
--
-- Launch blocker root cause: every confirm-email flow upserts with
-- `onConflict: 'registration_id'`, which Postgres rejects with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" because the column is only NOT NULL, not UNIQUE. The
-- error was discarded by `const { data } = await query;` until commit
-- 2b84305, which now fail-closes and surfaces the error to the user as
-- "Link Invalid or Expired". This constraint lets every future upsert
-- actually succeed.
--
-- Pre-check (run manually before applying): if the query below returns
-- any rows, de-dupe them before this constraint can be added.
--
--   SELECT registration_id, COUNT(*)
--   FROM training_registrations_meta
--   GROUP BY registration_id
--   HAVING COUNT(*) > 1;
--
-- Guarded by information_schema lookup so re-runs are a no-op.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name      = 'training_registrations_meta'
      AND constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      AND constraint_name  = 'training_registrations_meta_registration_id_key'
  ) THEN
    ALTER TABLE training_registrations_meta
      ADD CONSTRAINT training_registrations_meta_registration_id_key
      UNIQUE (registration_id);
  END IF;
END $$;
