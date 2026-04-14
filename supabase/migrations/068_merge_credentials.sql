-- ============================================================
-- 068: Merge credentials + experience into single credentials[]
-- credentials[] is now the single source of truth:
--   Home card → ✓ checklist
--   About page → numbered teal circles
--   Expanded view → numbered teal circles
-- ============================================================

-- Remove the experience field (credentials[] already has the right items)
UPDATE page_sections
SET content = content - 'experience'
WHERE page_slug = 'home'
  AND section_type = 'team';
