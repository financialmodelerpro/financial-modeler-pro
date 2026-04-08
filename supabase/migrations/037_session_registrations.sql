-- ============================================================
-- 037: Session Registration / RSVP System
-- Track student registrations for live sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS session_registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  student_reg_id  text NOT NULL,
  student_name    text NOT NULL,
  student_email   text NOT NULL,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  attended        boolean NOT NULL DEFAULT false,
  UNIQUE(session_id, student_email)
);

CREATE INDEX idx_session_registrations_session ON session_registrations (session_id);
CREATE INDEX idx_session_registrations_student ON session_registrations (student_email);

ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS registration_required BOOLEAN DEFAULT true;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS show_join_link_minutes_before INTEGER DEFAULT 30;
