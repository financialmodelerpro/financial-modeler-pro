-- ============================================================
-- 057: Restore full "What is FMP?" body text + checklist items
-- ============================================================

UPDATE page_sections
SET content = jsonb_set(
  jsonb_set(
    jsonb_set(
      content,
      '{html}',
      '"<p>Financial Modeler Pro is a professional hub for financial modeling across all disciplines — built for analysts, developers, and investors. It replaces complex spreadsheets with a structured, guided workflow that produces audit-ready models in a fraction of the time.</p><p>Every assumption is traceable. Every output is formatted for investor presentation. And every model can be exported to a formula-linked Excel workbook or a clean investor PDF — ready to share on day one.</p>"'::jsonb
    ),
    '{items}',
    '["Multi-discipline modeling — real estate, valuation, FP&A, LBO, and more","Structured workflows — from assumptions to investor-ready outputs","Monthly or annual modeling with full period control","Formula-linked Excel export + investor PDF reports","White-label ready for advisory firms and consultants","100% free training on every financial modeling topic"]'::jsonb
  ),
  '{features}',
  '["Multi-discipline modeling — real estate, valuation, FP&A, LBO, and more","Structured workflows — from assumptions to investor-ready outputs","Monthly or annual modeling with full period control","Formula-linked Excel export + investor PDF reports","White-label ready for advisory firms and consultants","100% free training on every financial modeling topic"]'::jsonb
)
WHERE page_slug = 'home'
AND section_type = 'text_image'
AND content->>'heading' = 'What is Financial Modeler Pro?';
