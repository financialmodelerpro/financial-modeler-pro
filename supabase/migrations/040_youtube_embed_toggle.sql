-- Migration 040: Add YouTube embed toggle to live_sessions
-- Default false = opens YouTube in new tab (recommended for monetization)
-- true = embeds video within the platform

ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS youtube_embed BOOLEAN DEFAULT false;
