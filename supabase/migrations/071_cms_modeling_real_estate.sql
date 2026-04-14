-- ============================================================
-- 071: Seed Real Estate Financial Modeling platform sub-page
-- into CMS page_sections. Option B approach — CMS-editable
-- with config fallbacks. Module guide stays dynamic from config.
-- ============================================================

-- Ensure cms_pages entry exists for real-estate
INSERT INTO cms_pages (slug, title, status, is_system)
VALUES ('modeling-real-estate', 'Real Estate Financial Modeling', 'published', true)
ON CONFLICT (slug) DO UPDATE
SET title = 'Real Estate Financial Modeling', status = 'published';

-- Clear any existing sections
DELETE FROM page_sections WHERE page_slug = 'modeling-real-estate';

-- ── Section 1: Hero ─────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling-real-estate', 'hero', 1, true,
 $json${
   "badge": "REFM",
   "headline": "Real Estate Financial Modeling",
   "subtitle": "Institutional-grade real estate development feasibility \u2014 from land to exit.",
   "status_badge": "\u2713 LIVE \u2014 Available Now",
   "cta_primary_text": "Launch Platform \u2192",
   "cta_primary_url": "/signin",
   "cta_secondary_text": "\u2190 Back to Modeling Hub",
   "cta_secondary_url": "/modeling"
 }$json$::jsonb,
 '{"bgColor": "#1B4F8A"}'::jsonb);

-- ── Section 2: What This Platform Covers ────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling-real-estate', 'text', 2, true,
 $json${
   "heading": "What This Platform Covers",
   "body": "The Real Estate Financial Modeling platform (REFM) is a structured, guided tool that takes you through every stage of a development feasibility \u2014 from project setup and land acquisition through to revenue projections, operating costs, financing structures, and final investor returns. Built for multi-asset development projects including residential, hospitality, and retail, the platform produces institutional-grade outputs ready for investor presentation, lender submission, or internal board review. Every assumption is clearly flagged, every calculation is traceable, and every output is formatted for professional presentation."
 }$json$::jsonb,
 '{}'::jsonb);

-- ── Section 3: Who Is It For ────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling-real-estate', 'list', 3, true,
 $json${
   "heading": "Who Is It For",
   "items": [
     {"icon": "\u2713", "title": "Real Estate Developers & Project Sponsors", "description": ""},
     {"icon": "\u2713", "title": "Investment Managers & Portfolio Managers", "description": ""},
     {"icon": "\u2713", "title": "Real Estate Analysts & Associates", "description": ""},
     {"icon": "\u2713", "title": "Lenders & Credit Analysts", "description": ""},
     {"icon": "\u2713", "title": "Family Offices with Real Estate Exposure", "description": ""},
     {"icon": "\u2713", "title": "Advisory Firms Supporting RE Transactions", "description": ""}
   ]
 }$json$::jsonb,
 '{}'::jsonb);

-- ── Section 4: What You Get ─────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling-real-estate', 'list', 4, true,
 $json${
   "heading": "What You Get",
   "items": [
     {"icon": "\u2713", "title": "Multi-asset project structure (residential, hospitality, retail) with configurable unit mix", "description": ""},
     {"icon": "\u2713", "title": "Full development cost schedule with hard costs, soft costs, land, and contingencies", "description": ""},
     {"icon": "\u2713", "title": "Debt and equity financing schedules with interest capitalization and cash sweep mechanics", "description": ""},
     {"icon": "\u2713", "title": "Revenue projections by asset class \u2014 unit sales, room revenue, lease income", "description": ""},
     {"icon": "\u2713", "title": "Operating expense modelling by asset with benchmark comparisons", "description": ""},
     {"icon": "\u2713", "title": "IRR and NPV calculations \u2014 project returns, equity returns, and scenario analysis", "description": ""},
     {"icon": "\u2713", "title": "Full financial statements \u2014 income statement, balance sheet, and cash flow", "description": ""},
     {"icon": "\u2713", "title": "One-click export to formula-linked Excel workbook and investor-ready PDF report", "description": ""}
   ]
 }$json$::jsonb,
 '{}'::jsonb);

-- ── Section 5: Module Guide (dynamic from config) ───────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling-real-estate', 'embed', 5, true,
 $json${
   "_dynamic": "platform_modules",
   "heading": "Step-by-Step Module Guide",
   "subheading": "Build your model module by module \u2014 each unlocks when you complete the previous step."
 }$json$::jsonb,
 '{}'::jsonb);

-- ── Section 6: Bottom CTA ───────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling-real-estate', 'cta', 6, true,
 $json${
   "heading": "Ready to build your model?",
   "description": "Start with Module 1 \u2014 free, structured, and ready to use right now.",
   "cta_text": "Launch Platform Free \u2192",
   "cta_url": "/register"
 }$json$::jsonb,
 '{}'::jsonb);
