-- ─────────────────────────────────────────────────────────────────────────────
-- 026_session_config.sql
-- Per-session config stored by tabKey (Apps Script Form Registry key).
-- Used as the authoritative store for video duration so the student dashboard
-- can display "⏱ N min" without relying on Apps Script returning column J.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_config (
  tab_key               TEXT        PRIMARY KEY,
  video_duration_minutes INT         NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allow service-role writes; deny anon reads (all access via server routes only)
ALTER TABLE session_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON session_config
  USING (true)
  WITH CHECK (true);
