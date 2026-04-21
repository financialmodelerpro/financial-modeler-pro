-- ═══════════════════════════════════════════════════════════════════════════════
-- 130: Preemptive UNIQUE on training_passwords.registration_id
--
-- The confirm-email flow now uses a SELECT-then-decide pattern for
-- training_passwords and no longer relies on `onConflict: 'registration_id'`,
-- so this migration is defensive rather than a hard fix. Adding the
-- constraint now prevents a future regression where someone reintroduces
-- the blind upsert shape AND prevents duplicate password rows for a
-- single RegID from sneaking in through any other code path.
--
-- Pre-check (run manually before applying): if the query below returns
-- any rows, de-dupe them before this constraint can be added.
--
--   SELECT registration_id, COUNT(*)
--   FROM training_passwords
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
    WHERE table_name      = 'training_passwords'
      AND constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      AND constraint_name  = 'training_passwords_registration_id_key'
  ) THEN
    ALTER TABLE training_passwords
      ADD CONSTRAINT training_passwords_registration_id_key
      UNIQUE (registration_id);
  END IF;
END $$;
