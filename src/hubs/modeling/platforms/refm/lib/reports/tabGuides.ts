/**
 * tabGuides.ts (2026-10-05, export review item 25)
 *
 * "HOW THIS TAB IS CALCULATED", ONCE. The workbook appended these to every tab
 * and the PDF printed none of them. Moved here verbatim from the workbook and
 * keyed by subject rather than by sheet name, so the workbook maps its sheets
 * onto them and the PDF prints them at the end of the matching tab.
 *
 * Wording is surface-neutral where a line used to name the workbook ("the
 * Checks tab", "this workbook"): both documents print the same sentence.
 *
 *   Inputs   what the tab consumes, and where those inputs come from
 *   Logic    the mechanics the engine applies, in order
 *   Feeds    where the outputs land downstream
 *
 * No em dashes in this file.
 */
import { RETURNS_NPV_NOTE } from './metricCaptions';

export type GuideLine = { kind: 'inputs' | 'logic' | 'feeds'; text: string };
const G = (kind: GuideLine['kind'], text: string): GuideLine => ({ kind, text });

export type GuideId = 'summary' | 'assumptions' | 'timeline' | 'landArea' | 'capex' | 'financing' | 'revenue' | 'opex' | 'schedules' | 'pl' | 'cashflow' | 'balsheet' | 'returns' | 'scenarios' | 'checks';

