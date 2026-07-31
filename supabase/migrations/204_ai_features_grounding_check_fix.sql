-- ============================================================
--  204_ai_features_grounding_check_fix.sql
--  Corrects a CHECK constraint from migration 203 that never fired.
--  ADDITIVE in effect: replaces one constraint, touches no data, no columns.
--
--  The bug (found by a live check against the real database, not by review):
--
--    203 wrote   CHECK (array_length(grounding, 1) >= 1 AND grounding <@ ...)
--
--    array_length() on an EMPTY array returns NULL, not 0. NULL >= 1 is NULL,
--    and a CHECK constraint PASSES when its expression is NULL, because only an
--    explicit FALSE rejects the row. So the "grounding must be non-empty" half
--    of that constraint was a no-op, and
--
--      INSERT INTO ai_features (..., grounding) VALUES (..., '{}')
--
--    was accepted. The subset half (<@) was fine: it correctly rejected an
--    unsupported value like 'market'. Only the emptiness guard was dead.
--
--    cardinality() returns 0 for an empty array, so the comparison is a real
--    boolean and the constraint actually bites.
--
--  Why this matters beyond tidiness: a feature with no grounding is a feature
--  with no rules about what it is allowed to read, and the pure layer DROPS
--  such a row on read (coerceAiFeatureRow), so the row would exist in the
--  database and be invisible in the admin panel. A documented guard that never
--  runs is worse than no guard, because it is trusted.
--
--  The old constraint is found by DEFINITION rather than by name, so this
--  applies cleanly whether or not the name matches Postgres's auto-generated
--  ai_features_grounding_check.
--
--  Apply manually via the Supabase dashboard. Idempotent and re-runnable.
--  No em dashes anywhere in this file.
-- ============================================================

DO $$
DECLARE
  con record;
BEGIN
  IF to_regclass('public.ai_features') IS NULL THEN
    RAISE NOTICE '204: ai_features absent, nothing to do (apply 203 first)';
    RETURN;
  END IF;

  -- Drop the dead guard wherever it landed, matched on its definition.
  FOR con IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.ai_features'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%array_length(grounding%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_features DROP CONSTRAINT %I', con.conname);
    RAISE NOTICE '204: dropped dead constraint %', con.conname;
  END LOOP;

  -- Add the working one, named so a future migration can find it directly.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_features'::regclass
       AND conname = 'ai_features_grounding_valid'
  ) THEN
    ALTER TABLE public.ai_features
      ADD CONSTRAINT ai_features_grounding_valid
      CHECK (
        cardinality(grounding) >= 1
        AND grounding <@ ARRAY['model', 'external', 'context']::text[]
      );
    RAISE NOTICE '204: added ai_features_grounding_valid';
  ELSE
    RAISE NOTICE '204: ai_features_grounding_valid already present, no change';
  END IF;
END $$;
