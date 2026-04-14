-- Migration 084: Add show_like_button toggle to live_sessions

ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS show_like_button BOOLEAN NOT NULL DEFAULT true;
