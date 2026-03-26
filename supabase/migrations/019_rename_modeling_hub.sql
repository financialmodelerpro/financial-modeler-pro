-- ─────────────────────────────────────────────────────────────────────────────
-- 019_rename_modeling_hub.sql
-- Rename /modeling-hub → /modeling in site_pages
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE site_pages
SET href = '/modeling'
WHERE href IN ('/modeling-hub', '/#modules', '#modules');
