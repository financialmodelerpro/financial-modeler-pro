-- ============================================================
-- 061: Add background paragraphs, projects, booking expectations
-- ============================================================

UPDATE page_sections
SET content = content || '{
  "background_paragraphs": [
    "Ahmad Din has spent over 15 years at the intersection of real estate development and structured finance. His career spans deal origination, feasibility analysis, development financing, and investor relations across the GCC, Southeast Asia, and international markets.",
    "Before founding Financial Modeler Pro, Ahmad worked with major real estate developers and advisory firms, building financial models for projects ranging from luxury residential towers to large-scale mixed-use developments. He noticed that the same spreadsheet problems — inconsistent assumptions, untraceable errors, and hours spent reformatting for investor presentations — kept appearing on every engagement.",
    "Financial Modeler Pro was built to solve that problem once and for all: a structured, professional-grade platform that produces audit-ready models and investor-ready outputs without the spreadsheet overhead."
  ],
  "projects": [],
  "booking_expectations": [
    "60-minute consultation",
    "Financial modeling advice",
    "Platform walkthrough",
    "Corporate finance guidance"
  ]
}'::jsonb
WHERE page_slug = 'home'
AND section_type = 'team'
AND display_order = 7;
