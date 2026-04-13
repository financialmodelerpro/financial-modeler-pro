-- ============================================================
-- 063: Consolidate founder data — one clean experience list,
--      remove background_paragraphs (use long_bio instead)
-- ============================================================

-- Consolidate experience into one clean list
UPDATE page_sections
SET content = content
  - 'experience_highlights'
  || '{"experience":["15+ years in real estate finance and development advisory","Structured financing for projects across GCC, SEA, and international markets","Built financial models for residential, hospitality, and mixed-use developments","Worked with developers, sovereign funds, and institutional investors","Founded Financial Modeler Pro to democratize professional-grade modeling"]}'::jsonb
WHERE page_slug = 'home'
AND section_type = 'team'
AND display_order = 7;
