-- ═══════════════════════════════════════════════════════════════════════════════
-- 148: Model submission gating for certificate issuance
-- ═══════════════════════════════════════════════════════════════════════════════
-- Adds a "students must build and submit a financial model before the final
-- exam unlocks" requirement to the cert pipeline. The model is admin-reviewed
-- (Ahmad, manually) on an effort-based pass/reject criterion. If approved,
-- the final exam button reveals on the dashboard. If rejected, the student
-- gets one of their 3 attempts back and resubmits.
--
-- Three insertion points in the cert flow gate on the model status (see
-- Phase B for code wiring):
--   1. UI gate in CourseContent.tsx hides the Final Exam button until
--      the latest submission is approved.
--   2. Server gate in /api/training/submit-assessment refuses to record
--      a final-exam score when not approved (covers stale-tab + deeplink
--      bypass attempts).
--   3. Engine gate in issueCertificateForPending refuses to issue when
--      not approved, with `options.force` bypass preserved for the admin
--      force-issue safety-net path.
--
-- Soft-launch posture (per Phase 6 plan):
--   - Per-course required flags default 'false' so this migration is
--     observation-only at ship time. No live student is gated.
--   - announcement_only='true' drives a notice banner on the dashboard
--     ("Coming soon: model submission required before final exam") so
--     the existing 30+ students get visibility before enforcement starts.
--   - notice_days='7' is the documented soft-launch period; flipping
--     announcement_only='false' AND model_submission_required_<course>=
--     'true' is the cutover knob and is a manual training_settings edit.
--
-- Locked decisions baked in:
--   - 3 max attempts per (student, course). After 3 rejections, student
--     contacts admin; the force-issue path bypasses model approval.
--   - 10 MB file size cap.
--   - File types xlsx, xls, xlsm, pdf (enforced application-side; the
--     mime_type column captures whatever was actually uploaded).
--   - Reject consumes an attempt.
--   - Review SLA 5 business days (admin-facing copy + notice email).
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS model_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL,
  course_code       TEXT NOT NULL CHECK (course_code IN ('3SFM', 'BVM')),
  attempt_number    INTEGER NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 3),

  -- Storage path inside the private model-submissions bucket. NOT a public
  -- URL: admin file access goes through an admin-gated proxy route that
  -- reads this column and calls supabase.storage.download() with the
  -- service-role client. The bucket is private; no public-read policy.
  storage_path      TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  file_size         INTEGER NOT NULL DEFAULT 0,
  mime_type         TEXT NOT NULL,
  student_notes     TEXT,

  status            TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by_admin TEXT,                    -- admin email; nullable until reviewed
  review_note       TEXT                     -- required on reject; optional on approve
);

-- Each (student, course) gets at most 3 submissions (attempt_number 1..3).
-- After three rows exist for a (student, course), the API refuses further
-- uploads and tells them to contact admin. The force-issue path
-- (/api/admin/certificates/force-issue) bypasses model approval entirely.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_model_submissions_email_course_attempt
  ON model_submissions(LOWER(email), course_code, attempt_number);

-- Hot path: admin review queue. Partial index keeps lookup constant-time
-- as approved/rejected rows accumulate.
CREATE INDEX IF NOT EXISTS idx_model_submissions_pending
  ON model_submissions(submitted_at DESC)
  WHERE status = 'pending_review';

-- Hot path: per-student status check for the cert engine + dashboard UI
-- (called on every dashboard render once the gate is on).
CREATE INDEX IF NOT EXISTS idx_model_submissions_email_course
  ON model_submissions(LOWER(email), course_code, submitted_at DESC);

COMMENT ON TABLE model_submissions IS
  'Student-built financial model submissions gating cert issuance. Files live in the private model-submissions storage bucket. Up to 3 attempts per (student, course); each rejection consumes one attempt; after 3 the student contacts admin and the force-issue path stays available.';

COMMENT ON COLUMN model_submissions.storage_path IS
  'Path inside the private model-submissions bucket. Admin reads via service-role-authenticated proxy route, never public URL.';

COMMENT ON COLUMN model_submissions.attempt_number IS
  '1, 2, or 3. Server-incremented on insert. After 3 rejected attempts the student must contact admin (force-issue bypass).';

COMMENT ON COLUMN model_submissions.status IS
  'pending_review (default on insert) | approved (final exam unlocks + cert can issue on next final pass) | rejected (consumes attempt, student may resubmit if attempts remain).';

-- ── Storage bucket: model-submissions (PRIVATE) ────────────────────────────
-- Private intentionally: the uploaded file is the student's work product
-- and reveals their effort. Service role bypasses RLS, so the upload route
-- and the admin file-proxy route both work without any policy. We DO NOT
-- create a public-read policy; that would defeat the privacy goal.
INSERT INTO storage.buckets (id, name, public)
VALUES ('model-submissions', 'model-submissions', false)
ON CONFLICT (id) DO NOTHING;

-- ── Settings seeds ──────────────────────────────────────────────────────────
-- All flags safe to ship hot: per-course required flags default 'false' so
-- nothing on the live Training Hub changes when this migration applies.
-- Soft-launch notice banner is on by default (announcement_only='true') so
-- students see the heads-up immediately. Admin flips required_<course> to
-- 'true' AND announcement_only to 'false' when the notice period elapses.
INSERT INTO training_settings (key, value) VALUES
  ('model_submission_required_3sfm',     'false'),
  ('model_submission_required_bvm',      'false'),
  ('model_submission_max_attempts',      '3'),
  ('model_submission_max_file_size_mb',  '10'),
  ('model_submission_review_sla_days',   '5'),
  ('model_submission_announcement_only', 'true'),
  ('model_submission_notice_days',       '7')
ON CONFLICT (key) DO NOTHING;
