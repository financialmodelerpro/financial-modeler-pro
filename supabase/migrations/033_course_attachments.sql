-- ============================================================
-- 033: Course Attachments
-- File attachments per session (PDF, Word, PPT, Excel, images)
-- ============================================================

CREATE TABLE IF NOT EXISTS course_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_key     text NOT NULL,           -- e.g. '3SFM_S1', 'BVM_L3'
  course      text NOT NULL,           -- '3sfm' or 'bvm'
  file_name   text NOT NULL,
  file_url    text NOT NULL,
  file_type   text NOT NULL,           -- 'pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'png', etc.
  file_size   int,                     -- bytes
  is_visible  boolean NOT NULL DEFAULT true,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_course_attachments_tab ON course_attachments (tab_key, is_visible);