export const TAB_GUIDES: Record<GuideId, GuideLine[]> = {
  summary: [
    G('inputs', 'Finished figures from the returns engine, the capex report, the area and land rules, the revenue sections and the balance sheet.'),
    G('logic', 'Nothing is re-derived: this is the same overview builder the platform\'s Project Overview uses. Each IRR sits beside its own MOIC; the distributed pair is after the performance fee where a fund exists. Cost per sqm divides development or construction cost by GFA or saleable area. Debt / equity is each one\'s share of ALL sources, customer collections and operating cash included, so it is not a debt-to-equity ratio.'),
    G('feeds', 'Nothing downstream. This is the read-out to hand over when the detail is not needed.'),
  ],
  assumptions: [
    G('inputs', 'Every input screen of the platform in module order: Project & Phases, Fund Terms, Asset Types & Standards (type values, parking area per slot, cost escalation, cost standards), Plots, Assets by plot (Table 2), Sub-units (Table 5), Capex lines, Financing, Revenue and Escrow per line, Opex per line and DPO, P&L and depreciation inputs, Returns.'),
    G('logic', 'Nothing is computed here. Shaded cells are what a user types on the platform; unshaded figures beside them (derived windows, values inherited from the asset type, capex quantities and subtotals, resolved ADR and rent, default splits) are shown the way the screens show them.'),
    G('feeds', 'Every other tab. Change an input on the platform and re-export to see the effect flow through; editing this workbook does not recalculate it.'),
  ],
  timeline: [
    G('inputs', 'Each phase\'s start date, construction periods and operations periods (a legacy overlap on an older project is read, never edited).'),
    G('logic', 'Period 0 is the opening column (the year before the project start); periods 1..N are the active years. Construction runs from the phase start for its construction periods; operations begin the day after construction ends and run for the operations periods. The project ends at the latest operations end across all phases.'),
    G('feeds', 'Every period schedule keys its columns to this axis, so all of them share one timeline and one period index.'),
  ],
  landArea: [
    G('inputs', 'Plot area and land rate (Table 1), the Table 2 massing (land utilisation, ground coverage, FAR, retail share, service share), and the asset type values (unit size, parking ratio, parking area per slot). A plot value wins; an absent value inherits from the type; a typed 0 is a real value.'),
    G('logic', 'Top-down per plot: plot area x utilisation = net developable area; x coverage = building footprint; utilised land x FAR = Total GFA. The retail share of the footprint is ground-floor retail, carried by the line\'s retail strip, which carves its land out of its hosts in proportion to retail GFA over each host\'s total GFA. Main Asset GFA less the service share gives net saleable area; units, parking slots and parking areas follow; Total BUA = Total GFA + parking. Table 4 adds the plots of each line. Land is allocated by sqm only: land value = land sqm x the plot\'s rate, split into cash and in-kind by the plot\'s percentages.'),
    G('feeds', 'The Capex quantity bases (Main Asset GFA, Parking Area, Landscape Area, Plot Area, Retail GFA, Retail Parking Area), the land value lines in Capex, and the land on the Balance Sheet.'),
  ],
  capex: [
    G('inputs', 'Each cost line, by line: method, rate (base-year money, a Types and Standards default unless typed on the Capex line), the rate source, and the phasing source the engine resolved (the phase curve, the line\'s own curve, follows land cash, follows collections, or the parcel payment schedule); construction cost escalation from Types and Standards.'),
    G('logic', 'Each line = Rate x Quantity on its basis (Main Asset GFA, Parking Area, Landscape, Retail GFA, Retail Parking, Plot Area, units, a percentage of land, of revenue or of the lines selected above it, or a lump sum). When escalation is on, a rate escalates from the project start year into the years its line spends, weighted by the line\'s spend profile; lump sums, the land value lines and anything charged on land or revenue are exempt. The allocation profile is the engine\'s resolved spend as a share of each line\'s total.'),
    G('feeds', 'Table 2 (incl. all land) feeds Cost of Sales and fixed assets; Table 3 (excl. land in-kind) is the cash capex Financing funds; Table 4 (excl. total land) is construction cost; Table 5 gives land cash and in-kind per phase for land funding; Table 6 files the cost by section.'),
  ],
  financing: [
    G('inputs', 'Minimum cash, IDC allocation basis, funding method and its debt / equity split, how the fund management fee is funded, the land funding split per phase, and each facility\'s interbank rate, credit spread, fees, repayment method, start year, periods and share.'),
    G('logic', 'The selected method sizes the requirement. Method 3 (cash deficit) draws debt and equity at the ratio only in periods with construction spend, to keep the minimum cash, and its sizing carries no finance cost. IDC is paid in the period it arises, with debt drawn only for what cash cannot cover, and is capitalised into asset cost. A fee funded by equity is drawn directly, outside the ratio. Each finance cost ledger closes Opening + Charge - Paid. The sweep repays debt from surplus above the minimum cash, then dividends follow the policy.'),
    G('feeds', 'Interest to the P&L; drawdowns, repayments, interest paid and dividends to the Cash Flow; debt and equity to the Balance Sheet; FCFE and distributions to Returns.'),
  ],
  revenue: [
    G('inputs', 'Per line, filed by section (Residential, Hospitality, Standalone Commercial, Retail Ground Floor): sub-units and prices from the Assets tab (sale price per sqm or per unit, ADR, rent), sales pace by year, price or rent indexation, recognition method, sale cohort terms (downpayment by sale year, instalment years), hotel occupancy, guests, F&B and Other, lease occupancy, receivable days, and the escrow held % and years.'),
    G('logic', 'Sell revenue = area or units sold (pace x inventory, capped at what is unsold) x base price x indexation factor. Pre-sales recognise at handover (the last construction year), or per the recognition profile; sales during operation recognise in their sale year. Collections follow the sale cohort terms: a downpayment in the sale year, then instalments to handover. Hotel revenue = keys x days x occupancy x indexed ADR, plus F&B and Other as a percentage of rooms. Lease revenue = gross lease area x occupancy x indexed rent. Cost of sales = Module 1 capex plus capitalised IDC, released on each line\'s share of lifetime recognised revenue. Escrow locks a share of pre-sales cash and releases it as one sum in the release year.'),
    G('feeds', 'Revenue and Cost of Sales to the P&L; collections (net of escrow) to the Cash Flow operating block; receivables, inventory, unearned revenue and the escrow balance to the Balance Sheet.'),
  ],
  opex: [
    G('inputs', 'HQ overheads and the project DPO, then per line: opex items by category and mode (percent of revenue or GOP, per key, per sqm, fixed), the asset inflation and any per-item override or year-by-year rates.'),
    G('logic', 'Fixed, per-key and per-sqm items inflate with the asset (or overriding) inflation; percent-of-revenue and percent-of-GOP items move with revenue and are not indexed. A hotel reads as an operating statement: revenue by department, departmental expenses, undistributed expenses, GOP, management fees, fixed charges and reserves, EBITDA. Lease lines group into property operating costs and other charges down to EBITDA. Accounts payable = opex x DPO / days basis; cash paid = opex less the change in payables.'),
    G('feeds', 'Opex by line to the P&L between revenue and EBITDA (hotel departments and expense groups as members of their headers); opex paid to the Cash Flow; accounts payable to the Balance Sheet.'),
  ],
  schedules: [
    G('inputs', 'Capex by line, capitalised interest (IDC) by line, useful life and depreciation method per line, revenue recognition and collections, opex and DPO, and the debt, equity and dividend schedules.'),
    G('logic', 'Fixed Assets & D&A, per held line (Operate and Lease): Land (opening + additions - disposed at exit = closing; land never depreciates) and Depreciable (opening + capex additions + IDC additions - depreciation - disposed at exit = closing). Depreciation starts when the asset is available for use, on capex and IDC alike, and stops at the exit, when the balance is written off as a disposal. IDC on a Sell line is not a fixed asset: it goes to inventory and is released through Cost of Sales. BS Schedules roll each balance forward: receivables, unearned revenue, inventory, payables, escrow, debt, equity and retained earnings.'),
    G('feeds', 'Every closing balance is a Balance Sheet line; every movement is the matching adjustment in the Indirect Cash Flow; depreciation is the D&A line of the P&L.'),
  ],
  pl: [
    G('inputs', 'Recognised revenue and Cost of Sales from Revenue, opex from Opex, the fund management fees, D&A from Schedules, interest, the disposal gain, and the zakat or tax rate with its disposal-gain toggle.'),
    G('logic', 'Revenue - Cost of Sales = gross profit; - operating expenses - Total Fund Management Fee = EBITDA (struck after the fund fees). EBITDA - D&A = EBIT; - interest expensed (construction interest is capitalised, not expensed) + gain on disposal = profit before zakat or tax; - zakat or tax (charged excluding the disposal gain unless the toggle includes it) = profit after tax. The subtotals are the engine\'s own figures, never recomputed. A phase view stops at EBITDA before the fund fees, which are project-level, so phase EBITDAs do not add to the project figure.'),
    G('feeds', 'Profit after tax to retained earnings on the Balance Sheet and to the top of the Indirect Cash Flow; EBITDA to the DSCR and ICR covenants in Returns.'),
  ],
  cashflow: [
    G('inputs', 'Collections and escrow from Revenue, opex paid from Opex, fund fees, zakat or tax paid, capex and disposal proceeds, and drawdowns, repayments, interest and dividends from Financing.'),
    G('logic', 'Direct: cash collected - opex paid - Fund Management and Other Expenses - zakat or tax = cash flow from operations; - capex paid in cash (in-kind land shown as a matched pair that nets to zero) + disposal proceeds at the exit = cash flow from investing; + equity and debt drawn - principal, interest and dividends = cash flow from financing. Indirect: profit after tax + D&A - gain on disposal +/- working capital movements = the same cash flow from operations. Closing cash = opening + net cash flow, and both methods must agree every period. A phase view shows operations and investing only.'),
    G('feeds', 'Closing cash is the Balance Sheet cash line. The integrity checks assert Direct equals Indirect and cash ties to the Balance Sheet in every period.'),
  ],
  balsheet: [
    G('inputs', 'Closing balances from the Schedules, closing cash from the Direct Cash Flow, and debt and equity from Financing.'),
    G('logic', 'Assets (cash, restricted escrow cash, receivables, inventory, fixed assets including capitalised IDC, land) = Liabilities (payables, unearned revenue, debt) + Equity (share capital, reserves, retained earnings). Cash is carried from the Direct Cash Flow, and the balance check proves the two sides agree; the reconciliation bridge explains every period\'s movement and its Unexplained row must read 0. Held fixed assets and land read zero from the exit, when they are disposed of.'),
    G('feeds', 'Nothing downstream: this is the closing position. Debt outstanding feeds LTV at peak debt in Returns.'),
  ],
  returns: [
    G('inputs', 'The Module 4 statements, the returns assumptions (discount rate, exit year, terminal value method, basis, cap rate or multiple, growth), equity partner shares, fund terms and covenant thresholds.'),
    G('logic', 'FCFF is unlevered full cost: operating cash before interest, less cash capex (investing before disposal proceeds), in-kind land and capitalised interest, plus the terminal value. FCFE builds visibly from FCFF before the terminal value: + net debt - finance cost, then the terminal value less closing debt. Distributed equity is equity in against dividends out. The terminal value capitalises the basis year\'s income (the year before exit by default) at the exit cap rate, an exit multiple or perpetuity growth, or is none, and is booked as a disposal. IRR and MOIC per basis; ' + RETURNS_NPV_NOTE + ' RE Metrics: covenants from per-period series (DSCR and ICR worst year, Debt Yield, LTV at peak debt = debt / GDV).'),
    G('feeds', 'The Summary tab and the Scenarios comparison.'),
  ],
  scenarios: [
    G('inputs', 'The Management base case and each scenario case\'s overrides.'),
    G('logic', 'Each case re-runs the engine on a copy of the base with its overrides applied and settled (the base is never changed). The assumptions grid shows the key drivers and every overridden field per case; the comparison shows headline KPIs with deltas against Management; the year-on-year impact appears only when an override drives a per-period output.'),
    G('feeds', 'Nothing downstream. The statements in this export are the case selected at export.'),
  ],
  checks: [
    G('inputs', 'The balance sheet, both cash flow methods, the reconciliation bridge and the revenue advisories.'),
    G('logic', 'Three identities, each within a relative tolerance of its peak: the balance sheet balances, cash flow closing cash equals balance sheet cash, and Direct net cash flow equals Indirect. The reconciliation bridge\'s Unexplained residue is a fourth. NOTE rows are advisories whose figure measures the situation described, not a failure.'),
    G('feeds', 'Nothing. The checks are the audit trail: when every check passes, the export is internally consistent and ties to the platform.'),
  ],
};

