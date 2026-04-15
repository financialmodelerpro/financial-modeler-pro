-- 086: Session notes — per-student notes on each session
CREATE TABLE IF NOT EXISTS session_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES live_sessions(id)
    ON DELETE CASCADE,
  student_email TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, student_email)
);

CREATE INDEX IF NOT EXISTS idx_session_notes_session_email
  ON session_notes(session_id, student_email);
