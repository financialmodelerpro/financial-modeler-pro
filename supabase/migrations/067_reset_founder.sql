-- ============================================================
-- 067: Reset and reseed founder (team) section for home page
-- Deletes all existing team sections, re-inserts clean row
-- with correct field names matching page.tsx code exactly
-- ============================================================

-- Step 1: Delete ALL team sections for home page
DELETE FROM page_sections
WHERE page_slug = 'home'
  AND section_type = 'team';

-- Step 2: Re-insert clean founder section with verbatim content
INSERT INTO page_sections (
  page_slug, section_type, display_order,
  visible, content, styles
) VALUES (
  'home',
  'team',
  7,
  true,
  $json${
    "badge": "The Founder",
    "name": "Ahmad Din",
    "title": "Corporate Finance & Transaction Advisory Specialist | Financial Modeling Expert",
    "qualifications": "ACCA | FMVA | 12+ Years Experience",
    "bio": "Corporate Finance and Transaction Advisory specialist with deep expertise in financial modeling across real estate, business valuation, and corporate finance.",
    "credentials": [
      "12+ years in Corporate Finance & Advisory",
      "Experience across KSA & Pakistan",
      "Lender-grade models: IRR, DSCR, Feasibility",
      "Real estate, energy, infrastructure & industrial sectors",
      "Transaction advisory & investment support"
    ],
    "photo_url": "",
    "photo_fit": "contain",
    "photo_radius": "12px",
    "linkedin_url": "",
    "cta_primary_text": "Read Full Profile \u2192",
    "cta_primary_url": "/about/ahmad-din",
    "cta_secondary_text": "Connect on LinkedIn \u2192",
    "cta_secondary_url": "",
    "booking_text": "Book a Meeting",
    "booking_url": "",
    "show_read_more": true,
    "read_more_label": "Read Full Profile \u2192",
    "long_bio": "Ahmad Din has spent over 15 years at the intersection of real estate development and structured finance.\n\nHis career spans corporate finance advisory, transaction structuring, and institutional-grade financial modeling across the GCC and South Asian markets.\n\nAs founder of Financial Modeler Pro and PaceMakers Business Consultants, he has built and delivered financial models used in real investment decisions \u2014 from feasibility studies and IRR analyses to lender-grade DSCR models for developments valued at hundreds of millions.\n\nHis approach to financial modeling is rooted in practical deal experience: every model he builds or teaches is designed to withstand investor scrutiny, support board-level decisions, and communicate assumptions transparently.\n\nBefore launching FMP, Ahmad held senior advisory roles where he structured transactions across real estate, energy, infrastructure, and industrial sectors in Saudi Arabia and Pakistan.",
    "philosophy": "A good financial model is not just a calculation \u2014 it\u2019s a communication tool. Every assumption should be visible, every output should be traceable, and the final product should be something you\u2019d be proud to present to a board or an investor committee without reformatting.",
    "experience": [
      "15+ years in corporate finance, transaction advisory, and financial modeling",
      "Structured deals across real estate, energy, infrastructure, and industrial sectors",
      "Built lender-grade models: IRR analysis, DSCR models, feasibility studies",
      "Advisory experience spanning KSA and Pakistan markets",
      "Founded Financial Modeler Pro and PaceMakers Business Consultants"
    ],
    "projects": [],
    "booking_expectations": [
      "60-minute consultation",
      "Financial modeling advice",
      "Platform walkthrough",
      "Corporate finance guidance"
    ]
  }$json$::jsonb,
  '{"bgColor": "#1B3A6B"}'::jsonb
);
