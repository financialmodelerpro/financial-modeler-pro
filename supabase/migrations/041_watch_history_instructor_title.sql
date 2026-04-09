-- Migration 041: Session watch history + instructor title

-- Watch history for tracking recording views and awarding points
CREATE TABLE IF NOT EXISTS session_watch_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES live_sessions(id) ON DELETE CASCADE,
  student_email TEXT NOT NULL,
  student_reg_id TEXT,
  watched_at TIMESTAMPTZ DEFAULT now(),
  points_awarded INTEGER DEFAULT 50,
  UNIQUE(session_id, student_email)
);

-- Instructor title field for live sessions
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS instructor_title TEXT;
