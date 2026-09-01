-- 228_declared_constraints_branding_scope_and_watch_history.sql
--
-- Two constraints that migrations DECLARED and the live schema never got.
-- Found by scripts/audit-constraints-live.ts once a direct connection made
-- pg_constraint readable (2026-08-31); measured safe before being written.
--
-- ── 1. branding_config.scope UNIQUE ─────────────────────────────────────────
--
-- Migration 003 declares `scope TEXT UNIQUE`. Live has no unique constraint and
-- no unique index on it, alone or composite: the only unique is the id primary
-- key. The table is EMPTY (0 rows measured 2026-09-01), so nothing violates it
-- today and nothing enforces it either. Whichever reader expects one row per
-- scope would, the moment this table took rows, silently pick an arbitrary one.
--
-- ── 2. session_watch_history: four columns NOT NULL ─────────────────────────
--
-- Migration 107 declares watch_seconds, total_seconds, last_position and
-- updated_at as NOT NULL with defaults. Live has the DEFAULTS but not the NOT
-- NULL, because 107 opens `ADD COLUMN IF NOT EXISTS` on columns an earlier
-- migration had already created: the ADD no-ops, taking its NOT NULL with it.
-- The same `IF NOT EXISTS` trap as 007 on admin_audit_log.
--
-- Measured safe 2026-09-01: 5 rows, ZERO NULLs in all four columns, and every
-- column keeps its default (0, 0, 0, now()), so an insert that omits one still
-- works after this runs.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
--
-- training_pending_registrations.course is NOT touched, and must not be.
--
-- The drift report lists it as "declared NOT NULL (027) but live is nullable",
-- which is true per-file and wrong as a conclusion: migration 131 DROPPED that
-- NOT NULL on purpose, because "the new registration form no longer asks for
-- course at signup time; students pick courses after email confirmation via the
-- enrollment flow". 15 of 18 live rows are NULL, which is the intended state.
-- Adding the constraint would contradict a deliberate decision AND fail on 15
-- rows. The chain 027 -> 131 converges on the live shape; only a per-file
-- reading makes it look like drift. Same class as user_permissions.created_by,
-- which 158 declares NO ACTION and 221 corrects to SET NULL.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- Idempotent and guarded: a missing table, an already-correct column and a
-- re-run are all no-ops. Each NOT NULL is preceded by its own NULL count, and
-- RAISES with the column named rather than letting Postgres report a bare
-- constraint violation, so a future environment with data tells you WHICH
-- column and HOW MANY rows.

DO $$
DECLARE
  nulls bigint;
  col   text;
BEGIN
  -- ── 1. branding_config.scope ──────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'branding_config') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.branding_config'::regclass AND contype = 'u'
        AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.branding_config'::regclass AND attname = 'scope')]
    ) THEN
      SELECT count(*) INTO nulls
      FROM (SELECT scope FROM public.branding_config GROUP BY scope HAVING count(*) > 1) d;
      IF nulls > 0 THEN
        RAISE EXCEPTION
          '228: branding_config.scope has % duplicated value(s); UNIQUE cannot be added. Resolve the duplicates deliberately and re-run.', nulls;
      END IF;
      ALTER TABLE public.branding_config
        ADD CONSTRAINT branding_config_scope_key UNIQUE (scope);
      RAISE NOTICE '228: added branding_config_scope_key UNIQUE (scope).';
    END IF;
  END IF;

  -- ── 2. session_watch_history NOT NULLs ────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'session_watch_history') THEN
    FOREACH col IN ARRAY ARRAY['watch_seconds', 'total_seconds', 'last_position', 'updated_at'] LOOP
      -- Already NOT NULL? Nothing to do.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.session_watch_history'::regclass
          AND attname = col AND attnotnull
      );
      EXECUTE format('SELECT count(*) FROM public.session_watch_history WHERE %I IS NULL', col) INTO nulls;
      IF nulls > 0 THEN
        RAISE EXCEPTION
          '228: session_watch_history.% holds % NULL row(s), so NOT NULL cannot be set. Migration 107 declares it NOT NULL DEFAULT; decide whether to backfill the default or keep the column nullable, then re-run.', col, nulls;
      END IF;
      EXECUTE format('ALTER TABLE public.session_watch_history ALTER COLUMN %I SET NOT NULL', col);
      RAISE NOTICE '228: session_watch_history.% set NOT NULL.', col;
    END LOOP;
  END IF;
END $$;

COMMENT ON CONSTRAINT branding_config_scope_key ON public.branding_config IS
  'One row per scope. Declared UNIQUE by migration 003 and never created live; added by 228 while the table was still empty.';
