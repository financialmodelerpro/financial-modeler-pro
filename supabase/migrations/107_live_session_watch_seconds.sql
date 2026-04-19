-- ============================================================
-- 107: Track interval-merged watch seconds for live sessions
--      (mirrors migration 103 on certification_watch_history)
-- ============================================================

ALTER TABLE session_watch_history
  ADD COLUMN IF NOT EXISTS watch_seconds  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_seconds  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_position  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();
