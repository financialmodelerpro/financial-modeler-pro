-- ═══════════════════════════════════════════════════════════════════════════════
-- 128: Backfill 5 students registered in Apps Script but missing from Supabase
--
-- Replaces the withdrawn migration 127, which incorrectly wrote to `name` and
-- `course` columns that do not exist on training_registrations_meta. The
-- actual schema only carries: registration_id, email, phone, created_at,
-- city, country, email_confirmed, confirmed_at, tour_completed. Name and
-- course live in Apps Script, which is already the source of truth for them.
--
-- The five students are recorded in the Google Sheet as RegIDs 0003 through
-- 0007; this migration just catches the Supabase side up so the announce
-- recipient query, dashboard, and watch-history paths treat them as the
-- registered students they actually are. ON CONFLICT DO NOTHING so re-runs
-- are a no-op once the rows land.
--
-- Paired with the /notify fetchRecipients fix shipping in the same PR,
-- which was the actual cause of the "0 confirmed students" symptom in the
-- Announce modal (it SELECT-ed nonexistent name/course columns, Supabase
-- errored, and the destructure silently swallowed it, returning zero rows).
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO training_registrations_meta
  (registration_id, email,                      email_confirmed, confirmed_at, created_at)
VALUES
  ('FMP-2026-0003', 'maharraees430@gmail.com',  TRUE, now(), now()),
  ('FMP-2026-0004', 'faizaan311@gmail.com',     TRUE, now(), now()),
  ('FMP-2026-0005', 'asranahmed@gmail.com',     TRUE, now(), now()),
  ('FMP-2026-0006', 'alifaran367@gmail.com',    TRUE, now(), now()),
  ('FMP-2026-0007', 'qasimbsaeed@gmail.com',    TRUE, now(), now())
ON CONFLICT (registration_id) DO NOTHING;
