-- ═══════════════════════════════════════════════════════════════════════════════
-- 125: Microsoft Teams meeting columns + announcement tracking + audit log
--
-- Part A (Announce flow fix):
--   Collapses announcement status to a single canonical column family on
--   live_sessions. `announcement_sent` already existed (migration 043) but
--   had no matching `_at` / `_count` / `_by` counterparts and wasn't being
--   written by the /notify route (which wrote legacy `notification_sent*`
--   from migration 034). This migration adds the companions, backfills
--   historical manual-notify sends from `notification_sent*`, and creates
--   a focused `announcement_send_log` audit table keyed by session_id.
--
--   Legacy `notification_sent*` columns are retained to keep reads safe
--   during the rollout, but the app now writes `announcement_sent*` only.
--
-- Part B (Teams integration):
--   Adds `teams_meeting_id`, `teams_dial_in` (jsonb of phone/conference id)
--   and `meeting_provider` with a CHECK constraint covering the four
--   modes the UI toggles between.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── A. Announcement tracking companions ───────────────────────────────────
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS announcement_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS announcement_sent_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS announcement_sent_by    TEXT;

-- Backfill from legacy manual-notify columns so existing sessions surface
-- their history in the new admin UI. `announcement_sent` was previously
-- set only by the auto-send-on-publish code paths that are being removed;
-- this line merges the manual side in so one column tells the full story.
UPDATE live_sessions
   SET announcement_sent       = TRUE,
       announcement_sent_at    = COALESCE(announcement_sent_at, notification_sent_at),
       announcement_sent_count = GREATEST(announcement_sent_count, COALESCE(notification_sent_count, 0))
 WHERE notification_sent = TRUE
   AND announcement_sent_at IS NULL;

-- ── A. Audit log for every announcement dispatch ───────────────────────────
CREATE TABLE IF NOT EXISTS announcement_send_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  sent_by_email    TEXT,
  sent_by_user_id  TEXT,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  target           TEXT NOT NULL DEFAULT 'all',
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  success_count    INTEGER NOT NULL DEFAULT 0,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  was_preview      BOOLEAN NOT NULL DEFAULT FALSE,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_announcement_send_log_session
  ON announcement_send_log (session_id, sent_at DESC);

-- ── B. Microsoft Teams meeting columns ─────────────────────────────────────
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS teams_meeting_id TEXT,
  ADD COLUMN IF NOT EXISTS teams_dial_in    JSONB,
  ADD COLUMN IF NOT EXISTS meeting_provider TEXT NOT NULL DEFAULT 'manual';

-- Guard meeting_provider to a closed set. Using DO block so re-runs that
-- find the constraint already present don't fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_sessions_meeting_provider_check'
  ) THEN
    ALTER TABLE live_sessions
      ADD CONSTRAINT live_sessions_meeting_provider_check
      CHECK (meeting_provider IN ('manual', 'teams', 'zoom', 'meet'));
  END IF;
END $$;
