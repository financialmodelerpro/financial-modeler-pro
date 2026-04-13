-- ============================================================
-- 060: Founder section fixes — qualifications, photo auto, booking
-- ============================================================

UPDATE page_sections
SET content = content || '{"qualifications":"ACCA | FMVA | 12+ Years Experience","photo_height":"auto","photo_fit":"contain"}'::jsonb
WHERE page_slug = 'home'
AND section_type = 'team'
AND display_order = 7;
