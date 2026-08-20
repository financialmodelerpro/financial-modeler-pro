/**
 * guideContent.ts (2026-08-20)
 *
 * THE ONE CONTENT SOURCE for the platform guide AND the guided tour.
 *
 * Every sentence about what a module or tab is for lives here and nowhere
 * else. The guide renders these constants; the tour renders THE SAME
 * constants; the Markdown and PDF downloads serialise the same GuideDoc built
 * from them. When the two surfaces overlap they cannot drift, because there is
 * nothing to drift between.
 *
 * The predecessor of this file (the inline maps in platformGuide.ts) is a
 * cautionary tale worth keeping in view: it covered modules 1 to 5, had no
 * entry for Parties or Fund Terms, described a payment mechanism that was
 * retired, and listed four cost stages when the platform ships five. Content
 * that is not measured against the live registries goes stale silently, so
 * verify-platform-guide now imports the REAL tab registry (lib/moduleTabs.ts)
 * and fails on any module or tab with no entry here.
 *
 * Writing rules: purpose first (what the surface is FOR, then how to use it),
 * no reference-client names, NO em dashes.
 */

export interface GuideTabEntry {
  /** What this surface is for. The tour shows this verbatim. */
  intro: string;
  /** Ordered how-to steps, rendered as a numbered list in the guide. */
  steps?: string[];
  /** What to look at once the inputs are in. */
  review?: string;
}

export interface GuideSurface {
  /** Stable id, used for tour anchors: [data-testid="<anchor>"]. */
  id: string;
  title: string;
  body: string;
  anchor: string;
}

/** Per-module intro, keyed by module key. EVERY live module must have one. */
export const MODULE_INTRO: Record<string, string> = {
  module1: 'Define the project: its phases and timeline, the parties involved, the optional fund layer, the assets being built, the development cost (capex), and how it is all funded. Everything downstream is computed from what you set here, so complete this module first.',
  module2: 'Project revenue for each asset by strategy: residential sales, hospitality (ADR times occupancy), and leasing. For sold units, revenue is recognised at handover and cash follows the sale cohort terms, so what you earn and when you collect it are modelled separately.',
  module3: 'Operating expenses per operating asset, plus head-office overheads. The platform provides the line-item structure; every value starts at zero and the numbers are yours, so nothing is charged that you did not enter.',
  module4: 'The full financial statements, composed automatically from Modules 1 to 3: Profit and Loss, Cash Flow (Direct and Indirect), and the Balance Sheet, plus the supporting schedules. The Balance Sheet balances by construction, so an imbalance always points at a real problem.',
  module5: 'Investment returns and valuation: IRR, MOIC and NPV on the project (unlevered, full cost), the equity, and actual distributions, with terminal value, real-estate KPIs, lender covenants, and the fund waterfall when the fund layer is on.',
  module6: 'Scenario analysis over the whole model. A scenario is the Management (base) case plus only the inputs you override; the active case drives every module and every export, and viewing a case never changes your base.',
  module7: 'The Investment Committee presentation builder: a slide editor where every figure is a live binding into the model, so the deck follows your numbers with no copy-paste and no sync step.',
};

