-- ============================================================
-- 051: Migrate /training-sessions page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'training-sessions';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training-sessions', 'hero', 1, true,
 '{"badge":"Live & Recorded","headline":"Training Sessions","subtitle":"Join free live financial modeling training sessions or watch recordings. Learn DCF, valuation, and 3-statement modeling with Ahmad Din."}',
 '{"bgColor":"linear-gradient(135deg,#0A1F3D 0%,#0D2E5A 50%,#0F3D6E 100%)","textColor":"#ffffff","paddingY":"72px 40px 56px"}');

-- ── 2. Sessions list (dynamic) ──────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('training-sessions', 'cards', 2, true,
 '{"_dynamic":"live_sessions","heading":"","cards":[]}',
 '{"bgColor":"#ffffff","paddingY":"0"}');
