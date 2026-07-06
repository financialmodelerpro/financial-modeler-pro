-- ============================================================
--  185_reviewed_model_return.sql
--  Return leg for the model-review flow: when an admin APPROVES a submission,
--  they can attach a REVIEWED model file (marked-up / corrected) that the student
--  receives via email (a download link) and can access in the dashboard. The
--  approval COMMENT already exists (model_submissions.review_note, optional on
--  approve), so this migration only adds the reviewed-file reference.
--
--  Additive + non-destructive: four NULLABLE columns; existing submissions and
--  the approve/unlock flow are unchanged (an approval without a reviewed file
--  leaves these NULL and behaves exactly as before). The reviewed file lives in
--  the SAME private `model-submissions` bucket (mig 148); the columns hold its
--  storage path + metadata, served by an ownership-checked proxy route (never a
--  public URL), mirroring the admin file proxy.
--
--  Apply manually via the Supabase dashboard. No em dashes.
-- ============================================================

ALTER TABLE model_submissions ADD COLUMN IF NOT EXISTS reviewed_file_path TEXT;
ALTER TABLE model_submissions ADD COLUMN IF NOT EXISTS reviewed_file_name TEXT;
ALTER TABLE model_submissions ADD COLUMN IF NOT EXISTS reviewed_file_size INTEGER;
ALTER TABLE model_submissions ADD COLUMN IF NOT EXISTS reviewed_file_mime TEXT;

COMMENT ON COLUMN model_submissions.reviewed_file_path IS
  'Storage path in the private model-submissions bucket for the admin-returned REVIEWED model (attached on approve). NULL when the admin approved without returning a file. Served by an ownership-checked proxy route (student download), never a public URL.';
COMMENT ON COLUMN model_submissions.reviewed_file_name IS 'Original filename of the returned reviewed model.';
COMMENT ON COLUMN model_submissions.reviewed_file_size IS 'Byte size of the returned reviewed model.';
COMMENT ON COLUMN model_submissions.reviewed_file_mime IS 'MIME type of the returned reviewed model.';
