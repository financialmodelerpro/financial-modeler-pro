-- ============================================================
-- 032: Shuffle settings for assessments
-- Controls question order and option order per course
-- ============================================================

INSERT INTO training_settings (key, value) VALUES
  ('shuffle_questions_3sfm', 'true'),
  ('shuffle_questions_bvm',  'true'),
  ('shuffle_options_3sfm',   'false'),
  ('shuffle_options_bvm',    'false')
ON CONFLICT (key) DO NOTHING;
