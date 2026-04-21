-- ═══════════════════════════════════════════════════════════════════════════════
-- 131: Supabase-native registration schema prep
--
-- Part of the Apps-Script-to-Supabase migration. Two small shape changes
-- that unblock everything else:
--
--   1. Add `name` to training_registrations_meta. The column was documented
--      in CLAUDE-DB.md but never actually existed; the broken /notify
--      SELECT that read `name, course` is what produced the "0 confirmed
--      students" symptom earlier. Backfilled by
--      scripts/backup_apps_script_students.ts from the Apps Script roster
--      dump (also committed as JSON in supabase/backups/).
--
--   2. Drop NOT NULL on training_pending_registrations.course. The new
--      registration form no longer asks for course at signup time;
--      students pick courses after email confirmation via the enrollment
--      flow. Existing rows keep whatever value they had.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE training_registrations_meta
  ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE training_pending_registrations
  ALTER COLUMN course DROP NOT NULL;
