-- ============================================================
-- 046: Migrate /pricing page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'pricing';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('pricing', 'hero', 1, true,
 '{"badge":"Pricing","headline":"Simple, Transparent Pricing","subtitle":"Choose the plan that fits your needs"}',
 '{"bgColor":"linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)","textColor":"#ffffff","paddingY":"72px 40px 64px"}');

-- ── 2. Pricing plans (dynamic — rendered by custom component) ───────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('pricing', 'cards', 2, true,
 '{"_dynamic":"pricing_plans","heading":"","cards":[]}',
 '{"bgColor":"#F5F7FA","paddingY":"64px"}');

-- ── 3. FAQ ──────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('pricing', 'faq', 3, true,
 '{"_dynamic":"pricing_faq","heading":"Frequently Asked Questions","items":[]}',
 '{"bgColor":"#0D2E5A","textColor":"#ffffff","paddingY":"72px 40px 88px"}');

-- ── 4. CTA ──────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('pricing', 'cta', 4, true,
 '{"heading":"Start Modeling for Free","subtitle":"No credit card required. Full Module 1 access on the free plan.","buttonText":"Launch Platform Free →","buttonUrl":"/login"}',
 '{"bgColor":"#1B4F8A","textColor":"#ffffff","paddingY":"64px"}');
