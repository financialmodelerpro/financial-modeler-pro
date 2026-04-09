-- Migration 038: Add LinkedIn verification + hub fields to testimonials table
-- The student_testimonials table already has these columns; this adds them to
-- the manual testimonials table for consistency.

ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS hub TEXT DEFAULT 'training';
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS video_url TEXT;
