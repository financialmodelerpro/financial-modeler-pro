/**
 * The REFM live course's eight sessions (founder content, 2026-11-08).
 * Data only: read by scripts/seed-refm-sessions.ts and by the verifier.
 * Every session runs 7:00 to 9:30 PM KSA = 16:00 to 18:30 UTC.
 */

export interface SeedSession {
  no: number;
  /** UTC start (7:00 PM KSA). */
  start: string;
  title: string;
  overview: string;
  learn: string[];
  outcome: string;
  claude: string;
}

export const REFM_COURSE_CODE = 'REFM';
export const REFM_DURATION_MINUTES = 150;

export const REFM_SESSIONS: SeedSession[] = [
  {
    no: 1, start: '2026-12-01T16:00:00.000Z',
    title: 'Overview, Model Architecture and Timeline',
    overview: 'We start with what makes real estate modeling different from a corporate model, then walk through the case study and the model we will build together over eight weeks. You will set up the model\'s structure, the build rules every tab follows, the financial statements shell, and the timeline that drives every schedule.',
    learn: [
      'How develop-and-sell projects (apartments for sale) differ from build-and-hold assets (hotel and commercial) in cash, revenue and accounting',
      'Why pre-sale cash funds construction, why revenue waits for handover, and where cost sits until then',
      'The case study: FMP Marina Gate in Jeddah, two phases, five model lines, land partly in cash and partly in kind, one funding structure',
      'The model architecture: one tab for each job, one direction of flow from inputs to returns',
      'The build rules: colour code for inputs, formulas and links, one formula per row, totals and checks',
      'Setting up the income statement, balance sheet and cash flow shell that we fill in each week',
      'The timeline and flags: construction, handover, operations and exit, by phase',
    ],
    outcome: 'A structured model with inputs, a working timeline and flags, and an empty statements shell ready to fill.',
    claude: 'Claude writes all fifteen flag rows in one go, and we check every formula before accepting.',
  },
  {
    no: 2, start: '2026-12-08T16:00:00.000Z',
    title: 'Land, Area and Development Cost',
    overview: 'Every real estate model starts from the land. You will turn six plots into gross floor area, sellable area, units and built-up area using the standard GCC area chain, then build the full development cost by line and by year.',
    learn: [
      'The area chain: land, developable area, GFA, net sellable area, units or keys, footprint, landscape, parking and total built-up area',
      'How utilisation, coverage, FAR, service share and parking ratios shape each plot',
      'Rolling plots up into the model lines the rest of the model uses',
      'Why built-up area drives construction cost and net sellable area drives sales and rent',
      'The cost stack: land, RETT, hard costs on GFA, parking and landscape, and soft costs',
      'Land paid in cash compared with land contributed in kind',
      'Spreading cost over construction years with a phasing curve',
      'Three capex summaries (by line, by cost type and by year), and linking development cost paid into the cash flow',
    ],
    outcome: 'The complete area schedule and a development cost budget by line and year, linked into investing cash flow.',
    claude: 'Claude writes one plot row of 24 columns from land to built-up area, which we copy down and check against the answer key.',
  },
  {
    no: 3, start: '2026-12-15T16:00:00.000Z',
    title: 'Financing, Finance Cost and Fixed Assets',
    overview: 'You will work out how much the project must raise each year, fund it with debt and equity, and calculate finance cost without a circular reference. Then capitalised costs move into work in progress and fixed assets, and a cash waterfall decides debt repayment and distributions.',
    learn: [
      'The funding need: development cost, marketing and commission, and Zakat/Tax, less sales collections and spare cash',
      'Splitting the need between debt and equity',
      'The debt schedule corkscrew: drawdowns, capitalised finance cost, repayments and closing balance',
      'One finance cost row, split into capitalised during construction and expensed after, with no circular reference',
      'Fund fees: structuring fee, management fee, and custody and administration',
      'The cash waterfall: repay debt first, keep a minimum cash balance, then distribute the rest',
      'Allocating capitalised finance cost to the lines under construction',
      'CWIP, transfer to fixed assets at completion, and depreciation',
    ],
    outcome: 'A funded model with debt, equity, finance cost, fund fees, CWIP, fixed assets and a working cash waterfall, all linked into the statements.',
    claude: 'Claude writes the debt schedule and cash waterfall (about 20 rows), and we check them before accepting.',
  },
  {
    no: 4, start: '2026-12-22T16:00:00.000Z',
    title: 'Residential Sales and the Vintage Matrix',
    overview: 'Residential sales are where most real estate models go wrong. You will build sales from area sold to sale value, collect cash by year of sale through a vintage matrix, and recognise revenue at handover, with customer advances, inventory and cost of sales handled correctly.',
    learn: [
      'Sales as a share of net sellable area, with pre-sales during construction and sales after handover',
      'The unsold area corkscrew, and price growth only while units are still on sale',
      'Payment terms by year of sale: downpayment, instalments, and full payment for handover-year sales',
      'The vintage matrix: collections from every year\'s sales in one formula',
      'Revenue recognition at handover compared with cash collected earlier',
      'Customer advances on the balance sheet',
      'Inventory release and cost of sales as area is recognised',
      'Marketing and sales commission',
    ],
    outcome: 'A complete residential sales schedule with collections, revenue, advances, inventory and cost of sales, linked into all three statements.',
    claude: 'Claude writes the area sold, downpayments, the vintage matrix, and revenue and advances, and we check them before accepting.',
  },
  {
    no: 5, start: '2027-01-05T16:00:00.000Z',
    title: 'Hotel and Commercial Operations',
    overview: 'The held assets earn income once they open. You will build the hotel from keys to EBITDA following the USALI order, the commercial buildings from leasable area to net operating income, and the working capital that turns revenue and costs into cash.',
    learn: [
      'Hotel revenue: keys, days open, occupancy ramp-up and ADR growth to rooms revenue',
      'Food and beverage and other revenue',
      'USALI costs: departmental and undistributed expenses to gross operating profit',
      'Management fees and the FF&E reserve to EBITDA',
      'Commercial leasing: leasable area, occupancy and rent growth to rent revenue and NOI',
      'One combined NOI for the held assets, used later for the exit value',
      'Trade receivables and payables from days, and their effect on cash',
    ],
    outcome: 'Hotel and commercial operations from revenue to EBITDA and NOI, with working capital, linked into the statements.',
    claude: 'Claude writes the hotel P&L in the USALI layout, and we check it before accepting.',
  },
  {
    no: 6, start: '2027-01-12T16:00:00.000Z',
    title: 'Zakat/Tax, Equity and the Statements Review',
    overview: 'With operations in place, you will add Zakat/Tax, decide how cash goes back to shareholders, and complete the equity section. Then we review all three statements together, prove they tie, and look at where models usually break.',
    learn: [
      'A simple Zakat/Tax calculation: the base, the charge, and a switch for the exit gain',
      'The Zakat/Tax payable corkscrew, paid the year after it is charged',
      'Distributions split into dividends from profits and capital reduction for any excess',
      'Share capital: cash and land contributed, less capital returned',
      'Retained earnings after net income and dividends',
      'Three proofs that the statements tie: net income to equity, cash agrees, balance sheet balances',
      'The usual reasons a balance sheet does not balance, and how to trace them',
    ],
    outcome: 'Complete equity and Zakat/Tax schedules and three statements that tie in every year.',
    claude: 'Claude writes the Zakat/Tax and equity rows, and we check them before accepting.',
  },
  {
    no: 7, start: '2027-01-19T16:00:00.000Z',
    title: 'Exit, Returns and the Fund Layer',
    overview: 'This is where investors focus. You will value the held assets at exit, build four cash flows from project to investor, and measure each with IRR and MOIC. Then you will run the fund\'s performance fee waterfall and show what each party earns.',
    learn: [
      'Exit value from next year\'s NOI and an exit cap rate, less selling costs',
      'The gain on sale against book value',
      'Four cash flows: project (FCFF), equity (FCFE), equity before the performance fee, and investor after the fee',
      'IRR and MOIC for each cash flow, and what each one tells you',
      'The fund layer: capital returned first, then a preferred return, then a share of the excess',
      'The hurdle balance corkscrew and the performance fee calculation',
      'Who earns what: investors, the developer and the fund manager',
    ],
    outcome: 'Full returns analysis and fee waterfall, with all three statements complete.',
    claude: 'Claude writes the exit value, the four cash flows, the hurdle and the performance fee, and we check them before accepting.',
  },
  {
    no: 8, start: '2027-01-26T16:00:00.000Z',
    title: 'Dashboard, Checks, Model Review and the Platform',
    overview: 'In the final session you will present the results, prove the model works, and use Claude as a reviewer. Then you will see the same case on Financial Modeler Pro, and we explain the model submission and certificate.',
    learn: [
      'A one-page dashboard an investment committee reads first: returns, development, funding and charts, with every number linked',
      'The checks tab: balance sheet, cash, sources and uses, and cash flow agreement, with one overall status',
      'Using Claude as a model reviewer: what to share, what to ask, and how to read the findings',
      'Confirming every finding in Excel, and running simple stress tests',
      'The same case built on Financial Modeler Pro',
      'How to submit your model for review and earn the certificate',
    ],
    outcome: 'A finished, checked and reviewed real estate development and fund model, ready to submit.',
    claude: 'Claude reviews the full model, and we confirm each finding in Excel.',
  },
];
