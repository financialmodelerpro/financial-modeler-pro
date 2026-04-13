-- ============================================================
-- 049: Migrate / (home/portal) page to CMS-driven rendering
-- Replaces hardcoded JSX with page_sections rows
-- ============================================================

DELETE FROM page_sections WHERE page_slug = 'home';

-- ── 1. Hero ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'hero', 1, true,
 '{"badge":"Now Live — Free to Use","headline":"Build Institutional-Grade Financial Models — Without Starting From Scratch","subtitle":"Pre-built, structured financial models for real estate, valuation, and project finance — designed by corporate finance professionals for real-world use.","powerStatement":"No more rebuilding models. No more broken Excel files. No more wasted hours.","trustLine":"Designed by Investment & Corporate Finance Experts  |  12+ Years Experience  |  Used Across KSA & Pakistan","tags":"Real Estate Models, Business Valuation, Project Finance, Fund Models","buttons":[{"label":"Launch Platform Free →","url":"/login","style":"primary"},{"label":"Explore Platforms","url":"/modeling","style":"outline"}]}',
 '{"bgColor":"linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)","textColor":"#ffffff","paddingY":"max(130px,10vw) 40px 110px"}');

-- ── 2. NEW — Our Mission ────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'text', 2, true,
 '{"heading":"Our Mission","body":"To make professional financial modeling accessible to every finance professional worldwide. We believe structured, real-world modeling skills should not be locked behind expensive courses or years of trial and error."}',
 '{"bgColor":"#ffffff","textColor":"#374151","paddingY":"64px"}');

-- ── 3. NEW — Our Vision ─────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'text', 3, true,
 '{"heading":"Our Vision","body":"To become the world''s leading financial modeling platform — where analysts, bankers, and finance teams come to build, learn, and grow their modeling capabilities across every discipline."}',
 '{"bgColor":"#F5F6FA","textColor":"#374151","paddingY":"64px"}');

-- ── 4. Stats Bar ────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'stats', 4, true,
 '{"items":[{"value":"12+","label":"Years of Experience"},{"value":"10+","label":"Modeling Platforms"},{"value":"20+","label":"Currencies Supported"},{"value":"100%","label":"Free Training — No Paywall"}]}',
 '{"bgColor":"#0A2248","textColor":"#ffffff","paddingY":"32px"}');

-- ── 5. What is FMP ──────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'text_image', 5, true,
 '{"badge":"The Platform","heading":"What is Financial Modeler Pro?","body":"Financial Modeler Pro is a professional hub for financial modeling across all disciplines — built for analysts, developers, and investors. It replaces complex spreadsheets with a structured, guided workflow that produces audit-ready models in a fraction of the time.\n\nEvery assumption is traceable. Every output is formatted for investor presentation. And every model can be exported to a formula-linked Excel workbook or a clean investor PDF — ready to share on day one.","features":["Multi-discipline modeling — real estate, valuation, FP&A, LBO, and more","Structured workflows — from assumptions to investor-ready outputs","Monthly or annual modeling with full period control","Formula-linked Excel export + investor PDF reports","White-label ready for advisory firms and consultants","100% free training on every financial modeling topic"]}',
 '{"bgColor":"#ffffff","paddingY":"88px"}');

-- ── 6. Two Pillars ──────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'columns', 6, true,
 '{"heading":"Two Platforms. One Destination.","subtitle":"Modeling + Training — everything a financial professional needs in one place.","count":2,"columns":[{"heading":"Modeling Platform","html":"<p style=\"font-size:14px;color:#4B5563;line-height:1.7;margin-bottom:24px\">Structured workflows that take you from project setup to investor-ready reports. All outputs link — change one assumption, everything updates.</p>","buttonText":"Explore Modeling Hub →","buttonUrl":"/modeling"},{"heading":"Training Hub","html":"<p style=\"font-size:14px;color:#4B5563;line-height:1.7;margin-bottom:24px\">Free video courses taught by finance professionals. Learn the methodology behind the model — from first principles to advanced deal structuring.</p>","buttonText":"Browse Free Courses →","buttonUrl":"/training"}]}',
 '{"bgColor":"#F5F7FA","paddingY":"88px"}');

