-- ============================================================
-- 064: Add linkedin_url to testimonials table (manual submissions)
-- student_testimonials already has it from migration 038
-- ============================================================

ALTER TABLE testimonials
ADD COLUMN IF NOT EXISTS linkedin_url text DEFAULT NULL;
