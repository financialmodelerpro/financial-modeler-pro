-- ============================================================
-- 054: Seed home page stats bar into page_sections
-- Text is editable via Admin CMS; layout stays hardcoded
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'home' AND section_type = 'stats';

INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'stats', 4, true,
 '{"items":[{"value":"12+","label":"Years of Experience","visible":true},{"value":"10+","label":"Modeling Platforms","visible":true},{"value":"20+","label":"Currencies Supported","visible":true},{"value":"100%","label":"Free Training — No Paywall","visible":true}]}',
 '{"bgColor":"#0A2248","textColor":"#fff","paddingY":"32px","valueColor":"#4A90D9"}');
