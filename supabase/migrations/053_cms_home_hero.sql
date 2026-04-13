-- ============================================================
-- 053: Seed home page hero into page_sections
-- Text is editable via Admin CMS; layout stays hardcoded
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'home' AND section_type = 'hero';

INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'hero', 1, true,
 '{"badge":"🚀 Now Live — Free to Use","headline":"Build Institutional-Grade Financial Models — Without Starting From Scratch","subtitle":"Pre-built, structured financial models for real estate, valuation, and project finance — designed by corporate finance professionals for real-world use.","powerStatement":"No more rebuilding models. No more broken Excel files. No more wasted hours.","softCta":"Explore the platform","trustLine":"Designed by Investment & Corporate Finance Experts  |  12+ Years Experience  |  Used Across KSA & Pakistan","tags":"Real Estate Models, Business Valuation, Project Finance, Fund Models","cta1Text":"Launch Platform Free →","cta1Url":"/login","cta1Visible":true,"cta2Text":"Explore Platforms ↓","cta2Url":"/modeling","cta2Visible":false,"softCtaVisible":true}',
 '{"bgColor":"linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)","textColor":"#ffffff","paddingY":"clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)"}');
