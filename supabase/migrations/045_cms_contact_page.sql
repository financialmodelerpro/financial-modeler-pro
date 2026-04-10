-- ============================================================
-- 045: Migrate /contact page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

-- Clean existing contact sections (seeded by 031)
DELETE FROM page_sections WHERE page_slug = 'contact';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('contact', 'hero', 1, true,
 '{"badge":"Reach Out","headline":"Get in Touch","subtitle":"Have a question about the platform, pricing, or a partnership? We would love to hear from you."}',
 '{"bgColor":"linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)","textColor":"#ffffff","paddingY":"64px 40px 56px"}');

-- ── 2. Contact body (dynamic — info cards + form, rendered inline)
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('contact', 'columns', 2, true,
 '{"_dynamic":"contact_body","heading":"","columns":[]}',
 '{"bgColor":"#F5F7FA","paddingY":"56px 40px 80px"}');
