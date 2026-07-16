/**
 * bindings.ts (REFM Module 7, IC Presentation Builder: the model link layer)
 *
 * The registry that turns a binding KEY on a slide object into a live value from
 * the model. This is the file that delivers "the user never recreates model
 * outputs by hand" and "broken links are never allowed".
 *
 * How it holds together:
 *
 *  - A slide object stores a key ('headline.projectIrr'), never a number. There
 *    is nowhere for a stale figure to hide, because no figure is ever stored.
 *  - Every key is a member of a closed union, so a typo is a compile error and
 *    the Insert menu can enumerate the catalogue instead of hardcoding a list.
 *  - Resolution reads ICReportModel, which is assembled by buildICReportModel
 *    from the already-computed returns + financials snapshots. Modules 1-6
 *    change, the snapshot recomputes, every bound object follows on the next
 *    render. No sync step, no cache to invalidate.
 *  - A resolver that finds no data returns { available: false }. The renderer
 *    then paints a visible unlinked state. A binding is therefore either right
 *    or obviously absent, never quietly wrong. That is what "no broken links"
 *    has to mean in practice.
 *
 * Formatting is injected (DeckFmt) rather than baked in, so the same key renders
 * "SAR 14,055.0m" on a millions deck and "SAR 14,055,000'000" on a thousands
 * deck without the registry knowing which surface is asking.
 *
 * No em dashes in this file.
 */

import type { ICReportModel } from '../icReport';
import type { CaseComparisonReport } from '../caseComparisonReport';
import type { ChartKind } from './types';
import { DECK_THEME, CHART_SERIES, signColor } from './theme';

// ── Formatting contract ─────────────────────────────────────────────────────

export interface DeckFmt {
  /** Money at the deck's scale, e.g. "14,055.0". Unit is supplied separately. */
  money: (v: number | null | undefined) => string;
  /** The active unit label, e.g. "SAR m". */
  moneyUnit: string;
  pct: (v: number | null | undefined) => string;
  mult: (v: number | null | undefined) => string;
  int: (v: number | null | undefined) => string;
  /** Raw number at deck scale, for chart axes. */
  scaleValue: (v: number) => number;
}

/** A resolved binding. `available:false` drives the unlinked state. */
export type Resolved<T> = { available: true; value: T } | { available: false; reason: string };

const ok = <T>(value: T): Resolved<T> => ({ available: true, value });
const missing = <T>(reason: string): Resolved<T> => ({ available: false, reason });

// ── Metric bindings (KPI tiles + dynamic text) ───────────────────────────────

export type MetricBindingKey =
  // Returns
  | 'headline.projectIrr' | 'headline.equityIrr' | 'headline.distributedEquityIrr'
  | 'headline.projectMoic' | 'headline.equityMoic' | 'headline.equityMultiple'
  | 'headline.terminalEquity' | 'returns.npv'
  // Development economics
  | 'devEconomics.gdv' | 'devEconomics.tdc' | 'devEconomics.financingCost'
  | 'devEconomics.profitBeforeFinancing' | 'devEconomics.profitAfterFinancing'
  | 'devEconomics.developmentMargin' | 'devEconomics.costToValue'
  // Capital + financing
  | 'capital.totalEquity' | 'capital.peakEquity' | 'capital.peakDebt'
  | 'capital.remainingDebtAtExit' | 'capital.debtPct' | 'capital.cashEquityPct'
  | 'capital.inKindEquityPct' | 'capital.customerFundingPct'
  | 'capital.totalSources' | 'capital.totalUses'
  | 'financing.existingDebt' | 'financing.newDebt' | 'financing.tenorYears'
  | 'financing.paydownPct' | 'financing.customerCollections' | 'financing.minCashReserve'
  | 'ask.equityCommitment' | 'ask.existingEquity' | 'ask.inKindEquity'
  // Real estate metrics
  | 'reMetrics.yieldOnCost' | 'reMetrics.capRateAtExit' | 'reMetrics.profitOnCost'
  | 'reMetrics.cashOnCashAvg' | 'reMetrics.dscrMin' | 'reMetrics.ltvAtExit'
  // Operating
  | 'operating.peakNoi'
  // Programme + programme facts
  | 'overview.landAreaSqm' | 'overview.totalBua' | 'overview.phaseCount'
  | 'overview.durationYears' | 'overview.startYear' | 'overview.exitYear'
  | 'assetMix.totalUnits' | 'assetMix.totalBua' | 'programme.debtRepaidYear';

export type MetricFormat = 'money' | 'pct' | 'mult' | 'int' | 'year' | 'years' | 'area';

export interface MetricDef {
  key: MetricBindingKey;
  label: string;
  /** Insert-menu grouping. */
  group: 'Returns' | 'Development economics' | 'Capital & financing' | 'RE metrics' | 'Operating' | 'Programme';
  format: MetricFormat;
  get: (m: ICReportModel) => number | null;
  /** Optional sub-label under the value, e.g. the unit or a qualifier. */
  sub?: (m: ICReportModel, f: DeckFmt) => string;
}