/** Per-tab content, keyed "moduleKey/tabKey". EVERY live tab must have one. */
export const TAB_CONTENT: Record<string, GuideTabEntry> = {
  'module1/project-phases': {
    intro: 'Start here. Define the project identity and lay out its phases, the timeline every other module is built on.',
    steps: [
      'Enter the project name, currency, location, and start date.',
      'Select the country. It drives the statement terminology (for example Zakat) and records where the project is; typing a location can suggest the country, but nothing is inferred without your click.',
      'Set the tax or zakat rate the financial statements will apply.',
      'Add one phase per development stage. For each phase set the start date, the number of construction years, and the number of operations (income) years.',
      'If a phase is already running, set its status to Operational and record its existing baseline (opening cash, net book value, existing equity and debt) on the Financing tab, Existing Operations card.',
    ],
    review: 'the construction-end and operations-start dates shown next to each phase; they drive when costs, revenue, and depreciation occur.',
  },
  'module1/parties': {
    intro: 'Record who is involved: developer, fund manager, equity partners, lenders, and advisors. Parties are identity only (no numbers), and other surfaces link to them: fund fee shares split by party role, and Module 5 equity partners can be linked to an equity-role party.',
    steps: [
      'Add each party with its name and role. A party can hold more than one role.',
    ],
    review: 'that every organisation the model refers to exists here once, so the fee matrix and the partner list point at the same names.',
  },
  'module1/fund-terms': {
    intro: 'The optional fund layer. Switched off, the model is byte-identical to a project with no fund; switched on, it charges the fund fees, runs the distribution waterfall, and reports gross versus net returns.',
    steps: [
      'Enable the fund layer, then set the five fees: structure (on fund size), management and custody (on total equity), debt arranging (on the debt facility), and other fund expenses (a flat amount).',
      'Set the hurdle rate and the performance fee taken on distributions above it.',
      'Choose how the management fee is funded: inside the deficit the funding method sizes (the default), or as a dedicated equity draw on top of the ratio split. The same toggle also appears on the Financing tab.',
      'Allocate fee income across parties in the distribution matrix. Shares are used exactly as entered and any remainder is reported, never silently normalised.',
    ],
    review: 'the three capital bases (total equity, debt facility, fund size, which is their sum) and the fee basis table that states what each fee is charged on.',
  },
  'module1/assets': {
    intro: 'Describe what is being built in each phase, and how each asset makes money.',
    steps: [
      'Add each asset to its phase and choose its strategy: Sell (residential for sale), Operate (hospitality), Lease (income property), or Sell + Manage.',
      'Changing a strategy later is a model operation, not a label change: the dialog previews exactly what moves, the outgoing strategy\'s assumptions are parked (not deleted), and a review banner lists the inputs the new strategy still needs.',
      'Set the asset areas (BUA, GFA) and link the asset to its land parcel. Parcels are project-wide: a Phase 2 asset can draw on Phase 1 land, and every parcel option shows the rate it resolves to.',
      'Add sub-units under each asset: apartments or villas, hotel keys, or leasable space. Area and unit size are the inputs and the count is derived (area = unit size x count), so only two of the three are ever typed.',
    ],
    review: 'the area reconciliation, which shows how sub-units, support, and parking roll up to the asset BUA and GFA. Confirm it matches your intent before moving on.',
  },
  'module1/costs': {
    intro: 'The development cost, as an ordered list of cost lines per phase. A cost line belongs to the phase, so every asset in the phase reads it unless you override per asset; the row names the other assets a typed value reaches.',
    steps: [
      'Add lines from the cost catalog. Selecting an entry stamps its method, stage, and phasing onto the line; renaming changes the label only, so behaviour never hides behind a name.',
      'For each line choose a basis: a fixed lump sum, a rate times a quantity (per BUA sqm, per unit, per key), or a percentage of another total. A percent-of-selected-lines base may reference only lines ABOVE it in the list, which is what makes a fee-on-fee cascade safe.',
      'Set the stage per line: land, hard, soft, marketing, or operating. Marketing is a selling cost, so construction cost excluding land also excludes it, and selling lines apply only to assets that sell.',
      'Phasing: each asset carries one capex curve that every line inherits, with per-line break-out. Two lines are derived and never take the construction curve: a transfer tax follows the land cash, and marketing or commission follow sales collections.',
      'Reorder lines where needed; the order is part of the model because percentage bases are positional.',
    ],
    review: 'the Results sub-tab: the capex schedule by year, per line and per asset, with totals including land, excluding in-kind land, and excluding all land. A zero always states its reason (for example a parcel that resolves no rate) rather than sitting silent.',
  },
  'module1/financing': {
    intro: 'Decide how the project is funded, and see the full debt and equity mechanics.',
    steps: [
      'Choose a funding method and the debt and equity split, and set the minimum cash reserve to maintain.',
      'Add debt facilities (existing and new) with their interest rate and terms. Facility shares are used exactly as you type them: shares that do not sum to 100% are flagged with a one-click repair, never silently rescaled.',
      'Record any existing-operations opening balances on the Existing Operations card.',
      'Set the dividend policy (payout ratio and start year) and, if used, the cash sweep that prepays debt from surplus cash.',
      'On a fund project, the management fee funding toggle sits here too, beside the funding method it interacts with.',
    ],
    review: 'the Schedules sub-tab (debt movement and finance cost per facility, plus equity), the Funding Gap sub-tab (the requirement under each method, sized on the reference deficit schedule), and the Cash Sweep sub-tab (the full cash waterfall down to closing cash).',
  },
  'module2/m2-inputs': {
    intro: 'Set the revenue assumptions for each asset, grouped by strategy.',
    steps: [
      'For Sell assets, set the sales velocity: how many units or how much area sell each year, in the pre-handover and post-handover tables. Each velocity must sum to the asset\'s total inventory.',
      'For Operate (hospitality) assets, set the starting ADR, occupancy per year, and food-and-beverage and other revenue, with indexation.',
      'For Lease assets, set the base rent, occupancy, and rent indexation.',
    ],
    review: 'that each velocity sums to the asset total inventory; inputs group under their strategy with the phase shown as a tag.',
  },
  'module2/m2-revenue': {
    intro: 'The revenue output, plus the sale cohort terms that decide when sale proceeds are collected. Revenue on sold units is recognised at handover (the last construction year); cash arrives earlier or later, cohort by cohort.',
    steps: [
      'Set the downpayment percent per sale year. The project carries a default that every asset inherits; override per asset where the terms differ, and an unset year is visibly distinct from a deliberate zero.',
      'Set the maximum instalment years. A cohort selling in year N pays its downpayment in year N and the balance in equal instalments over that run.',
      'Choose the handover cut-off: with the hard cut-off (the default) instalments stop at handover, where the buyer pays the remainder; switched off, they run their full length past it.',
    ],
    review: 'the cohort grid (sale years down, calendar years across) showing exactly when each cohort\'s cash arrives; the rule sentence above it states the active terms in words. Also review the Selling Costs section, which names the basis each selling cost charges on, and shows a held asset at zero with the reason.',
  },
  'module2/m2-cost-of-sales': {
    intro: 'Cost of sales for residential sales, matched to revenue recognition (read-only).',
    review: 'the capex basis, the vintage matrix (with total), the construction-versus-operations split, and the inventory (work-in-progress) roll-forward, per asset.',
  },
  'module2/m2-schedules': {
    intro: 'The balance-sheet and cash-flow feeders that revenue produces (read-only).',
    review: 'receivables, unearned revenue, inventory, and cash collected, per asset, each with a roll-forward that foots from opening to closing.',
  },
  'module2/m2-escrow': {
    intro: 'Model the pre-sales escrow that holds a portion of customer advances until handover.',
    steps: [
      'Set the project held percentage and the default release year.',
      'Override the held percentage or release year per asset where the terms differ.',
    ],
    review: 'the pre-sales cash by asset, the escrow balance roll-forward, and the cash-flow impact.',
  },
  'module3/m3-inputs': {
    intro: 'Build operating expenses per operating asset and for head office. The platform seeds the line-item structure with every value at zero: the categories are a starting point, the numbers are yours.',
    steps: [
      'For each operating asset, work through the seeded lines and enter your values. Modes: a fixed baseline, a per-key or per-sqm rate, or a percentage of revenue or GOP.',
      'Disable any line you do not need; a disabled line charges nothing and keeps no hidden value.',
      'Set indexation per line, or inherit the asset default (3% compounding); percentage-of-revenue lines never index, because their base already grows.',
      'Enter head-office overheads once at the project level.',
    ],
    review: 'that every operating asset carries the lines you expect, with your values, before checking the output.',
  },
  'module3/m3-output': {
    intro: 'The operating-expense output, computed from your inputs (read-only).',
    review: 'per operating asset, the revenue breakdown and the per-category cost tables (direct, indirect, management, reserves), then the project total including head office.',
  },
  'module4/m4-schedules': {
    intro: 'The supporting schedules behind the statements (read-only).',
    review: 'fixed assets and depreciation (which starts when an asset is available for use, at operations start, never during construction), the capitalised-interest (IDC) pool, and working capital.',
  },
  'module4/m4-pl': {
    intro: 'The Profit and Loss statement, composed from Modules 1 to 3.',
    steps: [
      'Set the terminology (standard or Saudi) and the tax or zakat rate at the top.',
      'Use the phase buttons to view the consolidated project or a single phase.',
    ],
    review: 'the consolidated view runs to profit after tax; a single phase shows that phase down to EBITDA. On a fund project the five fund fees total into one line and EBITDA is struck after it, with a basis table stating what each fee was charged on.',
  },
  'module4/m4-cashflow': {
    intro: 'The Cash Flow statement, in both Direct and Indirect form.',
    review: 'the consolidated view runs Operations, Investing, and Financing, and both methods end on the same net cash. Land contributed in kind appears inside the totals as a matched pair (in Total Capex and in Financing) that nets to zero, so both sections foot on the full cost.',
  },
  'module4/m4-balancesheet': {
    intro: 'The consolidated Balance Sheet, composed from every feeder schedule.',
    steps: [
      'Set the operating receivable days (DSO) and the statutory reserve inputs at the top.',
    ],
    review: 'the balance check should be zero each year; the reconciliation bridge localises any imbalance by line.',
  },
  'module5/m5-returns': {
    intro: 'Headline investment returns and valuation. FCFF is unlevered and charges the FULL cost (including in-kind land and capitalised interest); FCFE builds visibly from FCFF; distributions show what equity actually receives.',
    steps: [
      'Set the discount rate, the exit year, and the terminal value method: Exit Multiple, Perpetuity, or Exit Cap Rate (derived as the discount rate less growth unless you type one, with a forward-income toggle).',
      'On a fund project, review the distribution waterfall: hurdle accrual, amounts paid, the performance fee on the excess, and gross versus net IRR and MOIC side by side.',
    ],
    review: 'the headline returns (project, equity, and distributions), development economics, exit analysis, sources and uses, the cash-flow streams, and the two DDM tables (before and after the performance fee). Sensitivity is plan-gated.',
  },
  'module5/m5-metrics': {
    intro: 'Real-estate key performance indicators, with editable lender covenants (read-only otherwise).',
    review: 'yield on cost, cap rate, equity multiple, cash-on-cash, and the covenant readings: DSCR, interest cover, debt yield, and LTV at peak debt.',
  },
  'module5/m5-cases': {
    intro: 'Compare scenario cases side by side, so a decision is made against the range of outcomes rather than one number.',
    review: 'Management, Downside, Upside, and any custom case, with the key returns and their difference versus Management.',
  },
  'module7/m7-ic': {
    intro: 'A slide editor for the IC deck: navigator, 16:9 canvas, and properties. Slides hold binding keys, never copied numbers, so an out-of-date figure cannot exist; an unresolved binding shows an amber UNLINKED state instead of a stale value.',
    steps: [
      'Build from the template library: templates auto-omit when the model has nothing for them, and full year-by-year schedules paginate across slides automatically.',
      'Edit directly on the canvas: drag, resize, snap, inline text, undo, and free text boxes.',
      'Use AI drafting on narrative blocks: drafts are grounded in your computed model, shown for review, and never auto-saved.',
      'Save versions (auto-named, the last one reopens with the project) and export the deck as PowerPoint or PDF from one shared contract, so a file figure cannot drift from the screen.',
    ],
    review: 'the amber UNLINKED markers, which show exactly which bindings did not resolve, and the live table of contents.',
  },
};

