-- ─────────────────────────────────────────────────────────────────────────────
-- 016_fix_nav_urls.sql
-- Update Modeling Hub and Pricing nav entries from anchor links to page URLs
-- ─────────────────────────────────────────────────────────────────────────────

-- Modeling Hub: #modules → /modeling-hub
UPDATE site_pages
SET href = '/modeling-hub'
WHERE href IN ('#modules', '/#modules') OR label = 'Modeling Hub';

-- Pricing: #pricing → /pricing
UPDATE site_pages
SET href = '/pricing'
WHERE href IN ('#pricing', '/#pricing') OR label = 'Pricing';
