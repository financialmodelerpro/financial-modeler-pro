/**
 * saleCohortReports.ts (2026-08-19)
 *
 * THE SALE COHORT TERMS, AS ONE SET OF ROWS, for every surface that prints
 * inputs: the Module 2 screen's neighbours, the Excel Inputs tab and the PDF
 * Inputs section.
 *
 * Why it exists: when the cohort rule replaced `cashPaymentProfile` as the
 * driver of pre-sales collections, three separate export sites were still
 * printing that profile under a plain heading, which would have presented a
 * superseded input as a live one. Each of those sites hand-builds its own rows,
 * so without a shared builder the terms would have been written out three times
 * and drifted (the failure recorded against the FCFF/FCFE row lists, which were
 * four hand-maintained copies until one of them diverged).
 *
 * Formatting stays per-surface. STRUCTURE is what must not drift.
 *
 * No em dashes in this file.
 */

import { resolveDownpayment, hasAnyDownpayment, DEFAULT_INSTALMENT_YEARS } from '@/src/core/calculations/revenue/cohortTerms';
import type { Asset, Phase } from '../state/module1-types';

export interface SaleCohortDownpaymentCell {
  /** Absolute calendar year of the sale cohort. */
  year: number;
  /** Fraction, so a caller can apply its own percent format. */
  value: number;
  /** Whether the user set this year, it was carried forward, or neither. */
  source: 'set' | 'inherited' | 'unset';
}

export interface SaleCohortTermsBlock {
  assetId: string;
  assetName: string;
  /** The instalment allowance actually in force, default included. */
  instalmentYears: number;
  /** True when instalments must finish by handover (the default). */
  stopAtHandover: boolean;
  /** Absolute calendar year of handover, for the caption. */
  handoverYear: number;
  /** One entry per sale year across the construction window. */
  downpayments: SaleCohortDownpaymentCell[];
  /** True when the user has set no downpayment anywhere on this asset, so
   *  every cohort is being treated as taking no deposit. Worth stating,
   *  because it is a big number and it is easy to arrive at by doing nothing. */
  noDownpaymentSet: boolean;
}

/*
 * CASH_PROFILE_SUPERSEDED_LABEL and _NOTE lived here from 2026-08-19 to
 * 2026-08-20. They marked the retired cash payment profile wherever it was
 * still printed, which was the honest thing to do while the cohort rule was
 * new and a reader might still be looking for the old input.
 *
 * Once the rule was verified, the block was removed from the Module 2 sell
 * panel and from all three export surfaces: a large explanation of something
 * that drives nothing, sitting between two live sections, is noise. There is
 * nothing left to label, so the constants went with it.
 *
 * THE STORED FIELD IS UNTOUCHED: deprecated, not deleted, so no schedule a
 * user entered is lost and the legacy migration still carries it. Nothing
 * reads it to compute a number. See CashPaymentProfile in
 * core/calculations/revenue/types.ts.
 */

/**
 * Build the block for one Sell asset, or null when the asset has no sell
 * config at all.
 *
 * Deliberately takes the raw asset and its phase rather than a revenue
 * snapshot: this prints INPUTS, and an inputs table must show what the user
 * typed even on a project whose engine run failed.
 */
export function buildSaleCohortTermsBlock(
  asset: Asset,
  phase: Phase | undefined,
  projectStartYear: number,
): SaleCohortTermsBlock | null {
  const sell = asset.revenue?.sell;
  if (!sell) return null;

  const phaseStartYear = phase?.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const cp = Math.max(0, phase?.constructionPeriods ?? 0);
  // Handover is the LAST construction year, which is the platform's standing
  // convention (see resolveHandoverYear). Not the first operating year.
  const handoverYear = phaseStartYear + Math.max(0, cp - 1);

  const downpayments: SaleCohortDownpaymentCell[] = [];
  for (let k = 0; k < cp; k++) {
    const r = resolveDownpayment(sell.downpaymentByPhase, k);
    downpayments.push({ year: phaseStartYear + k, value: r.value, source: r.source });
  }

  return {
    assetId: asset.id,
    assetName: asset.name,
    instalmentYears: sell.maxInstalmentYears ?? DEFAULT_INSTALMENT_YEARS,
    stopAtHandover: sell.instalmentsStopAtHandover ?? true,
    handoverYear,
    downpayments,
    noDownpaymentSet: !hasAnyDownpayment(sell.downpaymentByPhase),
  };
}

/** The rule in one line, with this asset's own numbers in it. */
export function saleCohortRuleText(block: SaleCohortTermsBlock): string {
  const run = block.stopAtHandover
    ? `the lesser of ${block.instalmentYears} years and the years remaining to handover (${block.handoverYear})`
    : `${block.instalmentYears} years, even where that runs past handover (${block.handoverYear})`;
  const base = `A cohort selling in year N pays its downpayment in year N and the balance in equal instalments over ${run}. A cohort selling at or after handover pays in full in its own year.`;
  return block.noDownpaymentSet
    ? `${base} No downpayment is set on this asset, so every cohort is treated as taking no deposit.`
    : base;
}

/**
 * THE SALE COHORT GRID (2026-08-20, restructure Step 4).
 *
 * Sale years down, calendar years across, which is what a cohort matrix has
 * always been. The engine already produces the cells: `cashVintageMatrix` is
 * `matrix[saleYear][collectionYear]`, and since Step 3 it IS the collections
 * series (the series is its column sums), so nothing here recomputes anything.
 *
 * WHAT THIS ADDS is the context a reader needs to check it: the downpayment
 * percentage that produced the row, the gross development value the row is a
 * schedule for, the row total, and whether the two agree. A grid of numbers
 * with no way to tell whether a row is complete is a grid nobody can audit.
 *
 * EXTENDS THE EXISTING MATRIX RATHER THAN ADDING A SECOND ONE. All three
 * surfaces already render a cash vintage matrix; a parallel grid of the same
 * quantity is the duplication this codebase keeps paying for.
 *
 * Pure presentation over the engine's own output. No arithmetic beyond summing
 * a row that the engine built.
 */
