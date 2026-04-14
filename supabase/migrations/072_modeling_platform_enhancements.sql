-- ============================================================
-- 072: Real Estate platform sub-page enhancements
-- Adds stats bar after hero, upgrades text → text_image,
-- adds image fields to list sections for future use
-- ============================================================

-- ── Step 1: Shift existing sections 2-6 down by 1 to make room for stats ──
UPDATE page_sections
SET display_order = display_order + 1
WHERE page_slug = 'modeling-real-estate'
  AND display_order >= 2;

-- ── Step 2: Insert stats bar at display_order 2 ─────────────────────────────
INSERT INTO page_sections (page_slug, section_type, display_order, visible, content, styles) VALUES
('modeling-real-estate', 'stats', 2, true,
 $json${
   "items": [
     {"id": "stat_1", "value": "6", "label": "Modules", "visible": true},
     {"id": "stat_2", "value": "10+", "label": "Asset Classes", "visible": true},
     {"id": "stat_3", "value": "100%", "label": "Free to Use", "visible": true},
     {"id": "stat_4", "value": "Excel + PDF", "label": "Export Formats", "visible": true}
   ]
 }$json$::jsonb,
 '{"bgColor": "#0A2248", "textColor": "#ffffff"}'::jsonb);

-- ── Step 3: Upgrade "What Covers" (now display_order 3) to text_image ──────
UPDATE page_sections
SET section_type = 'text_image',
    content = $json${
      "badge": "",
      "heading": "What This Platform Covers",
      "html": "",
      "body": "The Real Estate Financial Modeling platform (REFM) is a structured, guided tool that takes you through every stage of a development feasibility \u2014 from project setup and land acquisition through to revenue projections, operating costs, financing structures, and final investor returns. Built for multi-asset development projects including residential, hospitality, and retail, the platform produces institutional-grade outputs ready for investor presentation, lender submission, or internal board review. Every assumption is clearly flagged, every calculation is traceable, and every output is formatted for professional presentation.",
      "imageSrc": "",
      "imagePlaceholder": "Platform Screenshot",
      "imagePosition": "right",
      "imageHeight": "auto",
      "imageFit": "cover",
      "imageRadius": "12px"
    }$json$::jsonb
WHERE page_slug = 'modeling-real-estate'
  AND display_order = 3;

-- ── Step 4: Add image fields to Who Is It For (display_order 4) ────────────
UPDATE page_sections
SET content = content || '{"imageSrc": "", "imagePosition": "right"}'::jsonb
WHERE page_slug = 'modeling-real-estate'
  AND display_order = 4;

-- ── Step 5: Add image fields to What You Get (display_order 5) ─────────────
UPDATE page_sections
SET content = content || '{"imageSrc": "", "imagePosition": "right"}'::jsonb
WHERE page_slug = 'modeling-real-estate'
  AND display_order = 5;
