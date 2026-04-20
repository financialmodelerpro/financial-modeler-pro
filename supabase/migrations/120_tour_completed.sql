-- ============================================================
-- 120: Training Hub dashboard tour state
--
-- One-shot onboarding walkthrough (react-joyride) runs the first
-- time a student lands on /training/dashboard. Completion is
-- persisted here so subsequent visits don't re-trigger it.
--
-- Students can re-run the tour any time via the profile dropdown's
-- "Restart Tour" action, which flips this flag back to FALSE.
-- ============================================================

ALTER TABLE training_registrations_meta
  ADD COLUMN IF NOT EXISTS tour_completed BOOLEAN DEFAULT FALSE;
