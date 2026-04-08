-- 036: Add registration URL for live sessions
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS registration_url TEXT;
