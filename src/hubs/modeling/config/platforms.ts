import type { Metadata } from 'next';

export type PlatformStatus = 'live' | 'coming_soon';
export type ModuleStatus = 'complete' | 'in_progress' | 'planned';

export interface PlatformModule {
  number: number;
  name: string;
  description: string;
  status: ModuleStatus;
  tabs: string[];
}

export interface Platform {
  slug: string;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  bgColor: string;
  status: PlatformStatus;
  tagline: string;
  description: string;
  longDescription: string;
  whoIsItFor: string[];
  whatYouGet: string[];
  modules: PlatformModule[];
}

// ── Platform Definitions ────────────────────────────────────────────────────

export const PLATFORMS: Platform[] = [
  {
    slug: 'real-estate',
    name: 'Real Estate Financial Modeling',
    shortName: 'REFM',
    icon: '🏗️',
    color: '#1B4F8A',
    bgColor: '#E8F0FB',
    status: 'live',
    tagline: 'Institutional-grade real estate development feasibility - from land to exit.',
    description: 'Full-cycle development feasibility platform covering multi-asset structures, debt/equity financing, revenue, operating costs, and investor returns.',
    longDescription: 'The Real Estate Financial Modeling platform (REFM) is a structured, guided tool that takes you through every stage of a development feasibility - from project setup and land acquisition through to revenue projections, operating costs, financing structures, and final investor returns. Built for multi-asset development projects including residential, hospitality, and retail, the platform produces institutional-grade outputs ready for investor presentation, lender submission, or internal board review. Every assumption is clearly flagged, every calculation is traceable, and every output is formatted for professional presentation.',
    whoIsItFor: [
      'Real Estate Developers & Project Sponsors',
      'Investment Managers & Portfolio Managers',
      'Real Estate Analysts & Associates',
      'Lenders & Credit Analysts',
      'Family Offices with Real Estate Exposure',
      'Advisory Firms Supporting RE Transactions',
    ],
    whatYouGet: [
      'Multi-asset project structure (residential, hospitality, retail) with configurable unit mix',
      'Full development cost schedule with hard costs, soft costs, land, and contingencies',
      'Debt and equity financing schedules with interest capitalization and cash sweep mechanics',
      'Revenue projections by asset class - unit sales, room revenue, lease income',
      'Operating expense modelling by asset with benchmark comparisons',
      'IRR and NPV calculations - project returns, equity returns, and scenario analysis',
      'Full financial statements - income statement, balance sheet, and cash flow',
      'One-click export to formula-linked Excel workbook and investor-ready PDF report',
    ],
    modules: [
      {
        number: 1,
        name: 'Project Setup & Financial Structure',
        description: 'Define the project timeline, land and area schedule, full development cost build-up, and the debt/equity financing structure including interest capitalization.',
        status: 'complete',
        tabs: ['Timeline', 'Land & Area', 'Development Costs', 'Financing'],
      },
      {
        number: 2,
        name: 'Revenue Analysis',
        description: 'Model revenue by asset class - residential unit sales and payment schedules, hospitality room revenue and occupancy, and retail leasing income.',
        status: 'in_progress',
        tabs: ['Residential Sales', 'Hospitality Revenue', 'Retail Leasing'],
      },
      {
        number: 3,
        name: 'Operating Expenses',
        description: 'Build the operating expense model by asset type, benchmark against market norms, and run sensitivity analysis on key OPEX drivers.',
        status: 'planned',
        tabs: ['OPEX by Asset', 'Benchmarks', 'Sensitivity'],
      },
      {
        number: 4,
        name: 'Returns & Valuation',
        description: 'Calculate project-level and equity-level returns including IRR, NPV, equity multiple, and payback period. Run scenarios and sensitivities.',
        status: 'planned',
        tabs: ['Project Returns', 'Equity Returns', 'Scenarios', 'Sensitivity'],
      },
      {
        number: 5,
        name: 'Financial Statements',
        description: 'Auto-generated income statement, balance sheet, and cash flow statement linked directly to all upstream module assumptions.',
        status: 'planned',
        tabs: ['Income Statement', 'Balance Sheet', 'Cash Flow', 'Working Capital'],
      },
      {
        number: 6,
        name: 'Reports & Visualizations',
        description: 'Interactive dashboard with charts and KPIs. Generate a fully formatted executive summary and export to Excel or PDF with one click.',
        status: 'planned',
        tabs: ['Dashboard', 'Charts', 'Executive Summary', 'Export'],
      },
    ],
  },

  {
    slug: 'business-valuation',
    name: 'Business Valuation Modeling',
    shortName: 'BVM',
    icon: '💼',
    color: '#7C3AED',
    bgColor: '#F5F3FF',
    status: 'coming_soon',
    tagline: 'Rigorous, multi-method business valuation for M&A, PE, and corporate transactions.',
    description: 'DCF, comparable company analysis, precedent transactions, and LBO screening - all in one structured platform built for deal professionals.',
    longDescription: 'The Business Valuation Modeling platform provides deal professionals with a comprehensive, multi-method valuation framework. From three-statement DCF models to comparable company trading multiples and precedent transaction analysis, the platform guides analysts through the full valuation process and produces a professional football field output ready for board and investor presentation. Built to the standards expected in M&A advisory and private equity due diligence.',
    whoIsItFor: [
      'Investment Bankers & M&A Advisors',
      'Private Equity Analysts',
      'Corporate Finance Teams',
      'CFOs & Finance Directors',
      'Business Owners Seeking Exit Valuations',
    ],
    whatYouGet: [
      'Three-statement DCF model with explicit forecast period and terminal value',
      'Comparable company analysis with trading multiples and implied valuation range',
      'Precedent transaction analysis with deal premium and synergy adjustments',
      'Sum-of-parts valuation for conglomerate and multi-segment businesses',
      'LBO quick-check model to assess private equity return potential',
      'Football field valuation bridge chart across all methods',
    ],
    modules: [],
  },

  {
    slug: 'fpa-modeling',
    name: 'FP&A Modeling Platform',
    shortName: 'FP&A',
    icon: '📊',
    color: '#0891B2',
    bgColor: '#E0F9FF',
    status: 'coming_soon',
    tagline: 'Annual budgets, rolling forecasts, and variance reporting - built for corporate finance teams.',
    description: 'Structured FP&A platform covering budget modeling, rolling forecasts, budget-vs-actual variance analysis, and departmental P&L reporting.',
    longDescription: 'The FP&A Modeling Platform is designed for corporate finance teams who need to move beyond spreadsheet-based budgeting and forecasting. The platform guides users through a structured annual budget process, monthly rolling forecasts, and real-time budget-versus-actual variance analysis. Departmental P&L views and integrated KPI dashboards give finance business partners the tools they need to support operational decision-making at speed.',
    whoIsItFor: [
      'FP&A Managers & Directors',
      'CFOs & Finance Directors',
      'Budget Analysts',
      'Department Heads',
      'Finance Business Partners',
    ],
    whatYouGet: [
      'Annual budget model with driver-based revenue and cost build-up',
      'Rolling 12-month forecast with monthly reforecast capability',
      'Budget vs actual variance reporting with root cause drill-down',
      'Departmental P&L views with headcount and opex by cost centre',
      'KPI dashboards with traffic-light RAG status and trend charts',
    ],
    modules: [],
  },

  {
    slug: 'equity-research',
    name: 'Equity Research Modeling',
    shortName: 'ERM',
    icon: '📈',
    color: '#059669',
    bgColor: '#ECFDF5',
    status: 'coming_soon',
    tagline: 'Buy-side and sell-side equity models built to institutional research standards.',
    description: 'Structured equity research platform with three-statement models, DCF valuation, sum-of-parts, and analyst-style price target outputs.',
    longDescription: 'The Equity Research Modeling platform provides a structured framework for building institutional-quality equity research models. Designed to the standards expected by buy-side and sell-side analysts, the platform guides users through company financial modelling, multi-method valuation, and the production of a professional research note output. Whether you are initiating coverage or updating a model, the platform ensures consistency, traceability, and speed.',
    whoIsItFor: [
      'Equity Research Analysts',
      'Portfolio Managers',
      'Buy-side Analysts',
      'Hedge Fund Analysts',
      'Investment Advisors',
    ],
    whatYouGet: [
      'Three-statement financial model with driver-based forecast build-up',
      'DCF valuation with WACC derivation and terminal value sensitivity',
      'Comparable company trading multiples and peer benchmarking',
      'Sum-of-parts valuation for diversified businesses',
      'Price target derivation and analyst recommendation output',
    ],
    modules: [],
  },

  {
    slug: 'project-finance',
    name: 'Project Finance Modeling',
    shortName: 'PFM',
    icon: '🏦',
    color: '#B45309',
    bgColor: '#FEF9C3',
    status: 'coming_soon',
    tagline: 'Infrastructure and project finance models built for DFIs, lenders, and developers.',
    description: 'Structured project finance platform covering cash flow waterfall, debt service coverage, sculpted debt repayment, and lender covenant testing.',
    longDescription: 'The Project Finance Modeling platform is purpose-built for infrastructure and energy projects where lenders and equity sponsors require detailed cash flow modelling, DSCR analysis, and debt sculpting. The platform guides users through full project lifecycle modelling - from construction phase financing through operations-phase cash flow waterfall and debt repayment - producing outputs that meet the requirements of development finance institutions, commercial lenders, and infrastructure equity investors.',
    whoIsItFor: [
      'Infrastructure Developers',
      'Project Finance Bankers',
      'DFI Analysts',
      'EPC Contractors',
      'Government Advisory Teams',
    ],
    whatYouGet: [
      'Construction phase cash flow with drawdown schedules and interest during construction',
      'Operations phase revenue model with capacity factors and escalation',
      'Debt service coverage ratio (DSCR) analysis and covenant testing',
      'Sculpted debt repayment tied to available cash flow',
      'Cash flow waterfall with senior debt, mezzanine, and equity distributions',
      'Lender base case, downside case, and covenant headroom analysis',
    ],
    modules: [],
  },

  {
    slug: 'lbo-modeling',
    name: 'LBO Modeling Platform',
    shortName: 'LBO',
    icon: '🔄',
    color: '#DC2626',
    bgColor: '#FEF2F2',
    status: 'coming_soon',
    tagline: 'Private equity LBO models with full debt waterfall, returns analysis, and exit scenarios.',
    description: 'Structured LBO platform covering sources and uses, leveraged capital structure, operating model, exit scenarios, and PE return analysis.',
    longDescription: 'The LBO Modeling Platform is built for private equity professionals who need to move quickly from deal screening to full model. The platform guides users through a complete leveraged buyout analysis - sources and uses of funds, leveraged capital structure, integrated operating model, debt repayment waterfall, and multi-scenario exit analysis. Returns outputs include IRR, MOIC, and cash yield at each level of the capital structure.',
    whoIsItFor: [
      'Private Equity Investors',
      'Leveraged Finance Bankers',
      'M&A Advisors',
      'Corporate Development Teams',
      'Family Offices',
    ],
    whatYouGet: [
      'Sources and uses of funds with detailed fee and transaction cost modelling',
      'Leveraged capital structure with senior, mezzanine, and equity tranches',
      'Integrated operating model with revenue, EBITDA, and working capital',
      'Debt repayment waterfall with cash sweep and PIK toggle mechanics',
      'Multi-scenario exit analysis - base, upside, and downside cases',
      'Returns summary: IRR, MOIC, and cash-on-cash at sponsor equity level',
    ],
    modules: [],
  },

  {
    slug: 'corporate-finance',
    name: 'Corporate Finance Modeling',
    shortName: 'CFM',
    icon: '🌍',
    color: '#1B4F8A',
    bgColor: '#E8F0FB',
    status: 'coming_soon',
    tagline: 'Strategic corporate finance models for M&A, capital allocation, and growth planning.',
    description: 'Corporate finance platform covering merger models, accretion/dilution analysis, capital structure optimization, and strategic scenario planning.',
    longDescription: 'The Corporate Finance Modeling platform supports corporate development teams and M&A advisors in building the analytical foundation for strategic transactions. From merger combination models and accretion/dilution analysis to capital structure optimization and strategic scenario planning, the platform covers the full range of corporate finance analytical requirements - all in a structured, guided workflow that produces board-ready outputs.',
    whoIsItFor: [
      'Corporate Development Teams',
      'M&A Advisors',
      'Investment Bankers',
      'CFOs & Strategy Directors',
    ],
    whatYouGet: [
      'Merger combination model with pro-forma income statement and balance sheet',
      'Accretion/dilution analysis with EPS sensitivity and break-even metrics',
      'Capital structure optimization model with WACC and leverage analysis',
      'Dividend policy and shareholder returns model',
      'Strategic scenario planning with Monte Carlo sensitivity outputs',
    ],
    modules: [],
  },

  {
    slug: 'energy-utilities',
    name: 'Energy & Utilities Modeling',
    shortName: 'EUM',
    icon: '⚡',
    color: '#D97706',
    bgColor: '#FFFBEB',
    status: 'coming_soon',
    tagline: 'Financial models for renewable energy, power generation, and utility assets.',
    description: 'Energy sector platform covering renewable project finance, utility valuation, power purchase agreement modeling, and grid tariff analysis.',
    longDescription: 'The Energy & Utilities Modeling platform is purpose-built for the financial analysis of power generation and energy infrastructure assets. The platform covers the full range of energy finance requirements - from renewable project IRR analysis and PPA pricing to utility company valuation and regulated asset base modelling. Built by practitioners with direct energy sector experience, the platform produces outputs that meet the standards of energy lenders, developers, and infrastructure investors.',
    whoIsItFor: [
      'Energy Sector Analysts',
      'Renewable Energy Developers',
      'Utility Finance Teams',
      'Infrastructure Investors',
    ],
    whatYouGet: [
      'Renewable energy project model - solar, wind, hydro with capacity factor and degradation',
      'Power purchase agreement (PPA) pricing and revenue certainty analysis',
      'Utility company valuation - regulated asset base and allowed return modelling',
      'Grid connection and capital expenditure schedule',
      'Energy storage economics - battery dispatch and revenue stacking',
      'Carbon credit and green certificate revenue modelling',
    ],
    modules: [],
  },

  {
    slug: 'startup-venture',
    name: 'Startup & Venture Modeling',
    shortName: 'SVM',
    icon: '🚀',
    color: '#7C3AED',
    bgColor: '#F5F3FF',
    status: 'coming_soon',
    tagline: 'Fundraising-ready financial models for startups, founders, and early-stage investors.',
    description: 'Startup finance platform covering cohort-based revenue, unit economics, runway analysis, cap table modeling, and investor return scenarios.',
    longDescription: 'The Startup & Venture Modeling platform gives founders and early-stage investors the tools to build credible, fundraising-ready financial models quickly. The platform covers the specific analytical frameworks that matter for high-growth businesses - cohort-based customer revenue, unit economics and LTV/CAC analysis, cash runway and burn rate modelling, cap table mechanics, and VC return scenario analysis. Every output is formatted for investor presentation and due diligence.',
    whoIsItFor: [
      'Startup Founders & CFOs',
      'Venture Capital Analysts',
      'Angel Investors',
      'Accelerator Teams',
      'Early-Stage Investors',
    ],
    whatYouGet: [
      'Cohort-based revenue model with monthly/annual customer acquisition and churn',
      'Unit economics - LTV, CAC, payback period, and contribution margin by cohort',
      'Cash runway and burn rate analysis with hiring plan integration',
      'Cap table model - founder dilution, option pool, and VC ownership rounds',
      'VC return scenario analysis - IRR, MOIC, and liquidation preference waterfall',
    ],
    modules: [],
  },

  {
    slug: 'banking-credit',
    name: 'Banking & Credit Modeling',
    shortName: 'BCM',
    icon: '🏛️',
    color: '#374151',
    bgColor: '#F9FAFB',
    status: 'coming_soon',
    tagline: 'Credit analysis and banking sector financial models for lenders and risk teams.',
    description: 'Banking and credit platform covering loan origination analysis, DSCR modelling, credit scoring, NPL resolution, and bank valuation.',
    longDescription: 'The Banking & Credit Modeling platform is built for credit professionals who need structured, consistent frameworks for loan analysis and credit risk assessment. The platform covers individual loan origination analysis through to portfolio-level credit risk modelling and bank valuation. Credit analysts, loan officers, and risk managers can use the platform to produce consistent, auditable credit assessments that meet internal committee and regulatory standards.',
    whoIsItFor: [
      'Credit Analysts',
      'Loan Officers',
      'Risk Managers',
      'Banking Analysts',
      'NPL Resolution Teams',
    ],
    whatYouGet: [
      'Loan origination model - debt sizing, DSCR, LTV, and debt yield analysis',
      'Borrower credit scoring model with qualitative and quantitative factors',
      'NPL resolution model - recovery scenarios, haircuts, and time-value adjusted returns',
      'Bank financial model - NIM, provision for credit losses, and capital ratios',
      'Stress testing - interest rate shock, credit loss scenario, and capital adequacy',
    ],
    modules: [],
  },
];

// ── Utility ─────────────────────────────────────────────────────────────────

export function getPlatform(slug: string): Platform | undefined {
  return PLATFORMS.find((p) => p.slug === slug);
}
