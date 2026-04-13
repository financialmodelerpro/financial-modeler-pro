-- ============================================================
-- 056: Remove duplicate Mission/Vision text sections,
--      add "What is FMP?" section, fix display_order sequence
-- ============================================================

-- ── 1. Remove old plain 'text' type Mission & Vision (seeded by 049) ────
DELETE FROM page_sections
WHERE page_slug = 'home'
AND section_type = 'text'
AND content->>'heading' IN ('Our Mission', 'Our Vision');

-- ── 2. Add "What is Financial Modeler Pro?" section ─────────────────────
-- (Was in 049 as text_image at order 5 but got deleted by 055's
--  DELETE FROM page_sections WHERE section_type='text_image')
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'text_image', 3, true,
 '{"badge":"The Platform","heading":"What is Financial Modeler Pro?","html":"<p>Financial Modeler Pro is a professional hub for financial modeling across all disciplines — built for analysts, developers, and investors. It replaces complex spreadsheets with a structured, guided workflow that produces audit-ready models in a fraction of the time.</p><p>Every assumption is traceable. Every output is formatted for investor presentation. And every model can be exported to a formula-linked Excel workbook or a clean investor PDF — ready to share on day one.</p>","imageSrc":"","imageAlt":"Platform Screenshot","imagePosition":"right","imageWidth":"45%","imageHeight":"auto","imageFit":"cover","imageRadius":"12px","imagePlaceholder":"Platform Screenshot","features":["Multi-discipline modeling — real estate, valuation, FP&A, LBO, and more","Structured workflows — from assumptions to investor-ready outputs","Monthly or annual modeling with full period control","Formula-linked Excel export + investor PDF reports","White-label ready for advisory firms and consultants","100% free training on every financial modeling topic"]}',
 '{"bgColor":"#ffffff","paddingY":"88px","maxWidth":"1100px"}');

-- ── 3. Fix display_order for all home sections ─────────────────────────
-- Target sequence:
--  1=hero, 2=stats, 3=what_is_fmp, 4=mission, 5=vision,
--  6=columns(pillars), 7=team(founder), 8=columns(pacemakers),
--  9=articles, 10=testimonials, 11=pricing_preview, 12=cta

-- Hero → 1
UPDATE page_sections SET display_order = 1
WHERE page_slug = 'home' AND section_type = 'hero';

-- Stats → 2
UPDATE page_sections SET display_order = 2
WHERE page_slug = 'home' AND section_type = 'stats';

-- What is FMP (just inserted) → 3 (already set above)

-- Mission (text_image, the one with "Our Mission" heading) → 4
UPDATE page_sections SET display_order = 4
WHERE page_slug = 'home' AND section_type = 'text_image'
AND content->>'heading' = 'Our Mission';

-- Vision (text_image, the one with "Our Vision" heading) → 5
UPDATE page_sections SET display_order = 5
WHERE page_slug = 'home' AND section_type = 'text_image'
AND content->>'heading' = 'Our Vision';

-- Pillars (columns, first one with "Two Platforms" heading) → 6
UPDATE page_sections SET display_order = 6
WHERE page_slug = 'home' AND section_type = 'columns'
AND content->>'heading' LIKE 'Two Platforms%';

-- Founder (team) → 7
UPDATE page_sections SET display_order = 7
WHERE page_slug = 'home' AND section_type = 'team';

-- PaceMakers (columns, the one with "Powered by PaceMakers" heading) → 8
UPDATE page_sections SET display_order = 8
WHERE page_slug = 'home' AND section_type = 'columns'
AND content->>'heading' LIKE 'Powered by%';

-- Articles (cards with _dynamic=articles) → 9
UPDATE page_sections SET display_order = 9
WHERE page_slug = 'home' AND section_type = 'cards'
AND (content->>'_dynamic') = 'articles';

-- Testimonials (cards with _dynamic=testimonials) → 10
UPDATE page_sections SET display_order = 10
WHERE page_slug = 'home' AND section_type = 'cards'
AND (content->>'_dynamic') = 'testimonials';

-- Pricing preview (cards with _dynamic=pricing_preview) → 11
UPDATE page_sections SET display_order = 11
WHERE page_slug = 'home' AND section_type = 'cards'
AND (content->>'_dynamic') = 'pricing_preview';

-- CTA → 12
UPDATE page_sections SET display_order = 12
WHERE page_slug = 'home' AND section_type = 'cta';