/** NPV is not a headline field: it lives in the case-comparison columns. Pull it
 *  from the base case so a single-case project still shows a project NPV. */
const baseNpv = (sc: CaseComparisonReport | null): number | null => {
  if (!sc) return null;
  const col = sc.columns.find((c) => c.id === sc.baseId) ?? sc.columns[0];
  const v = col?.values?.['NPV (FCFF)'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const M = (
  key: MetricBindingKey,
  label: string,
  group: MetricDef['group'],
  format: MetricFormat,
  get: MetricDef['get'],
  sub?: MetricDef['sub'],
): MetricDef => ({ key, label, group, format, get, sub });

const unit = (_m: ICReportModel, f: DeckFmt): string => f.moneyUnit;

export const METRIC_BINDINGS: Record<MetricBindingKey, MetricDef> = {
  // Returns
  'headline.projectIrr':            M('headline.projectIrr', 'Project IRR', 'Returns', 'pct', (m) => m.headline.projectIrr, () => 'FCFF, unlevered'),
  'headline.equityIrr':             M('headline.equityIrr', 'Equity IRR', 'Returns', 'pct', (m) => m.headline.equityIrr, () => 'FCFE, levered'),
  'headline.distributedEquityIrr':  M('headline.distributedEquityIrr', 'Distributed IRR', 'Returns', 'pct', (m) => m.headline.distributedEquityIrr, () => 'Dividends'),
  'headline.projectMoic':           M('headline.projectMoic', 'Project MOIC', 'Returns', 'mult', (m) => m.headline.projectMoic),
  'headline.equityMoic':            M('headline.equityMoic', 'Equity MOIC', 'Returns', 'mult', (m) => m.headline.equityMoic),
  'headline.equityMultiple':        M('headline.equityMultiple', 'Equity Multiple', 'Returns', 'mult', (m) => m.headline.equityMultiple),
  'headline.terminalEquity':        M('headline.terminalEquity', 'Exit Equity Value', 'Returns', 'money', (m) => m.headline.terminalEquity, unit),
  'returns.npv':                    M('returns.npv', 'NPV', 'Returns', 'money', (m) => baseNpv(m.scenarios), unit),

  // Development economics
  'devEconomics.gdv':                    M('devEconomics.gdv', 'Gross Development Value', 'Development economics', 'money', (m) => m.devEconomics.gdv, unit),
  'devEconomics.tdc':                    M('devEconomics.tdc', 'Total Development Cost', 'Development economics', 'money', (m) => m.devEconomics.tdc, unit),
  'devEconomics.financingCost':          M('devEconomics.financingCost', 'Financing Cost', 'Development economics', 'money', (m) => m.devEconomics.financingCost, unit),
  'devEconomics.profitBeforeFinancing':  M('devEconomics.profitBeforeFinancing', 'Profit before Financing', 'Development economics', 'money', (m) => m.devEconomics.profitBeforeFinancing, unit),
  'devEconomics.profitAfterFinancing':   M('devEconomics.profitAfterFinancing', 'Profit after Financing', 'Development economics', 'money', (m) => m.devEconomics.profitAfterFinancing, unit),
  'devEconomics.developmentMargin':      M('devEconomics.developmentMargin', 'Development Margin', 'Development economics', 'pct', (m) => m.devEconomics.developmentMargin, () => 'Profit / GDV'),
  'devEconomics.costToValue':            M('devEconomics.costToValue', 'Cost to Value', 'Development economics', 'pct', (m) => m.devEconomics.costToValue, () => 'TDC / GDV'),

  // Capital + financing
  'capital.totalEquity':          M('capital.totalEquity', 'Total Equity', 'Capital & financing', 'money', (m) => m.capital.totalEquity, unit),
  'capital.peakEquity':           M('capital.peakEquity', 'Peak Equity', 'Capital & financing', 'money', (m) => m.capital.peakEquity, unit),
  'capital.peakDebt':             M('capital.peakDebt', 'Peak Debt', 'Capital & financing', 'money', (m) => m.capital.peakDebt, unit),
  'capital.remainingDebtAtExit':  M('capital.remainingDebtAtExit', 'Debt at Exit', 'Capital & financing', 'money', (m) => m.capital.remainingDebtAtExit, unit),
  'capital.debtPct':              M('capital.debtPct', 'Debt Share', 'Capital & financing', 'pct', (m) => m.capital.debtPct, () => 'of total sources'),
  'capital.cashEquityPct':        M('capital.cashEquityPct', 'Cash Equity Share', 'Capital & financing', 'pct', (m) => m.capital.cashEquityPct, () => 'of total sources'),
  'capital.inKindEquityPct':      M('capital.inKindEquityPct', 'In-Kind Equity Share', 'Capital & financing', 'pct', (m) => m.capital.inKindEquityPct, () => 'of total sources'),
  'capital.customerFundingPct':   M('capital.customerFundingPct', 'Customer Funding Share', 'Capital & financing', 'pct', (m) => m.capital.customerFundingPct, () => 'of total sources'),
  'capital.totalSources':         M('capital.totalSources', 'Total Sources', 'Capital & financing', 'money', (m) => m.capital.totalSources, unit),
  'capital.totalUses':            M('capital.totalUses', 'Total Uses', 'Capital & financing', 'money', (m) => m.capital.totalUses, unit),
  'financing.existingDebt':       M('financing.existingDebt', 'Existing Debt', 'Capital & financing', 'money', (m) => m.financing.existingDebt, unit),
  'financing.newDebt':            M('financing.newDebt', 'New Debt', 'Capital & financing', 'money', (m) => m.financing.newDebt, unit),
  'financing.tenorYears':         M('financing.tenorYears', 'Debt Tenor', 'Capital & financing', 'years', (m) => m.financing.tenorYears),
  'financing.paydownPct':         M('financing.paydownPct', 'Debt Paydown', 'Capital & financing', 'pct', (m) => m.financing.paydownPct, (m) => (m.programme.debtRepaidYear ? `fully repaid by ${m.programme.debtRepaidYear}` : 'by exit')),
  'financing.customerCollections':M('financing.customerCollections', 'Customer Collections', 'Capital & financing', 'money', (m) => m.financing.customerCollections, unit),
  'financing.minCashReserve':     M('financing.minCashReserve', 'Min Cash Reserve', 'Capital & financing', 'money', (m) => m.financing.minCashReserve, unit),
  'ask.equityCommitment':         M('ask.equityCommitment', 'Equity Commitment', 'Capital & financing', 'money', (m) => m.ask.equityCommitment, unit),
  'ask.existingEquity':           M('ask.existingEquity', 'Existing Equity', 'Capital & financing', 'money', (m) => m.ask.existingEquity, unit),
  'ask.inKindEquity':             M('ask.inKindEquity', 'In-Kind Equity', 'Capital & financing', 'money', (m) => m.ask.inKindEquity, unit),

  // RE metrics
  'reMetrics.yieldOnCost':    M('reMetrics.yieldOnCost', 'Yield on Cost', 'RE metrics', 'pct', (m) => m.reMetrics.yieldOnCost),
  'reMetrics.capRateAtExit':  M('reMetrics.capRateAtExit', 'Cap Rate at Exit', 'RE metrics', 'pct', (m) => m.reMetrics.capRateAtExit),
  'reMetrics.profitOnCost':   M('reMetrics.profitOnCost', 'Profit on Cost', 'RE metrics', 'pct', (m) => m.reMetrics.profitOnCost),
  'reMetrics.cashOnCashAvg':  M('reMetrics.cashOnCashAvg', 'Cash on Cash', 'RE metrics', 'pct', (m) => m.reMetrics.cashOnCashAvg, () => 'average'),
  'reMetrics.dscrMin':        M('reMetrics.dscrMin', 'Minimum DSCR', 'RE metrics', 'mult', (m) => m.reMetrics.dscrMin),
  'reMetrics.ltvAtExit':      M('reMetrics.ltvAtExit', 'LTV at Peak Debt', 'RE metrics', 'pct', (m) => m.reMetrics.ltvAtExit),

  // Operating
  'operating.peakNoi': M('operating.peakNoi', 'Peak NOI', 'Operating', 'money', (m) => (m.operating.hasData ? m.operating.peakNoi : null), unit),

  // Programme
  'overview.landAreaSqm':     M('overview.landAreaSqm', 'Land Area', 'Programme', 'area', (m) => m.overview.landAreaSqm),
  'overview.totalBua':        M('overview.totalBua', 'Total BUA', 'Programme', 'area', (m) => m.overview.totalBua),
  'overview.phaseCount':      M('overview.phaseCount', 'Phases', 'Programme', 'int', (m) => m.overview.phaseCount),
  'overview.durationYears':   M('overview.durationYears', 'Horizon', 'Programme', 'years', (m) => m.overview.durationYears),
  'overview.startYear':       M('overview.startYear', 'Start Year', 'Programme', 'year', (m) => m.overview.startYear),
  'overview.exitYear':        M('overview.exitYear', 'Exit Year', 'Programme', 'year', (m) => m.overview.exitYear),
  'assetMix.totalUnits':      M('assetMix.totalUnits', 'Total Units', 'Programme', 'int', (m) => m.assetMix.totalUnits),
  'assetMix.totalBua':        M('assetMix.totalBua', 'Asset BUA', 'Programme', 'area', (m) => m.assetMix.totalBua),
  'programme.debtRepaidYear': M('programme.debtRepaidYear', 'Debt Repaid', 'Programme', 'year', (m) => m.programme.debtRepaidYear),
};

export const METRIC_KEYS = Object.keys(METRIC_BINDINGS) as MetricBindingKey[];

/** Format a metric value per its declared format. The one place a metric turns
 *  into a string, so a KPI tile and a table cell can never disagree. */
export function formatMetric(def: MetricDef, v: number | null, f: DeckFmt): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  switch (def.format) {
    case 'money': return f.money(v);
    case 'pct':   return f.pct(v);
    case 'mult':  return f.mult(v);
    case 'int':   return f.int(v);
    case 'year':  return String(Math.round(v));
    case 'years': return `${f.int(v)} yrs`;
    case 'area':  return `${f.int(v)} sqm`;
    default:      return String(v);
  }
}

export interface ResolvedMetric { label: string; value: string; sub: string; raw: number | null; format: MetricFormat }

export function resolveMetric(key: MetricBindingKey, m: ICReportModel, f: DeckFmt): Resolved<ResolvedMetric> {
  const def = METRIC_BINDINGS[key];
  if (!def) return missing(`Unknown metric "${key}"`);
  const raw = def.get(m);
  if (raw === null || !Number.isFinite(raw)) {
    return missing(`${def.label} is not available in this model`);
  }
  return ok({ label: def.label, value: formatMetric(def, raw, f), sub: def.sub ? def.sub(m, f) : '', raw, format: def.format });
}

// ── Text bindings (dynamic strings) ─────────────────────────────────────────

export type TextBindingKey =
  | 'cover.projectName' | 'cover.location' | 'cover.asOf' | 'cover.preparedBy'
  | 'overview.country' | 'overview.strategyMix' | 'overview.fundingMethodLabel'
  | 'overview.phaseNames' | 'overview.sponsors' | 'overview.developers' | 'overview.investors'
  | 'deck.moneyUnit';

export interface TextBindingDef { key: TextBindingKey; label: string; get: (m: ICReportModel, f: DeckFmt) => string }

const names = (a: Array<{ name: string }>): string => a.map((p) => p.name).join(', ');

export const TEXT_BINDINGS: Record<TextBindingKey, TextBindingDef> = {
  'cover.projectName':            { key: 'cover.projectName', label: 'Project name', get: (m) => m.cover.projectName },
  'cover.location':               { key: 'cover.location', label: 'Location', get: (m) => m.cover.location },
  'cover.asOf':                   { key: 'cover.asOf', label: 'As-of date', get: (m) => m.cover.asOf },
  'cover.preparedBy':             { key: 'cover.preparedBy', label: 'Prepared by', get: (m) => names(m.cover.preparedBy) },
  'overview.country':             { key: 'overview.country', label: 'Country', get: (m) => m.overview.country },
  'overview.strategyMix':         { key: 'overview.strategyMix', label: 'Strategy mix', get: (m) => m.overview.strategyMix },
  'overview.fundingMethodLabel':  { key: 'overview.fundingMethodLabel', label: 'Funding method', get: (m) => m.overview.fundingMethodLabel },
  'overview.phaseNames':          { key: 'overview.phaseNames', label: 'Phase names', get: (m) => m.overview.phaseNames.join(', ') },
  'overview.sponsors':            { key: 'overview.sponsors', label: 'Sponsors', get: (m) => names(m.overview.sponsors) },
  'overview.developers':          { key: 'overview.developers', label: 'Developers', get: (m) => names(m.overview.developers) },
  'overview.investors':           { key: 'overview.investors', label: 'Investors', get: (m) => names(m.overview.investors) },
  'deck.moneyUnit':               { key: 'deck.moneyUnit', label: 'Money unit', get: (_m, f) => f.moneyUnit },
};

export const TEXT_BINDING_KEYS = Object.keys(TEXT_BINDINGS) as TextBindingKey[];

export function resolveText(key: TextBindingKey, m: ICReportModel, f: DeckFmt): Resolved<string> {
  const def = TEXT_BINDINGS[key];
  if (!def) return missing(`Unknown text binding "${key}"`);
  const v = def.get(m, f);
  return v && v.trim() ? ok(v) : missing(`${def.label} is empty in this model`);
}

// ── Chart bindings ──────────────────────────────────────────────────────────

export type ChartBindingKey =
  | 'chart.assetMix' | 'chart.costStack' | 'chart.revenueRecognition'
  | 'chart.debtBalance' | 'chart.exitMoic' | 'chart.scenarioIrr'
  | 'chart.scenarioNpv' | 'chart.sourcesMix' | 'chart.valueBridge'
  | 'chart.operatingNoi';

export interface ChartSeries { name: string; color?: string; values: Array<number | null> }
/** A resolved chart. `labels` are the category axis; `series` the plotted data.
 *  `axisUnit` is rendered on the value axis so a reader always knows the scale,
 *  which is what the old export got wrong with raw-currency axes. */
export interface ChartData {
  kind: ChartKind;
  labels: string[];
  series: ChartSeries[];
  axisUnit: string;
  /** Per-point colours for single-series categorical charts (doughnut, sign-coloured bars). */
  pointColors?: string[];
  pctAxis?: boolean;
}

export interface ChartDef {
  key: ChartBindingKey;
  label: string;
  group: 'Programme' | 'Costs & value' | 'Financing' | 'Returns' | 'Scenarios' | 'Operating';
  defaultKind: ChartKind;
  resolve: (m: ICReportModel, f: DeckFmt) => Resolved<ChartData>;
}

/** Scale a money series to the deck's unit so axes read "3,000" not "3,000,000,000". */
const scaleSeries = (vals: number[], f: DeckFmt): number[] => vals.map((v) => f.scaleValue(v));

const CHART_DEFS: ChartDef[] = [
  {
    key: 'chart.assetMix', label: 'Asset mix by BUA', group: 'Programme', defaultKind: 'doughnut',
    resolve: (m) => {
      const rows = m.assetMix.byStrategy;
      if (!rows.length) return missing('No assets are defined in this model');
      return ok({
        kind: 'doughnut',
        labels: rows.map((r) => r.strategy),
        series: [{ name: 'BUA', values: rows.map((r) => r.bua) }],
        pointColors: rows.map((_r, i) => CHART_SERIES[i % CHART_SERIES.length]),
        axisUnit: 'sqm',
      });
    },
  },
  {
    key: 'chart.costStack', label: 'Cost stack', group: 'Costs & value', defaultKind: 'column',
    resolve: (m, f) => {
      const c = m.charts.costStack;
      if (c.land + c.construction + c.financing <= 0.5) return missing('No development costs in this model');
      return ok({
        kind: 'column',
        labels: ['Land', 'Construction', 'Financing'],
        series: [{ name: 'Cost', values: scaleSeries([c.land, c.construction, c.financing], f) }],
        pointColors: [DECK_THEME.navyLight, DECK_THEME.navy, DECK_THEME.navyMid],
        axisUnit: f.moneyUnit,
      });
    },
  },
  {
    key: 'chart.revenueRecognition', label: 'Revenue recognition', group: 'Costs & value', defaultKind: 'stackedColumn',
    resolve: (m, f) => {
      const r = m.charts.revenueRecognition;
      if (!r.hasData) return missing('No revenue is recognised in this model');
      return ok({
        kind: 'stackedColumn',
        labels: r.yearLabels.map(String),
        series: [
          { name: 'Sales', color: DECK_THEME.navy, values: scaleSeries(r.sales, f) },
          { name: 'Hospitality', color: DECK_THEME.navyLight, values: scaleSeries(r.hospitality, f) },
          { name: 'Retail', color: DECK_THEME.pale, values: scaleSeries(r.retail, f) },
        ],
        axisUnit: f.moneyUnit,
      });
    },
  },
  {
    key: 'chart.debtBalance', label: 'Senior debt balance', group: 'Financing', defaultKind: 'column',
    resolve: (m, f) => {
      const d = m.charts.debtBalance;
      if (!d.hasData) return missing('This model carries no debt');
      return ok({
        kind: 'column',
        labels: d.yearLabels.map(String),
        series: [{ name: 'Debt balance', color: DECK_THEME.navy, values: scaleSeries(d.values, f) }],
        axisUnit: f.moneyUnit,
      });
    },
  },
  {
    key: 'chart.exitMoic', label: 'MOIC by exit year', group: 'Returns', defaultKind: 'line',
    resolve: (m) => {
      const e = m.charts.exitMoic;
      if (!e.hasData) return missing('Only one exit year is modelled');
      return ok({
        kind: 'line',
        labels: e.years.map(String),
        series: [{ name: 'Equity MOIC', color: DECK_THEME.navy, values: e.moic }],
        axisUnit: 'x',
      });
    },
  },
  {
    key: 'chart.scenarioIrr', label: 'IRR by scenario', group: 'Scenarios', defaultKind: 'column',
    resolve: (m) => {
      const rows = scenarioRows(m.scenarios);
      if (!rows.length) return missing('No scenarios are defined; add a case in Module 6');
      return ok({
        kind: 'column',
        labels: rows.map((r) => r.name),
        series: [
          { name: 'Project IRR', color: DECK_THEME.navy, values: rows.map((r) => r.projectIrr) },
          { name: 'Equity IRR', color: DECK_THEME.navyLight, values: rows.map((r) => r.equityIrr) },
        ],
        axisUnit: '%',
        pctAxis: true,
      });
    },
  },
  {
    key: 'chart.scenarioNpv', label: 'NPV by scenario', group: 'Scenarios', defaultKind: 'column',
    resolve: (m, f) => {
      const rows = scenarioRows(m.scenarios);
      if (!rows.length) return missing('No scenarios are defined; add a case in Module 6');
      const vals = rows.map((r) => (r.npv === null ? null : f.scaleValue(r.npv)));
      return ok({
        kind: 'column',
        labels: rows.map((r) => r.name),
        series: [{ name: 'NPV', values: vals }],
        pointColors: rows.map((r) => signColor(r.npv ?? 0)),
        axisUnit: f.moneyUnit,
      });
    },
  },
  {
    key: 'chart.sourcesMix', label: 'Sources mix', group: 'Financing', defaultKind: 'doughnut',
    resolve: (m) => {
      const s = m.sourcesUses.sources.filter((r) => Math.abs(r.value) > 0.5);
      if (!s.length) return missing('No funding sources in this model');
      return ok({
        kind: 'doughnut',
        labels: s.map((r) => r.label),
        series: [{ name: 'Sources', values: s.map((r) => r.value) }],
        pointColors: s.map((_r, i) => CHART_SERIES[i % CHART_SERIES.length]),
        axisUnit: '',
      });
    },
  },
  {
    key: 'chart.valueBridge', label: 'Value bridge', group: 'Costs & value', defaultKind: 'waterfall',
    resolve: (m, f) => {
      const rows = m.valueBridge;
      if (!rows.length) return missing('No value bridge in this model');
      return ok({
        kind: 'waterfall',
        labels: rows.map((r) => r.label),
        series: [{ name: 'Value', values: scaleSeries(rows.map((r) => r.value), f) }],
        pointColors: rows.map((r) => (r.emphasis ? DECK_THEME.green : signColor(r.value))),
        axisUnit: f.moneyUnit,
      });
    },
  },
  {
    key: 'chart.operatingNoi', label: 'NOI and EBITDA', group: 'Operating', defaultKind: 'column',
    resolve: (m, f) => {
      const o = m.operating;
      if (!o.hasData) return missing('This model has no recurring operations');
      return ok({
        kind: 'column',
        labels: o.yearLabels.map(String),
        series: [
          { name: 'NOI', color: DECK_THEME.navy, values: scaleSeries(o.noi, f) },
          { name: 'EBITDA', color: DECK_THEME.navyLight, values: scaleSeries(o.ebitda, f) },
        ],
        axisUnit: f.moneyUnit,
      });
    },
  },
];

export const CHART_BINDINGS: Record<ChartBindingKey, ChartDef> =
  Object.fromEntries(CHART_DEFS.map((d) => [d.key, d])) as Record<ChartBindingKey, ChartDef>;
export const CHART_KEYS = CHART_DEFS.map((d) => d.key);

export function resolveChart(key: ChartBindingKey, m: ICReportModel, f: DeckFmt): Resolved<ChartData> {
  const def = CHART_BINDINGS[key];
  if (!def) return missing(`Unknown chart "${key}"`);
  return def.resolve(m, f);
}

/** Scenario rows, read from the case-comparison columns so the deck plots the
 *  SAME per-case figures Module 6 shows on screen. */
interface ScenarioRow { name: string; role: string; projectIrr: number | null; equityIrr: number | null; npv: number | null }
function scenarioRows(sc: CaseComparisonReport | null): ScenarioRow[] {
  if (!sc) return [];
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return sc.columns.map((c) => ({
    name: c.name,
    role: c.id === sc.baseId ? 'base' : 'override',
    projectIrr: num(c.values?.['Project IRR (FCFF)']),
    equityIrr: num(c.values?.['Equity IRR (FCFE)']),
    npv: num(c.values?.['NPV (FCFF)']),
  }));
}

// ── Table bindings ──────────────────────────────────────────────────────────

export type TableBindingKey =
  | 'table.assetMix' | 'table.phasing' | 'table.sources' | 'table.uses'
  | 'table.valueBridge' | 'table.costStack' | 'table.exitYears'
  | 'table.scenarioReturns' | 'table.scenarioEconomics' | 'table.facilitySummary'
  | 'table.reMetrics' | 'table.devEconomics';

export type CellAlign = 'left' | 'right';
export interface TableCell { text: string; align: CellAlign; bold?: boolean; color?: string }
export interface TableRow { cells: TableCell[]; emphasis?: boolean; shaded?: boolean }
export interface TableData { headers: TableCell[]; rows: TableRow[]; unitNote: string }

export interface TableDef {
  key: TableBindingKey;
  label: string;
  group: 'Programme' | 'Costs & value' | 'Financing' | 'Returns' | 'Scenarios';
  resolve: (m: ICReportModel, f: DeckFmt) => Resolved<TableData>;
}

const h = (text: string, align: CellAlign = 'left'): TableCell => ({ text, align });
const c = (text: string, align: CellAlign = 'left', bold = false, color?: string): TableCell => ({ text, align, bold, color });
/** Money cells go red when negative: the reference slide's red-flag colour. */
const money = (v: number, f: DeckFmt, bold = false): TableCell =>
  ({ text: f.money(v), align: 'right', bold, color: v < 0 ? DECK_THEME.red : undefined });

const TABLE_DEFS: TableDef[] = [
  {
    key: 'table.assetMix', label: 'Asset schedule', group: 'Programme',
    resolve: (m, f) => {
      if (!m.assetMix.rows.length) return missing('No assets are defined in this model');
      return ok({
        headers: [h('Asset'), h('Strategy'), h('Phase'), h('BUA (sqm)', 'right'), h('Units', 'right')],
        rows: [
          ...m.assetMix.rows.map((r) => ({ cells: [c(r.name), c(r.strategy), c(r.phaseName), c(f.int(r.bua), 'right'), c(r.units ? f.int(r.units) : '-', 'right')] })),
          { cells: [c('Total', 'left', true), c('', 'left'), c('', 'left'), c(f.int(m.assetMix.totalBua), 'right', true), c(m.assetMix.totalUnits ? f.int(m.assetMix.totalUnits) : '-', 'right', true)], emphasis: true },
        ],
        unitNote: 'sqm',
      });
    },
  },
  {
    key: 'table.phasing', label: 'Phasing schedule', group: 'Programme',
    resolve: (m, f) => {
      if (!m.phasing.length) return missing('No phases are defined in this model');
      const total = m.phasing.reduce((s, p) => s + p.capex, 0);
      return ok({
        headers: [h('Phase'), h('Start'), h('Strategies'), h('Assets', 'right'), h(`Capex (${f.moneyUnit})`, 'right')],
        rows: [
          ...m.phasing.map((p) => ({ cells: [c(p.name), c(p.startYear ? String(p.startYear) : 'n/a'), c(p.strategies), c(f.int(p.assetCount), 'right'), money(p.capex, f)] })),
          { cells: [c('Total', 'left', true), c(''), c(''), c(f.int(m.phasing.reduce((s, p) => s + p.assetCount, 0)), 'right', true), money(total, f, true)], emphasis: true },
        ],
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.sources', label: 'Sources', group: 'Financing',
    resolve: (m, f) => {
      if (!m.sourcesUses.sources.length) return missing('No funding sources in this model');
      return ok({
        headers: [h('Source'), h(f.moneyUnit, 'right')],
        rows: [
          ...m.sourcesUses.sources.map((r) => ({ cells: [c(r.label), money(r.value, f)] })),
          { cells: [c('Total Sources', 'left', true), money(m.sourcesUses.totalSources, f, true)], emphasis: true },
        ],
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.uses', label: 'Uses', group: 'Financing',
    resolve: (m, f) => {
      if (!m.sourcesUses.uses.length) return missing('No uses of funds in this model');
      return ok({
        headers: [h('Use'), h(f.moneyUnit, 'right')],
        rows: [
          ...m.sourcesUses.uses.map((r) => ({ cells: [c(r.label), money(r.value, f)] })),
          { cells: [c('Total Uses', 'left', true), money(m.sourcesUses.totalUses, f, true)], emphasis: true },
        ],
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.valueBridge', label: 'Value bridge', group: 'Costs & value',
    resolve: (m, f) => {
      if (!m.valueBridge.length) return missing('No value bridge in this model');
      return ok({
        headers: [h('Line'), h(f.moneyUnit, 'right')],
        rows: m.valueBridge.map((r) => ({ cells: [c(r.label, 'left', r.emphasis), money(r.value, f, r.emphasis)], emphasis: r.emphasis })),
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.costStack', label: 'Cost breakdown', group: 'Costs & value',
    resolve: (m, f) => {
      if (!m.costStack.length) return missing('No development costs in this model');
      return ok({
        headers: [h('Cost line'), h(f.moneyUnit, 'right')],
        rows: m.costStack.map((r) => ({ cells: [c(r.label, 'left', r.emphasis), money(r.value, f, r.emphasis)], emphasis: r.emphasis })),
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.exitYears', label: 'Exit-year optionality', group: 'Returns',
    resolve: (m, f) => {
      if (m.exitYears.length < 2) return missing('Only one exit year is modelled');
      return ok({
        headers: [h('Exit year'), h(`Equity value (${f.moneyUnit})`, 'right'), h('Project IRR', 'right'), h('Equity IRR', 'right'), h('MOIC', 'right')],
        rows: m.exitYears.map((r) => ({
          cells: [c(String(r.year), 'left', r.selected), money(r.equityValue, f, r.selected), c(f.pct(r.projectIrr), 'right', r.selected), c(f.pct(r.equityIrr), 'right', r.selected), c(f.mult(r.equityMoic), 'right', r.selected)],
          shaded: r.selected,
        })),
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.scenarioReturns', label: 'Returns by scenario', group: 'Scenarios',
    resolve: (m, f) => {
      const rows = scenarioRows(m.scenarios);
      if (!rows.length) return missing('No scenarios are defined; add a case in Module 6');
      return ok({
        headers: [h('Case'), h('Project IRR', 'right'), h('Equity IRR', 'right'), h(`NPV (${f.moneyUnit})`, 'right')],
        rows: rows.map((r) => ({
          cells: [c(r.name, 'left', r.role === 'base'), c(f.pct(r.projectIrr), 'right'), c(f.pct(r.equityIrr), 'right'), r.npv === null ? c('n/a', 'right') : money(r.npv, f)],
          shaded: r.role === 'base',
        })),
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.scenarioEconomics', label: 'Economics by scenario', group: 'Scenarios',
    resolve: (m, f) => {
      const sc = m.scenarios;
      if (!sc) return missing('No scenarios are defined; add a case in Module 6');
      const kpis = sc.kpis ?? [];
      if (!kpis.length) return missing('The case comparison has no KPI rows');
      return ok({
        headers: [h('Metric'), ...sc.columns.map((col) => h(col.name, 'right'))],
        rows: kpis.map((k) => ({
          cells: [c(k.label), ...sc.columns.map((col) => {
            const v = col.values?.[k.label];
            return typeof v === 'number' && Number.isFinite(v) ? c(f.money(v), 'right') : c('n/a', 'right');
          })],
        })),
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.facilitySummary', label: 'Facility summary', group: 'Financing',
    resolve: (m, f) => {
      if (!m.financing.hasDebt) return missing('This model carries no debt');
      const fin = m.financing;
      return ok({
        headers: [h('Item'), h('Value', 'right')],
        rows: [
          { cells: [c('Funding method'), c(fin.fundingMethodLabel, 'right')] },
          { cells: [c('Existing debt'), money(fin.existingDebt, f)] },
          { cells: [c('New debt'), money(fin.newDebt, f)] },
          { cells: [c('Peak drawn debt', 'left', true), money(fin.peakDebt, f, true)], emphasis: true },
          { cells: [c('Tenor'), c(fin.tenorYears === null ? 'n/a' : `${f.int(fin.tenorYears)} yrs`, 'right')] },
          { cells: [c('Paydown by exit'), c(f.pct(fin.paydownPct), 'right')] },
          { cells: [c('Debt at exit'), money(fin.remainingDebtAtExit, f)] },
          { cells: [c('Min cash reserve'), money(fin.minCashReserve, f)] },
        ],
        unitNote: f.moneyUnit,
      });
    },
  },
  {
    key: 'table.reMetrics', label: 'Real estate metrics', group: 'Returns',
    resolve: (m, f) => {
      const keys: MetricBindingKey[] = ['reMetrics.yieldOnCost', 'reMetrics.capRateAtExit', 'reMetrics.profitOnCost', 'reMetrics.cashOnCashAvg', 'reMetrics.dscrMin', 'reMetrics.ltvAtExit'];
      const rows = keys.map((k) => ({ def: METRIC_BINDINGS[k], v: METRIC_BINDINGS[k].get(m) })).filter((r) => r.v !== null);
      if (!rows.length) return missing('No real estate metrics in this model');
      return ok({
        headers: [h('Metric'), h('Value', 'right')],
        rows: rows.map((r) => ({ cells: [c(r.def.label), c(formatMetric(r.def, r.v, f), 'right')] })),
        unitNote: '',
      });
    },
  },
  {
    key: 'table.devEconomics', label: 'Development economics', group: 'Costs & value',
    resolve: (m, f) => {
      const keys: MetricBindingKey[] = ['devEconomics.gdv', 'devEconomics.tdc', 'devEconomics.profitBeforeFinancing', 'devEconomics.financingCost', 'devEconomics.profitAfterFinancing', 'devEconomics.developmentMargin'];
      const rows = keys.map((k) => ({ def: METRIC_BINDINGS[k], v: METRIC_BINDINGS[k].get(m) })).filter((r) => r.v !== null);
      if (!rows.length) return missing('No development economics in this model');
      return ok({
        headers: [h('Metric'), h('Value', 'right')],
        rows: rows.map((r) => ({
          cells: [c(r.def.label, 'left', r.def.key === 'devEconomics.profitAfterFinancing'), c(formatMetric(r.def, r.v, f), 'right', r.def.key === 'devEconomics.profitAfterFinancing')],
          emphasis: r.def.key === 'devEconomics.profitAfterFinancing',
        })),
        unitNote: f.moneyUnit,
      });
    },
  },
];

export const TABLE_BINDINGS: Record<TableBindingKey, TableDef> =
  Object.fromEntries(TABLE_DEFS.map((d) => [d.key, d])) as Record<TableBindingKey, TableDef>;
export const TABLE_KEYS = TABLE_DEFS.map((d) => d.key);

export function resolveTable(key: TableBindingKey, m: ICReportModel, f: DeckFmt): Resolved<TableData> {
  const def = TABLE_BINDINGS[key];
  if (!def) return missing(`Unknown table "${key}"`);
  return def.resolve(m, f);
}

// ── Formatter factory ───────────────────────────────────────────────────────

/** Build the deck formatter from the money-scale setting. The divisor and unit
 *  come from icMoneyScaleSpec so the deck, the old report inputs and the Excel
 *  export all agree on what "millions" means. */
export function makeDeckFmt(spec: { divisor: number; decimals: number; unit: string }): DeckFmt {
  const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: spec.decimals, maximumFractionDigits: spec.decimals });
  const scaleValue = (v: number): number => v / spec.divisor;
  const money = (v: number | null | undefined): string => {
    if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
    const s = nf.format(Math.abs(scaleValue(v)));
    return v < 0 ? `(${s})` : s;
  };
  const pct = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`;
  const mult = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}x`;
  const int = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
  return { money, moneyUnit: spec.unit, pct, mult, int, scaleValue };
}
