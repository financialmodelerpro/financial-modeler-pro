-- ═══════════════════════════════════════════════════════════════════════════════
-- 256: remove Marketing Studio (founder, 2026-11-11)
-- ═══════════════════════════════════════════════════════════════════════════════
-- The Training Hub Marketing Studio (migration 142) is removed from the code.
-- This drops what migration 142 created in the database and nothing else:
--   - table public.marketing_uploaded_assets (its background library index:
--     1 row, 64 kB, measured 2026-11-11), with its index;
--   - the storage policy "marketing-assets public read" on storage.objects.
--
-- NOT here, on purpose: the marketing-assets bucket and its one file
-- (bg/1777290982038-vmez7mz.png, 145 kB). Supabase refuses direct SQL
-- deletes on storage tables, so they are removed through the Storage API
-- after this migration is applied.
--
-- Nothing shared is touched. The studio only READ articles, cms_content,
-- email_branding, instructors and live_sessions; no column, function,
-- trigger or view of its own exists on them (checked against the live
-- schema 2026-11-11). Nothing outside the studio references the bucket.
--
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.marketing_uploaded_assets;

DROP POLICY IF EXISTS "marketing-assets public read" ON storage.objects;
