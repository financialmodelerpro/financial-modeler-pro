-- ============================================================================
-- Phase P-Sync Extension: marketing fields on the legacy `modules` table
-- ============================================================================
-- The Modeling Dashboard at /modeling/dashboard previously read platform
-- catalog data (color, tagline, longDescription, etc.) from the static config
-- src/hubs/modeling/config/platforms.ts. This migration moves all of that
-- marketing content into the `modules` table so admins can add, edit, and
-- delete platforms via /admin/platform-modules and have changes reflect on
-- the live dashboard.
--
-- The static config remains as the seed source (one-time UPDATE per platform
-- below), but is no longer read at runtime by the dashboard.
--
-- Also adds a delete_platform_cascade(uuid) function that removes a platform
-- plus its sub-modules (platform_modules) and all per-module page sections
-- (platform_module_pages) in a single transactional call.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- ============================================================================

-- ── 1. Extend modules with marketing columns ──────────────────────────────
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS short_name        text;
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS color             text;
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS bg_color          text;
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS tagline           text;
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS long_description  text;
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS who_is_it_for     text[] DEFAULT '{}';
ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS what_you_get      text[] DEFAULT '{}';

-- ── 2. Seed all 10 existing platforms from src/hubs/modeling/config/platforms.ts ──
-- One UPDATE per platform. Existing name / description / icon / status are
-- left untouched (already populated). Slug is the lookup key.

UPDATE public.modules SET
    short_name = 'REFM',
    color = '#1B4F8A',
    bg_color = '#E8F0FB',
    tagline = 'Institutional-grade real estate development feasibility, from land to exit.',
    long_description = 'The Real Estate Financial Modeling platform (REFM) is a structured, guided tool that takes you through every stage of a development feasibility, from project setup and land acquisition through to revenue projections, operating costs, financing structures, and final investor returns. Built for multi-asset development projects including residential, hospitality, and retail, the platform produces institutional-grade outputs ready for investor presentation, lender submission, or internal board review. Every assumption is clearly flagged, every calculation is traceable, and every output is formatted for professional presentation.',
    who_is_it_for = ARRAY[
        'Real Estate Developers & Project Sponsors',
        'Investment Managers & Portfolio Managers',
        'Real Estate Analysts & Associates',
        'Lenders & Credit Analysts',
        'Family Offices with Real Estate Exposure',
        'Advisory Firms Supporting RE Transactions'
    ],
    what_you_get = ARRAY[
        'Multi-asset project structure (residential, hospitality, retail) with configurable unit mix',
        'Full development cost schedule with hard costs, soft costs, land, and contingencies',
        'Debt and equity financing schedules with interest capitalization and cash sweep mechanics',
        'Revenue projections by asset class, unit sales, room revenue, lease income',
        'Operating expense modelling by asset with benchmark comparisons',
        'IRR and NPV calculations, project returns, equity returns, and scenario analysis',
        'Full financial statements, income statement, balance sheet, and cash flow',
        'One-click export to formula-linked Excel workbook and investor-ready PDF report'
    ]
WHERE slug = 'real-estate';

UPDATE public.modules SET
    short_name = 'BVM',
    color = '#7C3AED',
    bg_color = '#F5F3FF',
    tagline = 'Rigorous, multi-method business valuation for M&A, PE, and corporate transactions.',
    long_description = 'The Business Valuation Modeling platform provides deal professionals with a comprehensive, multi-method valuation framework. From three-statement DCF models to comparable company trading multiples and precedent transaction analysis, the platform guides analysts through the full valuation process and produces a professional football field output ready for board and investor presentation. Built to the standards expected in M&A advisory and private equity due diligence.',
    who_is_it_for = ARRAY[
        'Investment Bankers & M&A Advisors',
        'Private Equity Analysts',
        'Corporate Finance Teams',
        'CFOs & Finance Directors',
        'Business Owners Seeking Exit Valuations'
    ],
    what_you_get = ARRAY[
        'Three-statement DCF model with explicit forecast period and terminal value',
        'Comparable company analysis with trading multiples and implied valuation range',
        'Precedent transaction analysis with deal premium and synergy adjustments',
        'Sum-of-parts valuation for conglomerate and multi-segment businesses',
        'LBO quick-check model to assess private equity return potential',
        'Football field valuation bridge chart across all methods'
    ]
