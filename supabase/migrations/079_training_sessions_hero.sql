-- ============================================================
-- 079: Update training-sessions hero with full CMS content
-- ============================================================

UPDATE page_sections
SET content = content || '{
  "heading": "Training Sessions",
  "subtitle": "Join our free live training sessions or watch recordings at your own pace.",
  "badge": "LIVE LEARNING",
  "cta_primary_text": "Register for Free \u2192",
  "cta_primary_url": "/register",
  "cta_secondary_text": "Browse Recordings",
  "cta_secondary_url": "#recordings-section"
}'::jsonb
WHERE page_slug = 'training-sessions'
  AND section_type = 'hero';