/**
 * MODULE 6 SURFACES. Scenario Analysis is one page of stacked sections with no
 * sidebar sub-tabs (MODULE_TABS records it as an EMPTY list, deliberately), so
 * its guide children and its tour steps come from this list instead. Each
 * anchor is a real data-testid on the page.
 */
export const MODULE6_SURFACES: ReadonlyArray<GuideSurface> = [
  {
    id: 'module6/cases',
    title: 'Cases',
    body: 'The case list. Management is the base model; Downside, Upside, and any custom case hold only the inputs you change. Switch the active case here or from the top bar; the active case drives the whole model and every export.',
    anchor: 'm6-cases',
  },
  {
    id: 'module6/overrides',
    title: 'Assumptions grid',
    body: 'The per-case overrides, one row per changed input across every case. A curated list offers the levers that can actually move results, and a field finder reaches any input in the model. An overridden input shows a "different from Management" badge with a one-click reset wherever it appears.',
    anchor: 'm6-overrides',
  },
  {
    id: 'module6/comparison',
    title: 'Comparison matrix',
    body: 'Headline outcomes for every case side by side, with the delta against Management, so you can see what each scenario does to returns before opening it.',
    anchor: 'm6-comparison',
  },
  {
    id: 'module6/yoy',
    title: 'Year-on-year impact',
    body: 'For each changed input, the per-period outputs it drives: the base series and each scenario\'s divergence from it, year by year, so a scenario is explained rather than just totalled.',
    anchor: 'm6-yoy',
  },
];
