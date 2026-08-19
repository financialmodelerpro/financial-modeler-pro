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

/** The one sentence every surface uses to mark the retired input, so the
 *  wording cannot drift between the screen, the workbook and the PDF. */
export const CASH_PROFILE_SUPERSEDED_LABEL = 'Cash payment % (superseded, no longer drives collections)';

export const CASH_PROFILE_SUPERSEDED_NOTE =
  'The cash payment profile was one schedule shared by every sale year. Collections now follow the sale cohort terms below, where each sale year carries its own downpayment and instalment run. The profile is retained so no entered data is lost, and nothing reads it.';

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
