-- Migration 096: Remove html field from text_image sections to prevent duplicate rendering
-- The admin editor now uses only the body field; html field is legacy

UPDATE page_sections
SET content = content - 'html',
    updated_at = now()
WHERE section_type = 'text_image'
  AND content ? 'html'
  AND content ? 'body'
  AND (content->>'html') IS NOT NULL
  AND (content->>'html') != '';
