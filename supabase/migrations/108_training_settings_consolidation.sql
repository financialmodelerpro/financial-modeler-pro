-- ============================================================
-- 108: Consolidate training settings — one global shuffle setting
--      instead of per-course keys; migrate existing values.
-- ============================================================

-- 1. Seed global shuffle keys (defaults mirror the previous 3SFM defaults).
INSERT INTO training_settings (key, value)
VALUES
  ('shuffle_questions_enabled', 'true'),
  ('shuffle_options_enabled',   'false')
ON CONFLICT (key) DO NOTHING;

-- 2. Migrate existing per-course values. Global is ON if EITHER course has it ON.
--    (Safe re-run: UPDATE only fires when per-course rows exist.)
UPDATE training_settings AS t
SET value = (
  CASE
    WHEN EXISTS (
      SELECT 1 FROM training_settings
      WHERE key IN ('shuffle_questions_3sfm', 'shuffle_questions_bvm')
        AND value = 'true'
    ) THEN 'true'
    ELSE 'false'
  END
)
WHERE t.key = 'shuffle_questions_enabled'
  AND EXISTS (
    SELECT 1 FROM training_settings
    WHERE key IN ('shuffle_questions_3sfm', 'shuffle_questions_bvm')
  );

UPDATE training_settings AS t
SET value = (
  CASE
    WHEN EXISTS (
      SELECT 1 FROM training_settings
      WHERE key IN ('shuffle_options_3sfm', 'shuffle_options_bvm')
        AND value = 'true'
    ) THEN 'true'
    ELSE 'false'
  END
)
WHERE t.key = 'shuffle_options_enabled'
  AND EXISTS (
    SELECT 1 FROM training_settings
    WHERE key IN ('shuffle_options_3sfm', 'shuffle_options_bvm')
  );

-- 3. Drop the now-obsolete per-course shuffle keys + the timer bypass key
--    (watch-enforcement replaces time-based locking).
DELETE FROM training_settings
WHERE key IN (
  'shuffle_questions_3sfm',
  'shuffle_questions_bvm',
  'shuffle_options_3sfm',
  'shuffle_options_bvm',
  'timer_bypass_enabled'
);
