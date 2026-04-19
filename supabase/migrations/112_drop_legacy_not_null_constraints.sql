-- ============================================================
-- 112: Drop NOT NULL on legacy `student_certificates` columns
--
-- Root cause of the "DB write failed: null value in column … violates
-- not-null constraint" error surfaced by migration 111's error-checked
-- engine: the table still carries NOT NULL constraints from the old
-- Certifier-based cert system. The new native engine doesn't populate
-- those fields, so every INSERT fails on the first NOT NULL column it
-- doesn't provide a value for.
--
-- Fix: relax NOT NULL on every known legacy column. Each ALTER is
-- wrapped in a DO block with an information_schema guard so running this
-- against a DB that doesn't have a given legacy column is a silent no-op.
-- ============================================================

DO $$
DECLARE
  legacy_col TEXT;
  legacy_cols TEXT[] := ARRAY[
    'certifier_uuid',
    'certifier_url',
    'certifier_name',
    'certifier_id',
    'certifier_token',
    'legacy_id',
    'apps_script_id',
    'sheet_row_id'
  ];
BEGIN
  FOREACH legacy_col IN ARRAY legacy_cols LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'student_certificates'
        AND column_name = legacy_col
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE format(
        'ALTER TABLE student_certificates ALTER COLUMN %I DROP NOT NULL',
        legacy_col
      );
      EXECUTE format(
        'ALTER TABLE student_certificates ALTER COLUMN %I SET DEFAULT NULL',
        legacy_col
      );
      RAISE NOTICE 'dropped NOT NULL on legacy column: %', legacy_col;
    END IF;
  END LOOP;
END $$;

-- Sanity probe: after this migration runs, the only NOT NULL columns on
-- `student_certificates` should be ones the current engine actively
-- populates (registration_id, email, course, course_code, etc.) or
-- system columns (id, created_at). If an admin triggers a force-issue
-- afterward and STILL gets a NOT NULL violation, this query surfaces the
-- specific column:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'student_certificates'
--     AND is_nullable = 'NO' ORDER BY ordinal_position;
