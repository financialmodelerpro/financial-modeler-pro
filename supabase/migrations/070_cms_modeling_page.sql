-- ============================================================
-- 070: Seed Modeling Hub marketing page into CMS page_sections
-- Option B: text is editable via Admin CMS; layout stays hardcoded
-- Dynamic sections use _dynamic markers for component rendering
-- ============================================================

-- Ensure cms_pages entry exists
INSERT INTO cms_pages (slug, title, status, is_system)
VALUES ('modeling', 'Modeling Hub', 'published', true)
ON CONFLICT (slug) DO UPDATE
SET title = 'Modeling Hub', status = 'published';

-- Clear any existing modeling sections
DELETE FROM page_sections WHERE page_slug = 'modeling';

-- ── Section 1: Hero ─────────────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'hero', 1, true,
 $json${
   "badge": "\ud83d\udcd0 Professional Modeling Platform",
   "headline": "Build Institutional-Grade\nFinancial Models",
   "subtitle": "Structured, guided workflows for every financial discipline \u2014 real estate, business valuation, LBO, FP&A, and more. Built by practitioners. Free to use.",
   "cta_primary_text": "Register Free \u2192",
   "cta_primary_url": "/register",
   "cta_secondary_text": "Login to Dashboard \u2192",
   "cta_secondary_url": "/signin"
 }$json$::jsonb,
 $json${
   "bgColor": "linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)",
   "textColor": "#ffffff",
   "badgeBg": "rgba(27,79,138,0.18)",
   "badgeBorder": "rgba(27,79,138,0.45)",
   "badgeColor": "#93C5FD",
   "ctaBg": "#1B4F8A",
   "ctaShadow": "0 4px 20px rgba(27,79,138,0.4)"
 }$json$::jsonb);

-- ── Section 2: What is Modeling Hub (audience cards) ────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'text_image', 2, true,
 $json${
   "badge": "The Platform",
   "heading": "What is the Modeling Hub?",
   "body": "A structured, guided platform that replaces complex manual spreadsheets with professional financial modeling workflows. Built for analysts, investors, and advisory firms who need institutional-grade outputs fast. Every assumption is traceable. Every output is formatted for investor presentation.",
   "audience": [
     {"icon": "\ud83d\udcb9", "role": "Financial Analysts", "desc": "Structured workflows replacing manual spreadsheet builds"},
     {"icon": "\ud83c\udfe2", "role": "Investment Professionals", "desc": "Due diligence and deal-ready financial models"},
     {"icon": "\ud83c\udfe0\ufe0f", "role": "Real Estate Developers", "desc": "Development feasibilities from land to exit"},
     {"icon": "\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67", "role": "Family Offices", "desc": "Multi-asset portfolio and investment modeling"},
     {"icon": "\ud83c\udfe6", "role": "Lenders & Banks", "desc": "Credit analysis, DSCR, project finance models"},
     {"icon": "\ud83c\udf93", "role": "Students & Aspiring Analysts", "desc": "Learn by doing with real professional frameworks"}
   ]
 }$json$::jsonb,
 '{"bgColor": "#ffffff"}'::jsonb);

-- ── Section 3: Platforms Grid (dynamic) ─────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cards', 3, true,
 $json${
   "_dynamic": "modules",
   "badge": "The Platforms",
   "heading": "10+ Professional Modeling Platforms",
   "description": "Live now and launching soon \u2014 one platform for every financial modeling discipline."
 }$json$::jsonb,
 '{"bgColor": "#F5F7FA"}'::jsonb);

-- ── Section 4: Why Modeling Hub ──────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cards', 4, true,
 $json${
   "heading": "Why Modeling Hub?",
   "benefits": [
     {"icon": "\u26a1", "title": "Instant Outputs", "desc": "From assumptions to investor-ready model in minutes, not days."},
     {"icon": "\ud83d\udd17", "title": "Fully Linked", "desc": "Change one input, everything updates automatically across the entire model."},
     {"icon": "\ud83d\udce4", "title": "Export Ready", "desc": "Formula-linked Excel workbook and investor PDF with one click."},
     {"icon": "\ud83c\udd93", "title": "Always Free", "desc": "No subscription, no paywall, full access from day one."}
   ]
 }$json$::jsonb,
 '{"bgColor": "#ffffff"}'::jsonb);

-- ── Section 5: Testimonials (dynamic) ───────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'testimonials', 5, true,
 $json${
   "_dynamic": "testimonials",
   "heading": "What Professionals Say",
   "subheading": "Feedback from finance professionals using the Modeling Hub."
 }$json$::jsonb,
 '{}'::jsonb);

-- ── Section 6: Submit Testimonial CTA ───────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cta', 6, true,
 $json${
   "badge": "Your Voice Matters",
   "heading": "Using the Modeling Hub? Share Your Experience",
   "description": "Your feedback helps other finance professionals and helps us build a better platform.",
   "cta_text": "\u2b50 Submit Your Testimonial",
   "cta_url": "/modeling/submit-testimonial"
 }$json$::jsonb,
 '{"bgColor": "#EEF2FF", "badgeColor": "#4F46E5", "headingColor": "#0D2E5A", "textColor": "#6B7280", "ctaBg": "#1B4F8A", "borderColor": "#C7D2FE"}'::jsonb);

-- ── Section 7: Bottom CTA ───────────────────────────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling', 'cta', 7, true,
 $json${
   "heading": "Ready to build your first model?",
   "description": "Join financial professionals around the world building institutional-grade models \u2014 completely free.",
   "cta_text": "Launch Platform Free \u2192",
   "cta_url": "/register"
 }$json$::jsonb,
 '{"bgColor": "#1B4F8A", "textColor": "#ffffff", "ctaBg": "#ffffff", "ctaColor": "#1B4F8A"}'::jsonb);
