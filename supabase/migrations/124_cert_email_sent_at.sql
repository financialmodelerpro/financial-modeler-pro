-- ============================================================
-- 124: Certificate email delivery timestamp
--
-- Adds `email_sent_at TIMESTAMPTZ NULL` to `student_certificates`.
-- Stamped by `certificateEngine.issueCertificateForPending` after
-- the issuance email resolves successfully. Staying NULL means the
-- row was written but the notification email never went out, which
-- surfaces in the admin certificates list so an operator can hit
-- "Resend Email" from the safety-net panel.
--
-- This column plus the inline-trigger migration away from the daily
-- cron closes the observability gap called out in the pre-launch
-- diagnosis: every cert now has a visible email delivery state
-- alongside its generation state.
-- ============================================================

ALTER TABLE student_certificates
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ NULL;

-- Partial index on rows with a cert but no recorded email, so the
-- "needs resend" query stays constant-time even as the certificates
-- table grows. We only need the email + certificate_id to power the
-- admin resend action.
CREATE INDEX IF NOT EXISTS idx_student_certificates_email_unsent
  ON student_certificates (email, certificate_id)
  WHERE email_sent_at IS NULL AND cert_status = 'Issued';
