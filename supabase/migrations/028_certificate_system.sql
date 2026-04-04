-- Migration 028: Internal certificate system
-- Adds new columns to student_certificates for fully internal cert + badge + transcript storage

ALTER TABLE student_certificates
  ADD COLUMN IF NOT EXISTS certificate_id     TEXT,
  ADD COLUMN IF NOT EXISTS course_code        TEXT,
  ADD COLUMN IF NOT EXISTS grade              TEXT,
  ADD COLUMN IF NOT EXISTS final_score        NUMERIC,
  ADD COLUMN IF NOT EXISTS avg_score          NUMERIC,
  ADD COLUMN IF NOT EXISTS cert_pdf_url       TEXT,
  ADD COLUMN IF NOT EXISTS transcript_url     TEXT,
  ADD COLUMN IF NOT EXISTS badge_url          TEXT,
  ADD COLUMN IF NOT EXISTS verification_url   TEXT,
  ADD COLUMN IF NOT EXISTS qr_code_url        TEXT,
  ADD COLUMN IF NOT EXISTS course_subheading  TEXT,
  ADD COLUMN IF NOT EXISTS course_description TEXT,
  ADD COLUMN IF NOT EXISTS issued_at          TIMESTAMPTZ;

-- Fast lookup by certificate_id (used by verify page)
CREATE INDEX IF NOT EXISTS idx_student_certificates_certificate_id
  ON student_certificates(certificate_id);
