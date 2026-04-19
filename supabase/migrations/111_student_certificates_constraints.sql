-- ============================================================
-- 111: Version-control `student_certificates` constraints + defend against
--      duplicates before declaring a natural key unique.
--
-- The base table was created outside of the migrations directory (see the
-- absence of CREATE TABLE student_certificates anywhere). Migration 028 is
-- an ALTER TABLE that assumes the table exists. As a result its
-- constraints (unique keys, NOT NULLs) have been invisible to this repo.
--
-- Symptom observed: the certificate engine called
--     .upsert({...}, { onConflict: 'registration_id' })
-- and got back `{ error }` — but the code didn't check `.error`. Admin UI
-- reported success while the DB never saw a row. The `ON CONFLICT` spec
-- requires a matching unique index on `registration_id`; without one,
-- Postgres rejects every upsert.
--
-- The engine was fixed to use explicit SELECT → UPDATE|INSERT so it's
-- constraint-agnostic going forward. This migration adds the unique
-- constraints the table SHOULD have had so future callers that use
-- `.upsert(…, { onConflict: 'certificate_id' })` or `(email, course_code)`
-- work predictably.
-- ============================================================

-- Deduplicate first so UNIQUE doesn't fail on existing data: keep the most
-- recent row per natural key.
DELETE FROM student_certificates a USING student_certificates b
WHERE a.ctid < b.ctid
  AND LOWER(a.email) = LOWER(b.email)
  AND COALESCE(a.course_code, a.course, '') = COALESCE(b.course_code, b.course, '');

-- Unique on (email, course_code): the natural key for a student + course.
-- Partial index covers only rows that actually populated course_code.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_student_certificates_email_course
  ON student_certificates (LOWER(email), course_code)
  WHERE course_code IS NOT NULL;

-- Unique on certificate_id: used as the QR'd verification slug, must be
-- globally unique. Partial index so legacy rows with null certificate_id
-- (if any) are not blocked.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_student_certificates_certificate_id
  ON student_certificates (certificate_id)
  WHERE certificate_id IS NOT NULL;
