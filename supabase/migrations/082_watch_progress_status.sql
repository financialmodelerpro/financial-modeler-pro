-- Migration 082: Add status and watch_percentage to session_watch_history

ALTER TABLE session_watch_history
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE session_watch_history
  ADD COLUMN IF NOT EXISTS watch_percentage INTEGER DEFAULT 100;
