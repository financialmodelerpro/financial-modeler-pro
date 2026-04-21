-- ═══════════════════════════════════════════════════════════════════════════════
-- 134: Backfill training_enrollments for all existing students
--
-- Final enrollment model: every student gets 3SFM at signup, BVM unlocks
-- automatically when they pass the 3SFM Final Exam. This migration catches
-- the 11 pre-cutover students up to that model based on the data Supabase
-- already has.
--
-- Rules:
--   1. Every row in training_registrations_meta -> 3SFM enrollment.
--   2. Anyone with a training_assessment_results row whose tab_key starts
--      with "BVM_" (they've engaged with BVM content) -> BVM enrollment.
--      Covers "Both Courses" registrants from the old Apps Script world.
--   3. Anyone who's passed the 3SFM Final (tab_key = "3SFM_Final" and
--      passed = true) -> BVM enrollment too, because post-cutover that's
--      how BVM would have been unlocked.
--
-- Everything uses ON CONFLICT DO NOTHING against the (registration_id,
-- course_code) UNIQUE index from migration 132, so the script is idempotent.
--
-- This migration is a safety net alongside
-- scripts/backup_apps_script_students.ts, which performs the same
-- enrollments live from the Apps Script roster. Running this migration
-- after the script is a no-op (the unique index absorbs the duplicates);
-- running it BEFORE the script means students won't show zero enrollments
-- between cutover and the backup script run.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Everyone gets 3SFM.
INSERT INTO training_enrollments (registration_id, course_code, enrolled_at)
SELECT m.registration_id, '3SFM', COALESCE(m.created_at, now())
FROM training_registrations_meta m
ON CONFLICT (registration_id, course_code) DO NOTHING;

-- 2 + 3. Anyone who has engaged with BVM content or passed the 3SFM Final
-- gets BVM too. UNION captures both paths; the outer INSERT is idempotent.
INSERT INTO training_enrollments (registration_id, course_code, enrolled_at)
SELECT DISTINCT m.registration_id, 'BVM', COALESCE(m.created_at, now())
FROM training_registrations_meta m
WHERE EXISTS (
  SELECT 1
  FROM training_assessment_results ar
  WHERE LOWER(ar.email) = LOWER(m.email)
    AND (
      ar.tab_key ILIKE 'BVM\_%' ESCAPE '\'
      OR (ar.tab_key = '3SFM_Final' AND ar.passed = TRUE)
    )
)
ON CONFLICT (registration_id, course_code) DO NOTHING;