WHERE slug = 'business-valuation';

UPDATE public.modules SET
    short_name = 'FP&A',
    color = '#0891B2',
    bg_color = '#E0F9FF',
    tagline = 'Annual budgets, rolling forecasts, and variance reporting, built for corporate finance teams.',
    long_description = 'The FP&A Modeling Platform is designed for corporate finance teams who need to move beyond spreadsheet-based budgeting and forecasting. The platform guides users through a structured annual budget process, monthly rolling forecasts, and real-time budget-versus-actual variance analysis. Departmental P&L views and integrated KPI dashboards give finance business partners the tools they need to support operational decision-making at speed.',
    who_is_it_for = ARRAY[
        'FP&A Managers & Directors',
        'CFOs & Finance Directors',
        'Budget Analysts',
        'Department Heads',
        'Finance Business Partners'
    ],
    what_you_get = ARRAY[
        'Annual budget model with driver-based revenue and cost build-up',
        'Rolling 12-month forecast with monthly reforecast capability',
        'Budget vs actual variance reporting with root cause drill-down',
        'Departmental P&L views with headcount and opex by cost centre',
        'KPI dashboards with traffic-light RAG status and trend charts'
    ]
WHERE slug = 'fpa-modeling';

UPDATE public.modules SET
    short_name = 'ERM',
    color = '#059669',
    bg_color = '#ECFDF5',
    tagline = 'Buy-side and sell-side equity models built to institutional research standards.',
    long_description = 'The Equity Research Modeling platform provides a structured framework for building institutional-quality equity research models. Designed to the standards expected by buy-side and sell-side analysts, the platform guides users through company financial modelling, multi-method valuation, and the production of a professional research note output. Whether you are initiating coverage or updating a model, the platform ensures consistency, traceability, and speed.',
    who_is_it_for = ARRAY[
        'Equity Research Analysts',
        'Portfolio Managers',
        'Buy-side Analysts',
        'Hedge Fund Analysts',
        'Investment Advisors'
    ],
    what_you_get = ARRAY[
        'Three-statement financial model with driver-based forecast build-up',
        'DCF valuation with WACC derivation and terminal value sensitivity',
        'Comparable company trading multiples and peer benchmarking',
        'Sum-of-parts valuation for diversified businesses',
        'Price target derivation and analyst recommendation output'
    ]
WHERE slug = 'equity-research';

UPDATE public.modules SET
    short_name = 'PFM',
    color = '#B45309',
    bg_color = '#FEF9C3',
    tagline = 'Infrastructure and project finance models built for DFIs, lenders, and developers.',
    long_description = 'The Project Finance Modeling platform is purpose-built for infrastructure and energy projects where lenders and equity sponsors require detailed cash flow modelling, DSCR analysis, and debt sculpting. The platform guides users through full project lifecycle modelling, from construction phase financing through operations-phase cash flow waterfall and debt repayment, producing outputs that meet the requirements of development finance institutions, commercial lenders, and infrastructure equity investors.',
    who_is_it_for = ARRAY[
        'Infrastructure Developers',
        'Project Finance Bankers',
        'DFI Analysts',
        'EPC Contractors',
        'Government Advisory Teams'
    ],
    what_you_get = ARRAY[
        'Construction phase cash flow with drawdown schedules and interest during construction',
        'Operations phase revenue model with capacity factors and escalation',
        'Debt service coverage ratio (DSCR) analysis and covenant testing',
        'Sculpted debt repayment tied to available cash flow',
        'Cash flow waterfall with senior debt, mezzanine, and equity distributions',
        'Lender base case, downside case, and covenant headroom analysis'
    ]
WHERE slug = 'project-finance';

