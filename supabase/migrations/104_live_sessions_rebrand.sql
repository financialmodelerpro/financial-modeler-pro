-- ============================================================
-- 104: Rebrand training-sessions page + nav to
--      "FMP Real-World Financial Modeling" series
-- ============================================================

-- 1. Public page hero (page_sections)
UPDATE page_sections
SET content = content || '{
  "heading": "FMP Real-World Financial Modeling",
  "headline": "FMP Real-World Financial Modeling",
  "subtitle": "Live sessions and recorded content. Practitioner-led. Built on real deal work.",
  "badge": "LIVE & RECORDED SESSIONS"
}'::jsonb
WHERE page_slug = 'training-sessions'
  AND section_type = 'hero';

-- 2. Main-site navbar link label (site_pages)
UPDATE site_pages
SET label = 'Live Sessions'
WHERE href = '/training-sessions'
  AND label = 'Training Sessions';
