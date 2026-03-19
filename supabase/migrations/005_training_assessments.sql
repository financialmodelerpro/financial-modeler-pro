-- Training Assessment & Certification System
-- Supports: quizzes per course, user attempts, pass/fail, certificates

-- Assessments (one per course)
CREATE TABLE IF NOT EXISTS assessments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  pass_score    int NOT NULL DEFAULT 70,       -- percentage needed to pass
  time_limit    int,                           -- minutes, null = unlimited
  max_attempts  int NOT NULL DEFAULT 3,        -- max allowed attempts
  visible       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id)
);

-- Questions per assessment
CREATE TABLE IF NOT EXISTS assessment_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question        text NOT NULL,
  options         jsonb NOT NULL DEFAULT '[]',  -- array of {text, is_correct}
  explanation     text NOT NULL DEFAULT '',     -- shown after attempt
  points          int NOT NULL DEFAULT 1,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- User assessment attempts
CREATE TABLE IF NOT EXISTS assessment_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id   uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  answers         jsonb NOT NULL DEFAULT '{}',  -- {question_id: selected_option_index}
  score           int NOT NULL DEFAULT 0,       -- percentage
  passed          boolean NOT NULL DEFAULT false,
  time_taken      int,                          -- seconds
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

-- Certificates (issued on pass)
CREATE TABLE IF NOT EXISTS certificates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id          uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  assessment_id      uuid REFERENCES assessments(id),
  certificate_number text NOT NULL UNIQUE DEFAULT 'FMP-' || upper(substr(gen_random_uuid()::text, 1, 8)),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, course_id)
);

-- RLS
ALTER TABLE assessments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read assessments" ON assessments;
CREATE POLICY "Public read assessments" ON assessments FOR SELECT USING (visible = true);

DROP POLICY IF EXISTS "Admin write assessments" ON assessments;
CREATE POLICY "Admin write assessments" ON assessments FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "Public read questions" ON assessment_questions;
CREATE POLICY "Public read questions" ON assessment_questions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write questions" ON assessment_questions;
CREATE POLICY "Admin write questions" ON assessment_questions FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "Users own attempts" ON assessment_attempts;
CREATE POLICY "Users own attempts" ON assessment_attempts FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admin read attempts" ON assessment_attempts;
CREATE POLICY "Admin read attempts" ON assessment_attempts FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "Users own certificates" ON certificates;
CREATE POLICY "Users own certificates" ON certificates FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admin read certificates" ON certificates;
CREATE POLICY "Admin read certificates" ON certificates FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "System issue certificates" ON certificates;
CREATE POLICY "System issue certificates" ON certificates FOR INSERT WITH CHECK (true);
