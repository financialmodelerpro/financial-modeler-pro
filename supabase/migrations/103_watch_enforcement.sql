-- Migration 103: Video watch enforcement
-- Adds interval-merged watch tracking columns to certification_watch_history
-- and global enforcement settings to training_settings.

-- 1. Track actual watched time (seconds), percentage, duration, last position
ALTER TABLE certification_watch_history ADD COLUMN IF NOT EXISTS watch_seconds   INTEGER DEFAULT 0;
ALTER TABLE certification_watch_history ADD COLUMN IF NOT EXISTS total_seconds   INTEGER DEFAULT 0;
ALTER TABLE certification_watch_history ADD COLUMN IF NOT EXISTS watch_percentage INTEGER DEFAULT 0 CHECK (watch_percentage BETWEEN 0 AND 100);
ALTER TABLE certification_watch_history ADD COLUMN IF NOT EXISTS last_position   INTEGER DEFAULT 0;
ALTER TABLE certification_watch_history ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN certification_watch_history.watch_seconds  IS 'Sum of merged playback intervals — cannot be inflated by seeking.';
COMMENT ON COLUMN certification_watch_history.total_seconds  IS 'Video duration in seconds.';
COMMENT ON COLUMN certification_watch_history.watch_percentage IS 'Derived: watch_seconds / total_seconds * 100. Denormalized for fast dashboard reads.';
COMMENT ON COLUMN certification_watch_history.last_position  IS 'Latest playback head position — used for resume UX only, NOT for enforcement.';

-- 2. Global enforcement settings
INSERT INTO training_settings (key, value) VALUES
  ('watch_enforcement_enabled',   'true'),
  ('watch_enforcement_threshold', '70')
ON CONFLICT (key) DO NOTHING;

-- Per-session bypass entries ('watch_enforcement_bypass_{TABKEY}' = 'true') are
-- created on demand when an admin toggles a specific session in the Training
-- Settings UI — no seeded rows needed.
