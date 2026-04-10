-- ============================================================
-- 045: Migrate /about page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

-- Clean existing about sections (seeded by 031)
DELETE FROM page_sections WHERE page_slug = 'about';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('about', 'hero', 1, true,
 '{"badge":"About","headline":"Built for Financial Modeling Professionals","subtitle":"Financial Modeler Pro was built to solve a real problem: professional financial modeling shouldn''t require 5 years of Excel wizardry. It should be structured, auditable, and presentation-ready from day one."}',
 '{"bgColor":"#0D2E5A","textColor":"#ffffff","paddingY":"80px 40px 64px"}');

-- ── 2. Mission + Who We Serve (two-column layout) ───────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('about', 'columns', 2, true,
 '{"heading":"","count":2,"columns":[{"heading":"Our Mission","html":"<p style=\"color:rgba(255,255,255,0.55);line-height:1.75;font-size:14.5px\">To make professional-grade financial modeling accessible to every developer, analyst, and investor — regardless of their spreadsheet skill level.</p><p style=\"color:rgba(255,255,255,0.45);line-height:1.75;font-size:14.5px\">We believe that the quality of a financial model shouldn''t be limited by the tools available. Financial Modeler Pro provides the structure, the logic, and the output formats that deal-makers actually need.</p>"},{"heading":"Who We Serve","html":"<div style=\"text-align:left\"><div style=\"display:flex;gap:12px;margin-bottom:20px\"><span style=\"font-size:22px;flex-shrink:0;margin-top:2px\">🏗️</span><div><div style=\"font-size:14px;font-weight:700;color:#fff;margin-bottom:4px\">Real Estate Developers</div><div style=\"font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6\">Underwrite new projects with full development cost, financing, and returns modeling.</div></div></div><div style=\"display:flex;gap:12px;margin-bottom:20px\"><span style=\"font-size:22px;flex-shrink:0;margin-top:2px\">📊</span><div><div style=\"font-size:14px;font-weight:700;color:#fff;margin-bottom:4px\">Financial Analysts</div><div style=\"font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6\">Build audit-ready models with traceable assumptions and structured outputs.</div></div></div><div style=\"display:flex;gap:12px;margin-bottom:20px\"><span style=\"font-size:22px;flex-shrink:0;margin-top:2px\">💼</span><div><div style=\"font-size:14px;font-weight:700;color:#fff;margin-bottom:4px\">Investment Managers</div><div style=\"font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6\">Analyze deals faster with pre-built frameworks for IRR, NPV, and equity structuring.</div></div></div><div style=\"display:flex;gap:12px;margin-bottom:20px\"><span style=\"font-size:22px;flex-shrink:0;margin-top:2px\">🏢</span><div><div style=\"font-size:14px;font-weight:700;color:#fff;margin-bottom:4px\">Advisory Firms</div><div style=\"font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6\">White-label the platform for your clients with custom branding and workflows.</div></div></div></div>"}]}',
 '{"bgColor":"#0D2E5A","textColor":"#ffffff","paddingY":"80px","maxWidth":"900px"}');

-- ── 3. Platform Modules (6 REFM modules) ────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('about', 'cards', 3, true,
 '{"heading":"The 6-Module Platform","badge":"","cards":[{"icon":"🏗️","title":"01 — Project Setup & Financing","description":"Timeline, land & area, development costs, debt/equity structure, and interest schedules."},{"icon":"💰","title":"02 — Revenue Analysis","description":"Unit-level sales, rental pricing, phased delivery, and revenue recognition."},{"icon":"📉","title":"03 — Operating Expenses","description":"Property management, maintenance, staff costs, and overheads."},{"icon":"📈","title":"04 — Returns & Valuation","description":"IRR, NPV, equity multiple, cap rate, and multi-scenario comparison."},{"icon":"📑","title":"05 — Financial Statements","description":"Auto-generated P&L, Balance Sheet, and Cash Flow Statement."},{"icon":"📊","title":"06 — Reports & Export","description":"Investor PDF reports and formula-linked Excel workbooks."}]}',
 '{"bgColor":"#091E3A","paddingY":"80px","maxWidth":"1000px"}');

-- ── 4. Founder ──────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('about', 'team', 4, true,
 '{"heading":"Built by a Practitioner","members":[{"name":"Ahmad Din","role":"Founder & CEO","bio":"A corporate finance and transaction advisory professional with 12+ years of experience structuring deals across KSA, Pakistan, and international markets. Every feature is designed around how deals actually get done."}]}',
 '{"bgColor":"#0D2E5A","textColor":"#ffffff","paddingY":"80px","maxWidth":"700px"}');

-- ── 5. Our Platforms (dynamic — rendered by custom component, this is a placeholder marker)
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('about', 'cards', 5, true,
 '{"heading":"10+ Professional Modeling Platforms","badge":"Our Platforms","_dynamic":"modules","cards":[]}',
 '{"bgColor":"#0A2248","textColor":"#ffffff","paddingY":"80px","maxWidth":"1100px"}');

-- ── 6. CTA ──────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('about', 'cta', 6, true,
 '{"heading":"Start Modeling for Free","subtitle":"No credit card required. Full Module 1 access on the free plan.","buttonText":"Launch Platform Free →","buttonUrl":"/login"}',
 '{"bgColor":"#1B4F8A","textColor":"#ffffff","paddingY":"64px"}');
