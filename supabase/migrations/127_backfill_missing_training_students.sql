-- ═══════════════════════════════════════════════════════════════════════════════
-- 127: Backfill 5 students registered in Apps Script but missing from Supabase
--
-- Root cause (fixed in the same PR via app/api/training/confirm-email/route.ts):
--   The confirm-email upsert into training_registrations_meta dropped the
--   `name` and `course` columns. On new INSERTs the NOT NULL constraints on
--   those columns caused the write to fail silently (route code didn't
--   check the returned `error`), the pending_registrations row was then
--   deleted unconditionally, and the student was redirected to signin as
--   if everything worked. Apps Script had the student; Supabase didn't.
--
-- This migration seeds the 5 known-missing students using the Apps Script
-- sheet as source of truth (RegID, email, name, course supplied by admin).
-- ON CONFLICT DO NOTHING so re-runs are a no-op once the rows land.
--
-- Passwords may or may not have survived depending on whether
-- training_passwords has an FK to training_registrations_meta(registration_id).
-- If this backfill reveals passwords are missing, the five students will need
-- to use /training/forgot to reset before first sign-in. See the PR
-- description for the operator-triggered reset list.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO training_registrations_meta
  (registration_id, email,                         name,                    course, email_confirmed, confirmed_at, created_at)
VALUES
  ('FMP-2026-0003', 'maharraees430@gmail.com',     'Muhammad Raees Iqbal',  '3sfm', TRUE, now(), now()),
  ('FMP-2026-0004', 'faizaan311@gmail.com',        'Muhammad Faizaan Ali',  '3sfm', TRUE, now(), now()),
  ('FMP-2026-0005', 'asranahmed@gmail.com',        'Asran Ahmed',           '3sfm', TRUE, now(), now()),
  ('FMP-2026-0006', 'alifaran367@gmail.com',       'Ali Faran',             '3sfm', TRUE, now(), now()),
  ('FMP-2026-0007', 'qasimbsaeed@gmail.com',       'Qasim Saeed',           '3sfm', TRUE, now(), now())
ON CONFLICT (registration_id) DO NOTHING;
