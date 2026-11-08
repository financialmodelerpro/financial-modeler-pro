-- ═══════════════════════════════════════════════════════════════════════════════
-- 247: Live course (REFM). Course rules, sessions per course, attendance,
--      join clicks, email aliases, enrolment intent.
--
-- ADDITIVE ONLY. Nothing here changes an existing row's meaning:
--   - training_course_settings holds ONLY courses that run on the live-course
--     rules. 3SFM and BVM have no row and keep their exam path unchanged.
--   - live_sessions gains nullable columns; a session with no course_code is
--     the existing standalone live session.
--   - training_enrollments.source defaults to 'auto' (what every existing row is).
-- All new tables are server-only (service role), RLS on with no policies,
-- matching the other training tables.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Per-course rules ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_course_settings (
  course_code               TEXT PRIMARY KEY CHECK (course_code ~ '^[A-Z0-9]{2,12}$'),
  title                     TEXT NOT NULL,
  short_title               TEXT,
  description               TEXT,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  -- Offered for registration on the public Training Sessions page.
  is_public                 BOOLEAN NOT NULL DEFAULT false,
  -- false = no assessments or final exam; certification is the routes below
  -- plus an approved model.
  exams_enabled             BOOLEAN NOT NULL DEFAULT false,
  cert_routes               TEXT[]  NOT NULL DEFAULT ARRAY['live','recording']::TEXT[]
                              CHECK (cardinality(cert_routes) >= 1
                                     AND cert_routes <@ ARRAY['live','recording']::TEXT[]),
  -- true = each session may be met live OR by its recording.
  allow_mixed_routes        BOOLEAN NOT NULL DEFAULT true,
  attendance_threshold_pct  NUMERIC(5,2) NOT NULL DEFAULT 75
                              CHECK (attendance_threshold_pct > 0 AND attendance_threshold_pct <= 100),
  recording_complete_pct    NUMERIC(5,2) NOT NULL DEFAULT 95
                              CHECK (recording_complete_pct > 0 AND recording_complete_pct <= 100),
  model_approval_required   BOOLEAN NOT NULL DEFAULT true,
  max_submission_attempts   INTEGER NOT NULL DEFAULT 3
                              CHECK (max_submission_attempts BETWEEN 1 AND 10),
  join_opens_minutes_before INTEGER NOT NULL DEFAULT 15
                              CHECK (join_opens_minutes_before BETWEEN 0 AND 240),
  -- Same-day reminder at 9:00 AM KSA, sent by the existing daily cron.
  session_day_reminder      BOOLEAN NOT NULL DEFAULT true,
  -- Printed where an exam course prints a grade.
  certificate_grade_label   TEXT NOT NULL DEFAULT 'Completed',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE training_course_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE training_course_settings IS
  'Courses certified by live attendance or recordings plus an approved model (mig 247). A course with NO row here (3SFM, BVM) keeps the exam path; nothing reads this table for them.';

INSERT INTO training_course_settings (
  course_code, title, short_title, description, is_active, is_public, exams_enabled,
  cert_routes, allow_mixed_routes, attendance_threshold_pct, recording_complete_pct,
  model_approval_required, max_submission_attempts, join_opens_minutes_before,
  session_day_reminder, certificate_grade_label
) VALUES (
  'REFM', 'Real Estate Financial Modeling (Live Course)', 'REFM',
  'Eight weekly live sessions on Microsoft Teams, Tuesdays 7:00 to 9:30 PM KSA.',
  true, true, false,
  ARRAY['live','recording']::TEXT[], true, 75, 95,
  true, 3, 15,
  true, 'Completed'
) ON CONFLICT (course_code) DO NOTHING;

-- ── 2. Live sessions belong to a course ────────────────────────────────────────
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS course_code             TEXT
    REFERENCES training_course_settings(course_code) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_session_no       SMALLINT
    CHECK (course_session_no IS NULL OR course_session_no BETWEEN 1 AND 50),
  -- Graph onlineMeeting id (NOT the Outlook event id in teams_meeting_id),
  -- resolved from live_url on the first attendance sync.
  ADD COLUMN IF NOT EXISTS graph_online_meeting_id TEXT,
  ADD COLUMN IF NOT EXISTS attendance_synced_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_sync_error   TEXT,
  -- Actual meeting window from the attendance report (the % denominator).
  ADD COLUMN IF NOT EXISTS actual_start_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_end_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS day_reminder_sent_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_sessions_course_session_no
  ON live_sessions (course_code, course_session_no)
  WHERE course_code IS NOT NULL AND course_session_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_live_sessions_course
  ON live_sessions (course_code) WHERE course_code IS NOT NULL;

-- ── 3. Attendance per attendee per session ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_session_attendance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  -- As reported by Teams or the CSV, lowercased. Key with session_id.
  attendee_email    TEXT NOT NULL,
  attendee_name     TEXT,
  -- Matched platform email, lowercased. NULL = unmatched (admin list).
  student_email     TEXT,
  matched_by        TEXT CHECK (matched_by IN ('email','alias','manual')),
  -- [[joinIso, leaveIso], ...] merged, overlaps removed.
  intervals         JSONB NOT NULL DEFAULT '[]'::JSONB,
  attended_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (attended_seconds >= 0),
  session_seconds   INTEGER NOT NULL CHECK (session_seconds > 0),
  attended_pct      NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (attended_pct >= 0 AND attended_pct <= 100),
  source            TEXT NOT NULL CHECK (source IN ('graph','csv','manual')),
  role              TEXT,
  report_id         TEXT,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT,
  UNIQUE (session_id, attendee_email)
);

CREATE INDEX IF NOT EXISTS idx_live_session_attendance_student
  ON live_session_attendance (student_email) WHERE student_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_session_attendance_unmatched
  ON live_session_attendance (session_id) WHERE student_email IS NULL;

ALTER TABLE live_session_attendance ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE live_session_attendance IS
  'Teams attendance per attendee per live session (mig 247): Graph sync, CSV upload or manual entry. A student met by two Teams identities has two rows; eligibility merges their intervals.';

-- ── 4. Remembered email matches ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_email_aliases (
  alias_email    TEXT PRIMARY KEY CHECK (alias_email = lower(alias_email)),
  student_email  TEXT NOT NULL CHECK (student_email = lower(student_email)),
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (alias_email <> student_email)
);

CREATE INDEX IF NOT EXISTS idx_student_email_aliases_student ON student_email_aliases (student_email);

ALTER TABLE student_email_aliases ENABLE ROW LEVEL SECURITY;

-- ── 5. Join clicks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_session_join_clicks (
  id               BIGSERIAL PRIMARY KEY,
  session_id       UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  student_email    TEXT NOT NULL,
  registration_id  TEXT,
  clicked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent       TEXT
);

CREATE INDEX IF NOT EXISTS idx_live_session_join_clicks_session
  ON live_session_join_clicks (session_id, student_email);

ALTER TABLE live_session_join_clicks ENABLE ROW LEVEL SECURITY;

-- ── 6. Enrolment intent and source ─────────────────────────────────────────────
-- A public-page registrant's course, carried through email confirmation.
ALTER TABLE training_pending_registrations
  ADD COLUMN IF NOT EXISTS enrol_course_code TEXT;

ALTER TABLE training_enrollments
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto'
    CHECK (source IN ('auto','public_page','dashboard','admin')),
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;
