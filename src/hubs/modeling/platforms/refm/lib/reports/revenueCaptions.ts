/**
 * revenueCaptions.ts (2026-10-05, export review item 25, Revenue)
 *
 * THE BASIS / CALCULATION SENTENCE FOR EACH REVENUE SECTION, ONCE. The
 * workbook printed one beside every revenue section heading and the PDF
 * printed the sections without them, so the per-line driver logic (how a
 * velocity becomes area sold, how a cohort pays, how a hotel's room nights
 * are built) was in the workbook only. Moved here verbatim from the workbook;
 * the workbook and the PDF both read it.
 *
 * Captions that already live in a shared builder (closing inventory, the sale
 * cohort grid, the receivable and unearned roll-forwards) are not repeated
 * here: both surfaces read them from their builder's `caption`.
 *
 * No em dashes in this file.
 */

export const REVENUE_CAPTIONS = {
  presalesVelocity: 'Pre-sales run during construction; the handover year is the last construction year.',
  salesDuringOperation: 'Sales during operation apply to units left after pre-sales, collected and recognised in the same year.',
  salePricePerYear: 'Base price per sub-unit (Table 5) x the indexation factor at each year: the rate the engine multiplies the sold area or units by.',
  cohortTerms: 'Drives collections: a downpayment in the year a cohort sells, then the balance in equal instalments.',
  recognitionOverTime: 'Over-Time: percent of each cohort recognised per project year.',
  pricePerSqm: 'Price per sqm[su, y] = base price per sqm x indexation factor at year y. A sub-unit sold by units is priced per sqm as its price per unit over the area one unit counts, so area sold x price = revenue on every row. Rates at full scale; a price does not sum.',
  recognitionSummary: 'Pre-Sales Recognised = column sum of 3a; Sales During Operation recognise in the same period; Total = P&L revenue per year.',
  cashMatrix: 'Rows are sale years, columns the years that cohort pays.',
  cashSummary: 'Pre-Sales Cash = column sum of 4a; Sales During Operation are collected in the same period; Total = cash from revenue per year.',
  operateDrivers: 'Available Room Nights = Keys x Days/Year; Occupied Room Nights = ARN x Occupancy; Guests = ORN x Guests/Room.',
  operateRevenue: 'Rooms = ORN x ADR (per sub-unit, then summed); F&B and Other follow their mode. Recognition = cash = revenue in the same period.',
  leaseDrivers: 'Occupied Lease Area = GLA x Occupancy; Indexed Rate = Base Rate x Rent Indexation Factor; Revenue = Occupied Area x Indexed Rate.',
  leaseRevenue: 'Revenue = Occupied Area x Indexed Rate (per zone, then summed). Recognition = cash = revenue in the same period.',
  escrowHeld: 'Held = pre-sales cash x the effective held %, only through each line\'s held-until year.',
  escrowBalance: 'Opening + Additions - Release = Closing; closing returns to zero once every line has released.',
  escrowCashImpact: 'What Module 4 deducts (held) and adds back (release); the net sums to zero over the horizon.',
} as const;

/** 1a: the share of inventory sold, in the line's own inventory unit. */
export function shareSoldCaption(invLower: string): string {
  return `Sold over total inventory per row and year, after the cap at what was still unsold and rounding to whole ${invLower}; the Total column is the lifetime share sold.`;
}
/** 1b: area or units sold. */
export function soldCaption(invLower: string): string {
  return `Sold = velocity x sub-unit inventory, capped at what is still unsold; whole ${invLower} per step and the exact remainder on the last.`;
}
/** 2b: revenue per sub-unit. */
export function revenueCaption(invLabel: string): string {
  return `Revenue = ${invLabel.toLowerCase()} sold x base rate x indexation factor at the year.`;
}
/** 3a: the recognition vintage matrix. */
export function recognitionMatrixCaption(handoverYear: number | string): string {
  return `Rows = cohort sale year, columns = year recognised; handover resolves to ${handoverYear}. Row sum = cohort sales value; column sum = recognition per year.`;
}
/** The recognition method, as the line states it. */
export function recognitionCaption(
  rec: { method?: string; pointInTimeYear?: string; pointInTimeCustomYear?: number } | undefined,
  handoverYear: number | string,
): string {
  if (rec?.method === 'over_time') return REVENUE_CAPTIONS.recognitionOverTime;
  const anchor = rec?.pointInTimeYear ?? 'handover';
  return anchor === 'handover'
    ? `Point-in-Time, at handover (${handoverYear}): every pre-sales cohort recognises in full at handover; sales during operation recognise in their own sale year.`
    : anchor === 'sale_year' ? 'Point-in-Time, at sale year: each cohort recognises in full in the year it is sold.'
      : `Point-in-Time, at custom year ${rec?.pointInTimeCustomYear ?? handoverYear}: every pre-sales cohort recognises in full in that year.`;
}
