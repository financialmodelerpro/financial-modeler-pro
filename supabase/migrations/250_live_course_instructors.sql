-- ═══════════════════════════════════════════════════════════════════════════════
-- 250: Live course instructors.
--
-- A course points at one or more rows of `instructors` (the same records live
-- sessions use), in display order. The course page reads name, title, photo,
-- bio and links from those rows on every view, so an instructor's profile
-- edit shows on every course with no re-save.
--
-- An array cannot carry a foreign key, so a deleted instructor's id is simply
-- skipped on read (and dropped on the next save). trainer_name / trainer_title
-- (mig 249) stay as a fallback for a course with no instructor picked.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE training_course_settings
  ADD COLUMN IF NOT EXISTS instructor_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN training_course_settings.instructor_ids IS
  'Ordered instructors(id) shown on the course page (mig 250). Read live; a missing id is skipped.';
