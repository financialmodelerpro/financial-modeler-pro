-- Migration 094: Update founder profile content

UPDATE page_sections
SET content = content || '{
  "bio": "Founder of Financial Modeler Pro. 12+ years in corporate finance and transaction advisory across KSA and Pakistan. ACCA Member (UK) and FMVA® certified. Building the tools and training he wished existed when he started.",
  "qualifications": "ACCA | FMVA | 12+ Years Experience",
  "credentials": [
    "12+ years in Corporate Finance & Advisory",
    "Experience across KSA, GCC & Pakistan",
    "Lender-grade models: IRR, DSCR, Debt Sizing, Debt Sculpting",
    "Real estate, energy, infrastructure & industrial sectors",
    "Transaction advisory & investment support",
    "Mergers & Acquisitions Advisory",
    "FP&A Operating Models & Automated Reporting",
    "Tariff Calculation & Project Finance Structuring",
    "Financial Due Diligence & Business Valuation",
    "Feasibility Studies, Business Plans & Investor Pitch Decks"
  ],
  "philosophy": "A good financial model is not just a calculation — it'\''s a communication tool. Every assumption should be visible, every output should be traceable, and the final product should be something you'\''d be proud to present to a board or an investor committee without reformatting.",
  "long_bio": "Ahmad Din is a Corporate Finance and Transaction Advisory Specialist with over 12 years of experience advising sponsors, investment groups, and operating companies across Saudi Arabia, the GCC, and Pakistan.\n\nAs Senior Manager of Corporate Finance at Synergistic Financial Advisors, Ahmad serves as lead financial advisor to Dallah Investment (KSA), one of the Kingdom'\''s prominent investment groups. He has led the financial structuring, modeling, and evaluation of multi-billion riyal mixed-use real estate developments across the Dallah portfolio — projects spanning residential towers, commercial districts, hospitality components, and retail destinations. His work integrates phased development planning, installment-based revenue structures, construction cash flow management, debt waterfalls, IRR optimization, and DSCR-compliant lender modeling to support capital raising, joint venture structuring, and disciplined capital deployment across Dallah'\''s multi-asset real estate portfolio.\n\nHis renewable energy and infrastructure work includes building comprehensive FP&A operating models for ACWA Power'\''s Central Asia region projects (solar and wind), automating monthly reporting cycles including forecast-year financials, construction cash flows, budget vs. actual variance analysis, IRR tracking, DSCR monitoring, and CFADS calculations. He brings deep expertise in tariff calculation, debt sizing, and debt sculpting for project finance structures across energy and infrastructure sectors.\n\nAhmad has also developed PPP bid frameworks for electric bus fleet projects submitted to the Government of Punjab and Government of Sindh, incorporating Capex structuring, tariff modeling, subsidy analysis, and lifecycle cost economics. In KSA, he independently structured the financial model and feasibility framework for a greenfield biofuel plant, securing project financing from Wa'\''ed, the entrepreneurship arm of Saudi Aramco.\n\nBeyond real estate, energy, and infrastructure, Ahmad has delivered financial due diligence engagements, business valuations (DCF, trading comparables, transaction multiples), and full investment documentation — including feasibility studies, business plans, investment memorandums, and investor pitch decks — across hospitality, healthcare, education, fintech, and industrial sectors to support fundraising, M&A, and exit strategies.\n\nHe has trained and mentored over 20 professionals in financial modeling and valuation throughout his career, strengthening advisory capabilities across client mandates.\n\nIn 2017, Ahmad established PaceMakers Business Consultants as a sole proprietorship, which he grew and restructured as a Limited Liability Partnership (LLP) in 2023, registered under SECP Section 7 of the LLP Act, 2017. Financial Modeler Pro is the flagship platform of PaceMakers Business Consultants LLP.",
  "why_fmp": "Ahmad built Financial Modeler Pro because he lived the problems it solves.\n\nAfter years of testing existing financial modeling platforms, he found a consistent gap — tools were either too rigid, too slow, or disconnected from how real transactions work. Building a comprehensive financial model, preparing a pitch deck, business plan, and investment memorandum for a single deal could take months, with significant room for error at every step. There had to be a better way.\n\nThe Modeling Hub was born from that frustration — a platform where professionals can build institutional-grade financial models with the speed and accuracy that real deals demand.\n\nThe Training Hub came from a different but equally personal motivation. For over four years, Ahmad had been informally training his team in financial modeling and valuation. He saw firsthand how transformative proper financial modeling skills could be for a career — and how inaccessible quality training was for many, especially in Pakistan where international certifications are often unaffordable.\n\nFinancial Modeler Pro'\''s certification program is completely free. Always. Ahmad'\''s mission is simple: give back to the community that shaped his career by making professional financial modeling education accessible to everyone, regardless of where they are or what they can afford.",
  "expertise": [
    "Transaction Advisory & Financial Due Diligence",
    "Financial Modeling & Business Valuation (DCF, Comparables, Multiples)",
    "Real Estate & Mixed-Use Development Modeling",
    "Renewable Energy & Infrastructure PPP Modeling",
    "FP&A Operating Models & Automated Reporting",
    "Tariff Calculation, Debt Sizing & Debt Sculpting",
    "Mergers & Acquisitions Advisory",
    "Feasibility Analysis & Investment Appraisal",
    "Financial Planning & Analysis (FP&A)",
    "Investor Pitch Deck & Investment Memorandum Development"
  ],
  "industry_focus": [
    "Real Estate & Mixed-Use Development",
    "Renewable Energy (Solar, Wind, Biofuel)",
    "Construction & Infrastructure",
    "Public-Private Partnerships (PPP)",
    "Hospitality & Healthcare",
    "Mergers & Acquisitions"
  ],
  "market_focus": "Saudi Arabia & GCC — with deep experience across KSA-based projects, institutional investors, and regional energy infrastructure.",
  "personal": "Based in Lahore, Pakistan. When not building financial models or the platform, Ahmad enjoys long drives with family, quality time with friends, and exploring good food."
}'::jsonb,
updated_at = now()
WHERE page_slug = 'home' AND section_type = 'team';
