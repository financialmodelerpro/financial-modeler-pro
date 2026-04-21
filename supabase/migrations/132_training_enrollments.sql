-- ═══════════════════════════════════════════════════════════════════════════════
-- 132: Per-student course enrollments
--
-- Course enrollment moves out of the single `course` TEXT column on
-- training_registrations_meta (which never actually existed but was
-- assumed in a lot of places) and into a proper junction table. A student
-- can enroll in multiple courses over time - 3SFM, BVM, and future courses
-- - without the schema caring.
--
-- Registration no longer collects course at signup. The student confirms
-- email, signs in, and picks their first course from the dashboard via
-- POST /api/training/enroll. That route inserts a row here.
--
-- Existing 11 students are backfilled by
-- scripts/backup_apps_script_students.ts, which parses the Apps Script
-- `enrolledCourses` field (values like "3SFM", "BVM", "Both",
-- "3SFM,BVM") into one row per course.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS training_enrollments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  TEXT NOT NULL REFERENCES training_registrations_meta(registration_id) ON DELETE CASCADE,
  course_code      TEXT NOT NULL,    -- '3SFM' | 'BVM' | future short codes
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (registration_id, course_code)
);

CREATE INDEX IF NOT EXISTS idx_training_enrollments_reg    ON training_enrollments (registration_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_course ON training_enrollments (course_code);
