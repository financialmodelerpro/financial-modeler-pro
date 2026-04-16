-- Migration 090: Training assessment results — Supabase as primary source
-- Stores per-session assessment results for Training Hub students.
-- Used by dashboard for instant progress display (no Apps Script delay).

CREATE TABLE IF NOT EXISTS training_assessment_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  reg_id        TEXT NOT NULL,
  tab_key       TEXT NOT NULL,
  course_id     TEXT NOT NULL,
  score         INT NOT NULL,
  passed        BOOLEAN NOT NULL,
  attempts      INT NOT NULL DEFAULT 1,
  is_final      BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email, tab_key)
);

CREATE INDEX IF NOT EXISTS idx_training_results_email
  ON training_assessment_results(email);

CREATE INDEX IF NOT EXISTS idx_training_results_reg_id
  ON training_assessment_results(reg_id);
