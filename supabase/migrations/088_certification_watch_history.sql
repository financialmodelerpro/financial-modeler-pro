-- Migration 088: Certification watch history tracking
-- Tracks video watch status (in_progress/completed) for certification course sessions.
-- Used to gate "Take Assessment" button on dashboard — only shows after Mark Complete.

CREATE TABLE IF NOT EXISTS certification_watch_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_email TEXT NOT NULL,
  tab_key TEXT NOT NULL,
  course_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(student_email, tab_key)
);

CREATE INDEX IF NOT EXISTS idx_cert_watch_email
  ON certification_watch_history(student_email);
