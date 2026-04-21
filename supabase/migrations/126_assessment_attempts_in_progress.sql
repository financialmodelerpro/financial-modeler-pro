-- ═══════════════════════════════════════════════════════════════════════════════
-- 126: Server-anchored in-progress assessment tracking + capped grace pause
--
-- Replaces the localStorage-only / React-state-only timer model on both
-- assessment surfaces (3SFM/BVM cert path + live-session quizzes) with a
-- server-authoritative deadline. One row per (email, attempt) for the
-- duration of an attempt; deleted by the submit endpoints on success.
--
-- Pause semantics (Option C in the diagnosis):
--   - Regular assessments  : 1 pause max, 120 grace seconds total
--   - Final exams (is_final): pause endpoints return 403, wall clock keeps running
--   - Server caps pause duration at remaining grace; clock resumes from where
--     grace ran out
--   - Every pause/resume event appended to pause_log for admin review
--
-- Two distinct identifier shapes coexist in one table because the cert path
-- keys by tab_key (e.g. '3SFM_S1') and the live-session path keys by
-- session_id UUID. Mutually-exclusive partial unique indexes enforce
-- one-attempt-row per identifier+attempt.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assessment_attempts_in_progress (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT NOT NULL,
  tab_key              TEXT,
  session_id           UUID,
  attempt_number       INTEGER NOT NULL,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  paused_at            TIMESTAMPTZ,
  grace_seconds_used   INTEGER NOT NULL DEFAULT 0,
  grace_seconds_max    INTEGER NOT NULL DEFAULT 120,
  pause_count          INTEGER NOT NULL DEFAULT 0,
  max_pauses           INTEGER NOT NULL DEFAULT 1,
  is_final             BOOLEAN NOT NULL DEFAULT FALSE,
  pause_log            JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_one_identifier CHECK (
    (tab_key IS NOT NULL AND session_id IS NULL) OR
    (tab_key IS NULL     AND session_id IS NOT NULL)
  )
);

-- One attempt row per (email, tab_key, attempt) on the cert path. Partial so
-- the constraint only applies when tab_key is the active identifier.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_attempt_in_progress_cert
  ON assessment_attempts_in_progress (LOWER(email), tab_key, attempt_number)
  WHERE tab_key IS NOT NULL;

-- One attempt row per (email, session_id, attempt) on the live-session path.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_attempt_in_progress_live
  ON assessment_attempts_in_progress (LOWER(email), session_id, attempt_number)
  WHERE session_id IS NOT NULL;

-- Lookup indexes for resume-on-load (state endpoint reads by these).
CREATE INDEX IF NOT EXISTS idx_attempt_in_progress_email_tab
  ON assessment_attempts_in_progress (LOWER(email), tab_key)
  WHERE tab_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attempt_in_progress_email_session
  ON assessment_attempts_in_progress (LOWER(email), session_id)
  WHERE session_id IS NOT NULL;

-- Auto-touch updated_at on every UPDATE so pause/resume timestamps are honest
-- without callers having to remember to set the column.
CREATE OR REPLACE FUNCTION touch_assessment_attempts_in_progress() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_assessment_attempts_in_progress ON assessment_attempts_in_progress;
CREATE TRIGGER trg_touch_assessment_attempts_in_progress
  BEFORE UPDATE ON assessment_attempts_in_progress
  FOR EACH ROW EXECUTE FUNCTION touch_assessment_attempts_in_progress();

-- Denormalize pause history onto live_session_attempts so the admin attempts
-- viewer can surface pause_count + total paused seconds + the per-event log
-- after the in-progress row has been cleaned up. The cert path mirror
-- (training_assessment_results) is intentionally NOT extended because its
-- upsert-per-retry shape would lose attempt N's pause history when attempt
-- N+1 lands. Add a separate audit table later if cert-path pause review
-- becomes necessary.
ALTER TABLE live_session_attempts
  ADD COLUMN IF NOT EXISTS pause_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pause_log            JSONB   NOT NULL DEFAULT '[]'::jsonb;