UPDATE public.modules SET
    short_name = 'LBO',
    color = '#DC2626',
    bg_color = '#FEF2F2',
    tagline = 'Private equity LBO models with full debt waterfall, returns analysis, and exit scenarios.',
    long_description = 'The LBO Modeling Platform is built for private equity professionals who need to move quickly from deal screening to full model. The platform guides users through a complete leveraged buyout analysis, sources and uses of funds, leveraged capital structure, integrated operating model, debt repayment waterfall, and multi-scenario exit analysis. Returns outputs include IRR, MOIC, and cash yield at each level of the capital structure.',
    who_is_it_for = ARRAY[
        'Private Equity Investors',
        'Leveraged Finance Bankers',
        'M&A Advisors',
        'Corporate Development Teams',
        'Family Offices'
    ],
    what_you_get = ARRAY[
        'Sources and uses of funds with detailed fee and transaction cost modelling',
        'Leveraged capital structure with senior, mezzanine, and equity tranches',
        'Integrated operating model with revenue, EBITDA, and working capital',
        'Debt repayment waterfall with cash sweep and PIK toggle mechanics',
        'Multi-scenario exit analysis, base, upside, and downside cases',
        'Returns summary: IRR, MOIC, and cash-on-cash at sponsor equity level'
    ]
WHERE slug = 'lbo-modeling';

UPDATE public.modules SET
    short_name = 'CFM',
    color = '#1B4F8A',
    bg_color = '#E8F0FB',
    tagline = 'Strategic corporate finance models for M&A, capital allocation, and growth planning.',
    long_description = 'The Corporate Finance Modeling platform supports corporate development teams and M&A advisors in building the analytical foundation for strategic transactions. From merger combination models and accretion/dilution analysis to capital structure optimization and strategic scenario planning, the platform covers the full range of corporate finance analytical requirements, all in a structured, guided workflow that produces board-ready outputs.',
    who_is_it_for = ARRAY[
        'Corporate Development Teams',
        'M&A Advisors',
        'Investment Bankers',
        'CFOs & Strategy Directors'
    ],
    what_you_get = ARRAY[
        'Merger combination model with pro-forma income statement and balance sheet',
        'Accretion/dilution analysis with EPS sensitivity and break-even metrics',
        'Capital structure optimization model with WACC and leverage analysis',
        'Dividend policy and shareholder returns model',
        'Strategic scenario planning with Monte Carlo sensitivity outputs'
    ]
WHERE slug = 'corporate-finance';

UPDATE public.modules SET
    short_name = 'EUM',
    color = '#D97706',
    bg_color = '#FFFBEB',
    tagline = 'Financial models for renewable energy, power generation, and utility assets.',
    long_description = 'The Energy & Utilities Modeling platform is purpose-built for the financial analysis of power generation and energy infrastructure assets. The platform covers the full range of energy finance requirements, from renewable project IRR analysis and PPA pricing to utility company valuation and regulated asset base modelling. Built by practitioners with direct energy sector experience, the platform produces outputs that meet the standards of energy lenders, developers, and infrastructure investors.',
    who_is_it_for = ARRAY[
        'Energy Sector Analysts',
        'Renewable Energy Developers',
        'Utility Finance Teams',
        'Infrastructure Investors'
    ],
    what_you_get = ARRAY[
        'Renewable energy project model, solar, wind, hydro with capacity factor and degradation',
        'Power purchase agreement (PPA) pricing and revenue certainty analysis',
        'Utility company valuation, regulated asset base and allowed return modelling',
        'Grid connection and capital expenditure schedule',
        'Energy storage economics, battery dispatch and revenue stacking',
        'Carbon credit and green certificate revenue modelling'
    ]
WHERE slug = 'energy-utilities';

