/**
 * reMetricTiles.ts (2026-10-05, export review item 26)
 *
 * THE RE METRICS DETAIL TILES, ONCE. The screen, the workbook and the PDF each
 * listed these by hand. The PDF's own grouping dropped Stabilised NOI, the
 * stabilisation year, Cost to Value, Max Negative Cash Flow and the whole
 * Funding Mix row, and the screen and workbook already disagreed on captions
 * (Development Margin read "profit / GDV" on two surfaces and "surplus after
 * finance / GDV" on a third). Every surface now maps these groups, in the
 * screen's order and words, and formats the values in its own way.
 *
 * Values are TYPED, never pre-formatted: a surface owns its display scale.
 * Coverage ratios come from the covenant series and reducers the covenant table
 * reads, so a tile cannot disagree with the row it summarises.
 *
 * No em dashes in this file.
 */
import type { ReturnsSnapshot } from '../returns-resolvers';
import { covenantSeries, reduceAvg, reduceWorst, type CovenantInputs } from '../covenants';
import { METRIC_LABELS, METRIC_CAPTIONS, capRateAtExitCaption } from './metricCaptions';

export type ReMetricValue =
  | { kind: 'money'; v: number | null }
  | { kind: 'pct'; v: number | null }
  | { kind: 'mult'; v: number | null }
  | { kind: 'text'; v: string };

export interface ReMetricTile {
  label: string;
  value: ReMetricValue;
  /** Caption. Absent on a money tile means "in the project currency", which a
   *  surface may print. */
  sub?: string;
  tone?: 'good' | 'bad';
}

export interface ReMetricTileGroup {
  title: string;
  /** The screen opens these sections by default. */
  defaultOpen: boolean;
  tiles: ReMetricTile[];
}

/** The covenant inputs every RE Metrics surface derives its ratios from. */
export function reMetricCovenantInputs(rs: ReturnsSnapshot, debtOutstandingPerPeriod: number[]): CovenantInputs {
  const m = rs.result.realEstate;
  return {
    dscrPerPeriod: m.dscrPerPeriod,
    icrPerPeriod: m.icrPerPeriod,
    noiPerPeriod: rs.noiPerPeriod,
    debtOutstandingPerPeriod,
    gdvValue: rs.developmentEconomics.gdv,
    ltvAtExit: m.ltvAtExit,
  };
}

export const RE_METRIC_GROUP_TITLES = {
  coverage: 'Coverage and profitability detail',
  development: 'Development economics',
  income: 'Income and exit profile',
  funding: 'Funding mix',
} as const;

export function buildReMetricDetailGroups(rs: ReturnsSnapshot, debtOutstandingPerPeriod: number[]): ReMetricTileGroup[] {
  const m = rs.result.realEstate, de = rs.developmentEconomics, ee = rs.equityExposure, fm = rs.fundingMix;
  const cov = reMetricCovenantInputs(rs, debtOutstandingPerPeriod);
  const money = (v: number | null | undefined): ReMetricValue => ({ kind: 'money', v: v ?? null });
  const pct = (v: number | null | undefined): ReMetricValue => ({ kind: 'pct', v: v ?? null });
  const mult = (v: number | null | undefined): ReMetricValue => ({ kind: 'mult', v: v ?? null });
  const sign = (v: number | null | undefined): 'good' | 'bad' | undefined => (v == null ? undefined : v >= 0 ? 'good' : 'bad');
  return [
    {
      title: RE_METRIC_GROUP_TITLES.coverage, defaultOpen: true,
      tiles: [
        { label: 'Avg DSCR', value: mult(reduceAvg(covenantSeries('dscr', cov))), sub: METRIC_CAPTIONS.dscrAvg },
        { label: 'Min Interest Cover', value: mult(reduceWorst(covenantSeries('icr', cov), 'min')), sub: 'worst yr · EBITDA / interest' },
        { label: 'Debt Yield', value: pct(reduceWorst(covenantSeries('debt_yield', cov), 'min')), sub: 'worst operating yr · NOI / debt' },
        { label: 'Avg Cash-on-Cash', value: pct(m.cashOnCashAvg), sub: 'cash yield on equity' },
        { label: 'Cap Rate at Exit', value: pct(m.capRateAtExit), sub: capRateAtExitCaption(rs) },
        { label: 'Profit on Cost', value: pct(m.profitOnCost), sub: '(revenue - cost) / cost' },
        { label: 'Development Spread', value: pct(m.developmentSpread), sub: METRIC_CAPTIONS.developmentSpread },
        { label: 'Max Negative Cash Flow', value: money(ee.maxNegativeCumulativeCF), sub: 'peak FCFE outflow', tone: 'bad' },
      ],
    },
    {
      title: RE_METRIC_GROUP_TITLES.development, defaultOpen: true,
      tiles: [
        { label: 'Gross Development Value', value: money(de.gdv), sub: 'GDV' },
        { label: 'Total Development Cost', value: money(de.totalDevelopmentCost) },
        { label: 'Total Financing Cost', value: money(de.totalFinancingCost) },
        { label: METRIC_LABELS.developmentSurplusBefore, value: money(de.profitBeforeFinancing), sub: METRIC_CAPTIONS.developmentSurplusBefore, tone: sign(de.profitBeforeFinancing) },
        { label: METRIC_LABELS.developmentSurplusAfter, value: money(de.profitAfterFinancing), sub: METRIC_CAPTIONS.developmentSurplusAfter, tone: sign(de.profitAfterFinancing) },
        { label: 'Development Margin', value: pct(de.developmentMargin), sub: METRIC_CAPTIONS.developmentMargin, tone: de.developmentMargin != null && de.developmentMargin > 0 ? 'good' : undefined },
        { label: 'Cost to Value', value: pct(de.costToValue), sub: 'dev cost / GDV' },
      ],
    },
    {
      title: RE_METRIC_GROUP_TITLES.income, defaultOpen: false,
      tiles: [
        { label: 'Stabilised NOI', value: money(rs.stabilisedNOI) },
        { label: 'Exit NOI', value: money(rs.exitNOI), sub: `year ${rs.exitYearLabel}` },
        { label: 'Stabilisation Year', value: { kind: 'text', v: rs.stabilization.stabilizationYear != null ? String(rs.stabilization.stabilizationYear) : 'n/a' }, sub: 'NOI reaches 95% of stable' },
        { label: 'Stabilised Yield on Cost', value: pct(rs.stabilization.stabilisedYieldOnCost), sub: METRIC_CAPTIONS.yieldOnCost },
        { label: 'Exit Cap Rate', value: pct(m.capRateAtExit), sub: capRateAtExitCaption(rs) },
        { label: 'Terminal Enterprise Value', value: money(rs.terminalEnterpriseValue) },
        { label: 'Terminal Equity Value', value: money(rs.terminalEquityValue), sub: 'EV less debt + cash' },
      ],
    },
    {
      title: RE_METRIC_GROUP_TITLES.funding, defaultOpen: false,
      tiles: [
        { label: 'Debt', value: pct(fm.debtPct), sub: '% of total sources' },
        { label: 'Cash Equity', value: pct(fm.cashEquityPct), sub: 'existing + new cash' },
        { label: 'In-Kind Equity', value: pct(fm.inKindEquityPct), sub: 'contributed land' },
        { label: 'Customer Funding', value: pct(fm.customerFundingPct), sub: 'pre-sales collections' },
      ],
    },
  ];
}