/**
 * A PROJECT WITHOUT A FUND READS NO FUND ROWS. Two guides name fund statement
 * rows ("Total Fund Management Fee", "Fund Management and Other Expenses"),
 * which a project with the fund layer off does not have; the report promises
 * no fund text on such a project (verify-fund-pdf, toggle OFF). These are the
 * same sentences with the fund steps taken out.
 */
const FUND_OFF_GUIDES: Partial<Record<GuideId, GuideLine[]>> = {
  pl: [
    G('inputs', 'Recognised revenue and Cost of Sales from Revenue, opex from Opex, D&A from Schedules, interest, the disposal gain, and the zakat or tax rate with its disposal-gain toggle.'),
    G('logic', 'Revenue - Cost of Sales = gross profit; - operating expenses = EBITDA. EBITDA - D&A = EBIT; - interest expensed (construction interest is capitalised, not expensed) + gain on disposal = profit before zakat or tax; - zakat or tax (charged excluding the disposal gain unless the toggle includes it) = profit after tax. The subtotals are the engine\'s own figures, never recomputed. A phase view stops at EBITDA.'),
    TAB_GUIDES.pl[2],
  ],
  cashflow: [
    G('inputs', 'Collections and escrow from Revenue, opex paid from Opex, zakat or tax paid, capex and disposal proceeds, and drawdowns, repayments, interest and dividends from Financing.'),
    G('logic', 'Direct: cash collected - opex paid - zakat or tax = cash flow from operations; - capex paid in cash (in-kind land shown as a matched pair that nets to zero) + disposal proceeds at the exit = cash flow from investing; + equity and debt drawn - principal, interest and dividends = cash flow from financing. Indirect: profit after tax + D&A - gain on disposal +/- working capital movements = the same cash flow from operations. Closing cash = opening + net cash flow, and both methods must agree every period. A phase view shows operations and investing only.'),
    TAB_GUIDES.cashflow[2],
  ],
};

/** Where NPV is, said without naming a Case Comparison a one-case project does not print. */
const NPV_NOTE_ONE_CASE = 'NPV is not a headline figure here: IRR / MOIC and the Development Economics lead, and NPV (FCFF, at the discount rate) is reported per case once scenario cases are compared.';

/**
 * The guide for a subject on THIS project: the fund-off wording where the fund
 * layer is off, and an NPV sentence that points at no Case Comparison where
 * there is only one case (a pointer must name a table the document prints).
 */
export function tabGuide(id: GuideId, ctx: { fundOn: boolean; caseComparison: boolean }): GuideLine[] {
  const lines = !ctx.fundOn && FUND_OFF_GUIDES[id] ? FUND_OFF_GUIDES[id]! : TAB_GUIDES[id];
  return ctx.caseComparison ? lines : lines.map((l) => ({ ...l, text: l.text.split(RETURNS_NPV_NOTE).join(NPV_NOTE_ONE_CASE) }));
}

export const TAB_GUIDE_HEADING = 'How this tab is calculated';
export const GUIDE_KIND_LABEL: Record<GuideLine['kind'], string> = { inputs: 'Inputs', logic: 'Calculation', feeds: 'Feeds' };
