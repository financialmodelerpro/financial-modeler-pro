-- ============================================================
-- 035: Live Sessions Enhancements
-- Additional fields for banner, duration, difficulty, etc.
-- ============================================================

ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS max_attendees INTEGER;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS difficulty_level TEXT DEFAULT 'All Levels';
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS prerequisites TEXT;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS instructor_name TEXT DEFAULT 'Ahmad Din';
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS live_password TEXT;