export interface SaleCohortGridRow {
  /** Absolute calendar year this cohort sold in. */
  saleYear: number;
  /** Downpayment fraction in force, and where it came from. */
  downpayment: number;
  downpaymentSource: 'set' | 'carried' | 'project_default' | 'not_set';
  /** The cohort's gross development value: what it sold for. */
  gdv: number;
  /** Cash collected from THIS cohort in each calendar year, project axis. */
  cells: number[];
  /** Sum of `cells`. Must equal `gdv`. */
  rowTotal: number;
  /** rowTotal - gdv. Zero to the currency unit on a correct model. */
  checkResidue: number;
  ok: boolean;
  /** True when the cohort sold at or after handover, so it pays in full in its
   *  own year and the downpayment is not consulted. Worth marking: a reader
   *  seeing 100% in one cell needs to know it is the rule, not an input. */
  paysInFull: boolean;
}

export interface SaleCohortGrid {
  assetId: string;
  assetName: string;
  handoverYear: number;
  yearLabels: number[];
  rows: SaleCohortGridRow[];
  /** Column sums: total collections per calendar year across every cohort. */
  columnTotals: number[];
  gdvTotal: number;
  collectedTotal: number;
  /** True when every row foots and the totals agree. */
  ok: boolean;
}

/** A cent, in model units. Anything under this is float noise, not a defect. */
const GRID_TOL = 0.005;

export function buildSaleCohortGrid(
  asset: Asset,
  phase: Phase | undefined,
  projectStartYear: number,
  yearLabels: number[],
  projectDefault: number | undefined,
  sell: {
    cashVintageMatrix?: number[][];
    presalesRevenuePerPeriod?: number[];
    postSalesRevenuePerPeriod?: number[];
    postSalesCashPerPeriod?: number[];
  } | undefined,
): SaleCohortGrid | null {
  if (!sell?.cashVintageMatrix) return null;
  const n = yearLabels.length;
  const phaseStartYear = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
  const cp = Math.max(0, phase?.constructionPeriods ?? 0);
  const handoverYear = phaseStartYear + Math.max(0, cp - 1);

  const pre = sell.presalesRevenuePerPeriod ?? [];
  const post = sell.postSalesRevenuePerPeriod ?? [];
  const postCash = sell.postSalesCashPerPeriod ?? [];

  const rows: SaleCohortGridRow[] = [];
  const columnTotals = new Array<number>(n).fill(0);

  for (let s = 0; s < n; s++) {
    const saleYear = projectStartYear + s;
    const gdvPre = pre[s] ?? 0;
    const gdvPost = post[s] ?? 0;
    const gdv = gdvPre + gdvPost;
    if (Math.abs(gdv) < GRID_TOL) continue;   // a year with no sale is not a cohort

    // The engine's own cells for the pre-sales half. A POST-handover cohort has
    // no vintage row (it never enters the matrix, by the long-standing
    // operating-sales convention), so its cash is placed in its own sale year,
    // which is exactly what the engine does with it.
    const cells = new Array<number>(n).fill(0);
    const vintage = sell.cashVintageMatrix[s] ?? [];
    for (let c = 0; c < n; c++) cells[c] += vintage[c] ?? 0;
    if (Math.abs(gdvPost) >= GRID_TOL) cells[s] += postCash[s] ?? gdvPost;

    const dp = resolveDownpayment(asset.revenue?.sell?.downpaymentByPhase, s - (phaseStartYear - projectStartYear));
    const hasOwn = hasAnyDownpayment(asset.revenue?.sell?.downpaymentByPhase);
    const source: SaleCohortGridRow['downpaymentSource'] = hasOwn
      ? (dp.source === 'set' ? 'set' : 'carried')
      : (projectDefault !== undefined ? 'project_default' : 'not_set');
    const downpayment = hasOwn ? dp.value : (projectDefault ?? 0);

    const rowTotal = cells.reduce((a, b) => a + b, 0);
    for (let c = 0; c < n; c++) columnTotals[c] += cells[c];

    rows.push({
      saleYear,
      downpayment,
      downpaymentSource: source,
      gdv,
      cells,
      rowTotal,
      checkResidue: rowTotal - gdv,
      ok: Math.abs(rowTotal - gdv) < GRID_TOL,
      paysInFull: saleYear >= handoverYear,
    });
  }

  const gdvTotal = rows.reduce((a, r) => a + r.gdv, 0);
  const collectedTotal = columnTotals.reduce((a, b) => a + b, 0);
  return {
    assetId: asset.id,
    assetName: asset.name,
    handoverYear,
    yearLabels,
    rows,
    columnTotals,
    gdvTotal,
    collectedTotal,
    ok: rows.every((r) => r.ok) && Math.abs(gdvTotal - collectedTotal) < GRID_TOL,
  };
}

/** The caption, stating what the grid is and what the check column proves. */
export function saleCohortGridCaption(grid: SaleCohortGrid): string {
  return 'Rows are sale years, columns are the years that cohort pays. Each row is one cohort on its own terms: '
    + `a downpayment in the year it sells and the balance in equal instalments, cut off at handover (${grid.handoverYear}). `
    + `A cohort selling at or after handover pays in full in its own year. The check column is the row total less the cohort's `
    + 'own gross development value, so every row must read zero.';
}