-- ── 7. Founder (dynamic) ────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'team', 7, true,
 '{"_dynamic":"founder","heading":"The Founder","members":[]}',
 '{"bgColor":"#1B3A6B","textColor":"#ffffff","paddingY":"64px 40px 80px"}');

-- ── 8. PaceMakers section ───────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'columns', 8, true,
 '{"heading":"Powered by PaceMakers Business Consultants","badge":"The Firm Behind the Platform","count":2,"columns":[{"heading":"","html":"<p style=\"font-size:15px;color:rgba(255,255,255,0.6);line-height:1.75;margin-bottom:32px\">Financial Modeler Pro is a product of PaceMakers — a corporate finance advisory firm with 12+ years of experience delivering institutional-grade financial solutions across KSA and Pakistan.</p><a href=\"https://www.pacemakersglobal.com\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"display:inline-flex;align-items:center;gap:8px;background:#1B4F8A;color:#fff;font-weight:700;font-size:13px;padding:10px 24px;border-radius:7px;text-decoration:none\">Visit PaceMakers →</a>"},{"heading":"","html":"<div style=\"display:flex;flex-direction:column;gap:16px\"><div style=\"display:flex;align-items:center;gap:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px 20px\"><span style=\"color:#4A90D9;font-weight:700;font-size:11px\">✓</span><span style=\"font-size:14px;font-weight:600;color:rgba(255,255,255,0.85)\">Financial Modeling & Valuation</span></div><div style=\"display:flex;align-items:center;gap:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px 20px\"><span style=\"color:#4A90D9;font-weight:700;font-size:11px\">✓</span><span style=\"font-size:14px;font-weight:600;color:rgba(255,255,255,0.85)\">Transaction Advisory & Due Diligence</span></div><div style=\"display:flex;align-items:center;gap:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px 20px\"><span style=\"color:#4A90D9;font-weight:700;font-size:11px\">✓</span><span style=\"font-size:14px;font-weight:600;color:rgba(255,255,255,0.85)\">Fractional CFO Services</span></div><div style=\"display:flex;align-items:center;gap:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px 20px\"><span style=\"color:#4A90D9;font-weight:700;font-size:11px\">✓</span><span style=\"font-size:14px;font-weight:600;color:rgba(255,255,255,0.85)\">Investment Analysis & Feasibility</span></div></div>"}]}',
 '{"bgColor":"#0A2248","textColor":"#ffffff","paddingY":"88px"}');

-- ── 9. Articles (dynamic) ───────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'cards', 9, true,
 '{"_dynamic":"articles","badge":"Insights","heading":"Latest Articles","cards":[]}',
 '{"bgColor":"#ffffff","paddingY":"88px"}');

-- ── 10. Testimonials (dynamic) ──────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'cards', 10, true,
 '{"_dynamic":"testimonials","heading":"What Professionals Say","subtitle":"We are collecting feedback from early users of Financial Modeler Pro.","cards":[]}',
 '{"bgColor":"#ffffff","paddingY":"88px"}');

-- ── 11. Pricing preview (dynamic) ───────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'cards', 11, true,
 '{"_dynamic":"pricing_preview","badge":"Pricing","heading":"Simple, Transparent Pricing","subtitle":"Join the beta — currently free for all users.","cards":[]}',
 '{"bgColor":"#F5F7FA","paddingY":"88px"}');

-- ── 12. CTA ─────────────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('home', 'cta', 12, true,
 '{"heading":"Ready to build your first model?","subtitle":"Join finance professionals using Financial Modeler Pro to build better models, faster.","buttonText":"Get Started Free →","buttonUrl":"/login"}',
 '{"bgColor":"#1B4F8A","textColor":"#ffffff","paddingY":"80px"}');
