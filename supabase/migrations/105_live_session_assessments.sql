-- ============================================================
-- 105: Native Live Session assessment system
--      (replaces Apps Script dependency for live-session quizzes)
-- ============================================================

-- Assessment configuration, one row per live session that has a quiz.
CREATE TABLE IF NOT EXISTS live_session_assessments (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                      UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  enabled                         BOOLEAN NOT NULL DEFAULT true,
  questions                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  pass_threshold                  INTEGER NOT NULL DEFAULT 70 CHECK (pass_threshold BETWEEN 0 AND 100),
  max_attempts                    INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  timer_minutes                   INTEGER,
  require_watch_before_assessment BOOLEAN NOT NULL DEFAULT true,
  watch_threshold                 INTEGER NOT NULL DEFAULT 70 CHECK (watch_threshold BETWEEN 0 AND 100),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id)
);

-- Student submissions — one row per attempt (score, pass/fail, answers).
CREATE TABLE IF NOT EXISTS live_session_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  reg_id              TEXT,
  attempt_number      INTEGER NOT NULL,
  score               INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  passed              BOOLEAN NOT NULL,
  answers             JSONB NOT NULL DEFAULT '{}'::jsonb,
  question_results    JSONB NOT NULL DEFAULT '{}'::jsonb,
  time_taken_seconds  INTEGER,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, email, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_live_attempts_email    ON live_session_attempts(email);
CREATE INDEX IF NOT EXISTS idx_live_attempts_session  ON live_session_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_live_attempts_passed   ON live_session_attempts(email, passed);
CREATE INDEX IF NOT EXISTS idx_live_assessments_sess  ON live_session_assessments(session_id);

-- Denormalized flag on live_sessions so list queries can cheaply show a
-- "has quiz" badge without joining.
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS has_assessment BOOLEAN NOT NULL DEFAULT false;
