-- ═══════════════════════════════════════════════════════════════════════════════
-- 248: Model submissions for any course, and an admin reset of attempts.
--
-- 1. course_code was CHECKed to ('3SFM','BVM'); any short code is now allowed
--    (the course list lives in code and training_course_settings).
-- 2. attempt_number was CHECKed to 1..3 while the code allows a max of 1..10;
--    the database now matches the code.
-- 3. A reset SUPERSEDES rows instead of deleting them: history and files stay,
--    superseded rows stop counting as attempts, and the next upload is
--    attempt 1 again. The unique index ignores superseded rows.
-- Existing rows all get superseded_at NULL, so 3SFM and BVM count exactly as
-- before.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop the two inline CHECKs by definition, not by guessed name.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.model_submissions'::regclass AND contype = 'c'
  LOOP
    IF r.def ILIKE '%course_code%' OR r.def ILIKE '%attempt_number%' THEN
      EXECUTE format('ALTER TABLE public.model_submissions DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END $$;

ALTER TABLE model_submissions
  ADD CONSTRAINT model_submissions_course_code_format
    CHECK (course_code ~ '^[A-Z0-9]{2,12}$'),
  ADD CONSTRAINT model_submissions_attempt_number_range
    CHECK (attempt_number BETWEEN 1 AND 10);

ALTER TABLE model_submissions
  ADD COLUMN IF NOT EXISTS superseded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by     TEXT,
  ADD COLUMN IF NOT EXISTS superseded_reason TEXT;

DROP INDEX IF EXISTS uniq_model_submissions_email_course_attempt;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_model_submissions_email_course_attempt_active
  ON model_submissions (LOWER(email), course_code, attempt_number)
  WHERE superseded_at IS NULL;

COMMENT ON COLUMN model_submissions.superseded_at IS
  'Set by an admin attempt reset (mig 248). Superseded rows are history: they do not count as attempts and never decide approval.';
