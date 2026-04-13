-- ============================================================
-- 048: Migrate /modeling marketing page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'modeling';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'hero', 1, true,
 '{"badge":"Professional Modeling Platform","headline":"Build Institutional-Grade\nFinancial Models","subtitle":"Structured, guided workflows for every financial discipline — real estate, business valuation, LBO, FP&A, and more. Built by practitioners. Free to use.","buttons":[{"label":"Register Free →","url":"/register","style":"primary"},{"label":"Login to Dashboard →","url":"/signin","style":"outline"}]}',
 '{"bgColor":"linear-gradient(135deg,#0A1F3D 0%,#0D2E5A 50%,#0F3D6E 100%)","textColor":"#ffffff","paddingY":"clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)"}');

-- ── 2. Audience section (6 cards) ───────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cards', 2, true,
 '{"badge":"The Platform","heading":"What is the Modeling Hub?","description":"A structured, guided platform that replaces complex manual spreadsheets with professional financial modeling workflows. Built for analysts, investors, and advisory firms who need institutional-grade outputs fast. Every assumption is traceable. Every output is formatted for investor presentation.","cards":[{"icon":"💹","title":"Financial Analysts","description":"Structured workflows replacing manual spreadsheet builds"},{"icon":"🏢","title":"Investment Professionals","description":"Due diligence and deal-ready financial models"},{"icon":"🏘️","title":"Real Estate Developers","description":"Development feasibilities from land to exit"},{"icon":"👨‍👩‍👧","title":"Family Offices","description":"Multi-asset portfolio and investment modeling"},{"icon":"🏦","title":"Lenders & Banks","description":"Credit analysis, DSCR, project finance models"},{"icon":"🎓","title":"Students & Aspiring Analysts","description":"Learn by doing with real professional frameworks"}]}',
 '{"bgColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 3. Modules / Platforms grid (dynamic) ───────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cards', 3, true,
 '{"_dynamic":"modules","badge":"The Platforms","heading":"10+ Professional Modeling Platforms","subtitle":"Live now and launching soon — one platform for every financial modeling discipline.","cards":[]}',
 '{"bgColor":"#F5F7FA","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 4. Why section (benefits) ───────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cards', 4, true,
 '{"heading":"Why Modeling Hub?","cards":[{"icon":"⚡","title":"Instant Outputs","description":"From assumptions to investor-ready model in minutes, not days."},{"icon":"🔗","title":"Fully Linked","description":"Change one input, everything updates automatically across the entire model."},{"icon":"📤","title":"Export Ready","description":"Formula-linked Excel workbook and investor PDF with one click."},{"icon":"🆓","title":"Always Free","description":"No subscription, no paywall, full access from day one."}]}',
 '{"bgColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 5. Testimonials (dynamic) ───────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cards', 5, true,
 '{"_dynamic":"testimonials","heading":"What Professionals Say","subtitle":"Feedback from finance professionals using the Modeling Hub.","cards":[]}',
 '{"bgColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');

-- ── 6. CTA ──────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cta', 6, true,
 '{"heading":"Ready to build your first model?","subtitle":"Join financial professionals around the world building institutional-grade models — completely free.","buttonText":"Launch Platform Free →","buttonUrl":"/register"}',
 '{"bgColor":"#1B4F8A","textColor":"#ffffff","paddingY":"clamp(48px,7vw,80px)"}');
