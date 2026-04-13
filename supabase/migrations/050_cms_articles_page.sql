-- ============================================================
-- 050: Migrate /articles page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'articles';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('articles', 'hero', 1, true,
 '{"badge":"Knowledge Hub","headline":"Financial Modeling Insights","subtitle":"Expert guides, tutorials and market analysis from corporate finance professionals"}',
 '{"bgColor":"#0D2E5A","textColor":"#ffffff","paddingY":"72px 40px 56px"}');

-- ── 2. Articles grid (dynamic) ──────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('articles', 'cards', 2, true,
 '{"_dynamic":"articles","heading":"Latest Articles","cards":[]}',
 '{"bgColor":"#0D2E5A","textColor":"#ffffff","paddingY":"56px 40px"}');
