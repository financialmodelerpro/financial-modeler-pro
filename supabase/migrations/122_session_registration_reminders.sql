-- ============================================================
-- 122: Per-registration reminder flags on session_registrations
--
-- The 24-hour and 1-hour reminder crons previously used per-SESSION
-- flags on `live_sessions` (migration 043). That worked, but late
-- registrants (students who register < 24h before the session) never
-- got the 24-hour reminder because the session-level flag was already
-- set the moment ANY registrant got the first reminder.
--
-- Moving the flags to `session_registrations` fixes that — each
-- student's reminder lifecycle is tracked independently, so a late
-- register still triggers the appropriate reminder window.
--
-- Session-level announcement_sent stays where it is (on live_sessions)
-- because it gates whether reminders fire at all — "don't remind
-- about an unpublished session."
-- ============================================================

ALTER TABLE session_registrations
  ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_1h_sent  BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: the cron queries for "rows where this flag is false AND
-- the session is soon" — a partial index on false rows keeps that lookup
-- cheap as registration volume grows.
CREATE INDEX IF NOT EXISTS idx_session_regs_reminder_24h_pending
  ON session_registrations (session_id)
  WHERE reminder_24h_sent = FALSE;

CREATE INDEX IF NOT EXISTS idx_session_regs_reminder_1h_pending
  ON session_registrations (session_id)
  WHERE reminder_1h_sent = FALSE;