UPDATE public.modules SET
    short_name = 'SVM',
    color = '#7C3AED',
    bg_color = '#F5F3FF',
    tagline = 'Fundraising-ready financial models for startups, founders, and early-stage investors.',
    long_description = 'The Startup & Venture Modeling platform gives founders and early-stage investors the tools to build credible, fundraising-ready financial models quickly. The platform covers the specific analytical frameworks that matter for high-growth businesses, cohort-based customer revenue, unit economics and LTV/CAC analysis, cash runway and burn rate modelling, cap table mechanics, and VC return scenario analysis. Every output is formatted for investor presentation and due diligence.',
    who_is_it_for = ARRAY[
        'Startup Founders & CFOs',
        'Venture Capital Analysts',
        'Angel Investors',
        'Accelerator Teams',
        'Early-Stage Investors'
    ],
    what_you_get = ARRAY[
        'Cohort-based revenue model with monthly/annual customer acquisition and churn',
        'Unit economics, LTV, CAC, payback period, and contribution margin by cohort',
        'Cash runway and burn rate analysis with hiring plan integration',
        'Cap table model, founder dilution, option pool, and VC ownership rounds',
        'VC return scenario analysis, IRR, MOIC, and liquidation preference waterfall'
    ]
WHERE slug = 'startup-venture';

UPDATE public.modules SET
    short_name = 'BCM',
    color = '#374151',
    bg_color = '#F9FAFB',
    tagline = 'Credit analysis and banking sector financial models for lenders and risk teams.',
    long_description = 'The Banking & Credit Modeling platform is built for credit professionals who need structured, consistent frameworks for loan analysis and credit risk assessment. The platform covers individual loan origination analysis through to portfolio-level credit risk modelling and bank valuation. Credit analysts, loan officers, and risk managers can use the platform to produce consistent, auditable credit assessments that meet internal committee and regulatory standards.',
    who_is_it_for = ARRAY[
        'Credit Analysts',
        'Loan Officers',
        'Risk Managers',
        'Banking Analysts',
        'NPL Resolution Teams'
    ],
    what_you_get = ARRAY[
        'Loan origination model, debt sizing, DSCR, LTV, and debt yield analysis',
        'Borrower credit scoring model with qualitative and quantitative factors',
        'NPL resolution model, recovery scenarios, haircuts, and time-value adjusted returns',
        'Bank financial model, NIM, provision for credit losses, and capital ratios',
        'Stress testing, interest rate shock, credit loss scenario, and capital adequacy'
    ]
WHERE slug = 'banking-credit';

-- ── 3. Cascade-delete function ────────────────────────────────────────────
-- Removes a platform plus all its sub-modules and per-module page sections.
-- Wrapped in a single transaction so a failure midway leaves no orphans.
CREATE OR REPLACE FUNCTION public.delete_platform_cascade(p_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_slug text;
BEGIN
    SELECT slug INTO v_slug FROM public.modules WHERE id = p_id;
    IF v_slug IS NULL THEN
        RAISE EXCEPTION 'Platform not found: %', p_id;
    END IF;

    -- Delete page sections for sub-modules belonging to this platform.
    DELETE FROM public.platform_module_pages
    WHERE module_id IN (
        SELECT id FROM public.platform_modules WHERE platform_slug = v_slug
    );

    -- Delete sub-modules.
    DELETE FROM public.platform_modules WHERE platform_slug = v_slug;

    -- Delete the platform row itself.
    DELETE FROM public.modules WHERE id = p_id;
END;
$$;

-- ============================================================================
-- Change summary:
--   - Added 7 columns to modules: short_name, color, bg_color, tagline,
--     long_description, who_is_it_for (text[]), what_you_get (text[]).
--   - Seeded marketing content for all 10 platforms from the static config.
--   - Added function delete_platform_cascade(uuid) with transactional cascade
--     across platform_module_pages, platform_modules, and modules.
--
-- Rollback (manual):
--   DROP FUNCTION IF EXISTS public.delete_platform_cascade(uuid);
--   ALTER TABLE public.modules DROP COLUMN IF EXISTS what_you_get;
--   ALTER TABLE public.modules DROP COLUMN IF EXISTS who_is_it_for;
--   ALTER TABLE public.modules DROP COLUMN IF EXISTS long_description;
--   ALTER TABLE public.modules DROP COLUMN IF EXISTS tagline;
--   ALTER TABLE public.modules DROP COLUMN IF EXISTS bg_color;
--   ALTER TABLE public.modules DROP COLUMN IF EXISTS color;
--   ALTER TABLE public.modules DROP COLUMN IF EXISTS short_name;
-- ============================================================================
