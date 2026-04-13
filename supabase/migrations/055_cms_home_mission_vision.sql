-- ============================================================
-- 055: Seed home page Mission & Vision into page_sections
-- Two text_image sections editable via Admin CMS
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'home' AND section_type = 'text_image';

-- Mission (display_order 5 — after stats bar at 4, before What is FMP)
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'text_image', 5, true,
 '{"badge":"OUR MISSION","heading":"Our Mission","html":"<p>To make professional financial modeling accessible to every finance professional worldwide. We believe structured, real-world modeling skills should not be locked behind expensive courses or years of trial and error.</p>","imageSrc":"","imageAlt":"Our Mission","imagePosition":"right","imageWidth":"50%","imageHeight":"220px","imageFit":"cover","imageRadius":"12px","imagePlaceholder":"Mission Image"}',
 '{"bgColor":"#EFF6FF","paddingY":"64px","maxWidth":"1200px"}');

-- Vision (display_order 6 — after Mission, before What is FMP)
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'text_image', 6, true,
 '{"badge":"OUR VISION","heading":"Our Vision","html":"<p>To become the world''s leading financial modeling platform — where analysts, bankers, and finance teams come to build, learn, and grow their modeling capabilities across every discipline.</p>","imageSrc":"","imageAlt":"Our Vision","imagePosition":"left","imageWidth":"50%","imageHeight":"220px","imageFit":"cover","imageRadius":"12px","imagePlaceholder":"Vision Image"}',
 '{"bgColor":"#EFF6FF","paddingY":"64px","maxWidth":"1200px"}');
