/**
 * summaryPlan.ts (2026-11-03), THE LIVE SUMMARY, ROW BY ROW.
 *
 * The platform's Project Overview (`buildOverviewReport`) as numbers: the builder prints each row with
 * the overview's value, the layer (stage7dSummary) writes each formula from the same row, a LINK to
 * the tab that works the figure out (Returns, Land & Area, the P&L, Capex, Financing, the Balance
 * Sheet, Timeline). Money is in millions, areas in square metres, under the units line; no figure is
 * text and no label carries a figure.
 *
 * No em dashes in this file.
 */
import type { computeFinancialsSnapshot, FinancialsResolverState } from '../../financials-resolvers';
import type { computeReturnsSnapshot } from '../../returns-resolvers';
import { buildOverviewReport, chargesPerformanceFee, distributedReturnPair } from '../../reports/overviewReport';
import { buildAssetAreaTables } from '../../../components/modules/_shared/assetInputsView';
import { nsaUsedLines } from '../inputsSheetSections';
import { financingPlan } from './financingPlan';
import { plPlan } from './plPlan';
import { RF } from './returnsPlan';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;
type RS = ReturnType<typeof computeReturnsSnapshot>;

/** What the layer gives a row's rule. */
export interface SEnv {
  has(key: string): boolean;
  /** A registered cell, absolute. */
  ref(key: string): string;
  /** A registered row's Total / value column on its tab, absolute. */
  tot(key: string): string;
  /** A Summary cell of this plan (its row key and column), absolute. */
  cell(key: string, col: number): string;
  /** Another tab's row at model year t, absolute. */
  per(key: string, t: number): string;
  /** Another tab's row, its years as one range. */
  rngY(key: string): string;
  /** The Timeline year of model year t, absolute; every model year as one range. */
  yr(t: number): string;
  yrRng(): string;
}
type Fx = (E: SEnv) => string;

export interface SumCell { col: number; v: number | string | null; fmt?: string; f?: Fx; bold?: boolean }
export interface SumRow {
  key: string;
  label: string;
  kind: 'section' | 'head' | 'cols' | 'cells' | 'gap';
  cells?: SumCell[];
  cols?: Array<[number, string]>;
  style?: 'total' | 'subtotal';
  indent?: number;
}

const B = 2;
/** The model years sit in the period columns F onwards. */
export const SUM_YEAR_COL = 6;

export function summaryPlan(state: FinancialsResolverState, snap: Snap, rs: RS): SumRow[] {
  const N = snap.axisLength;
  const ov = buildOverviewReport(snap, rs, state);
  const p = state.project;
  const rows: SumRow[] = [];
  const section = (key: string, label: string): void => { rows.push({ key, label, kind: 'section' }); };
  const head = (key: string, label: string, cols?: Array<[number, string]>): void => { rows.push({ key, label, kind: cols ? 'cols' : 'head', cols }); };
  const gap = (key: string): void => { rows.push({ key, label: '', kind: 'gap' }); };
  const one = (key: string, label: string, v: number | string | null, f: Fx | undefined, fmt: string, unit?: string, o: Partial<SumRow> = {}): void => {
    rows.push({ key, label, kind: 'cells', cells: [{ col: B, v, fmt, f }, ...(unit ? [{ col: B + 1, v: unit, fmt: RF.text }] : [])], ...o });
  };
  const nz = (v: number | null | undefined): number | string => (v == null || !Number.isFinite(v) ? 'n/a' : v);
  const ratio = (num: Fx, den: Fx): Fx => (E) => `IF(${den(E)}>0,${num(E)}/${den(E)},"n/a")`;
  const cur = p.currency || 'SAR';
  const M = `${cur} m`, PER = `${cur} per sqm`;

  // ── Key facts ─────────────────────────────────────────────────────────────
  section('sum|#facts', 'Key facts');
  one('sum|start', 'First model year', snap.yearLabels[0], (E) => E.yr(0), RF.year);
  one('sum|last', 'Last model year', snap.yearLabels[N - 1], (E) => E.ref('tl:lastYear'), RF.year);
  one('sum|horizon', 'Model horizon', N, (E) => E.ref('tl:horizon'), RF.int, 'years');
  one('sum|exit', 'Exit year', ov.exit.year, (E) => E.tot('ret|Exit Year'), RF.year);
  one('sum|phases', 'Number of phases', state.phases.length, (E) => `COUNT(${state.phases.map((ph) => E.ref(`tl:phase:${ph.id}:hy`)).join(',')})`, RF.int);
  const areas = buildAssetAreaTables({ project: p, phases: state.phases, parcels: state.parcels, assets: state.assets, subUnits: state.subUnits, costLines: state.costLines, landAllocationMode: state.landAllocationMode });
  const lineKey = (k: string, f: string): string => `chainline:${k}:${f}`;
  const compKey = (n: string, f: string): string => `chaincomp:${n}:${f}`;
  one('sum|lines', 'Number of lines', ov.scheme.lines, (E) => `COUNT(${[...areas.lines.map((l) => E.ref(lineKey(l.key, 'land'))), ...areas.companions.map((c) => E.ref(compKey(c.name, 'land')))].join(',')})`, RF.int);
  gap('sum|gap|a');

  // ── Returns: each stream's IRR and MOIC, linked from Returns ─────────────
  section('sum|#returns', 'Returns');
  head('sum|#retcols', 'Stream', [[B, 'IRR'], [B + 1, 'MOIC']]);
  const fee = chargesPerformanceFee(rs);
  const dp = distributedReturnPair(rs);
  const pair = (key: string, label: string, src: string, irr: number | null | undefined, moic: number | null | undefined): void => {
    rows.push({ key, label, kind: 'cells', cells: [
      { col: B, v: nz(irr), fmt: RF.pct, f: (E) => E.ref(`${src}|4`), bold: true },
      { col: B + 1, v: nz(moic), fmt: RF.mult, f: (E) => E.ref(`${src}|5`) },
    ] });
  };
  pair('sum|r|fcff', 'Project (FCFF)', 'ret|h|fcff', rs.result.fcff.irr, rs.result.fcff.moic);
  pair('sum|r|fcfe', 'Equity (FCFE)', 'ret|h|fcfe', rs.result.fcfe.irr, rs.result.fcfe.moic);
  if (fee) {
    pair('sum|r|net', 'Distributions, net of the performance fee', 'ret|h|net', dp.irr, dp.moic);
    pair('sum|r|ddm', 'Distributions, before the performance fee', 'ret|h|ddm', dp.preFeeIrr, dp.preFeeMoic);
  } else pair('sum|r|ddm', 'Distributions', 'ret|h|ddm', dp.irr, dp.moic);
  gap('sum|gap|b');

  // ── Economics ─────────────────────────────────────────────────────────────
  const de = rs.developmentEconomics, su = rs.sourcesUses, m = rs.result.realEstate;
  section('sum|#econ', 'Development economics');
  one('sum|gdv', 'Gross development value', de.gdv, (E) => E.tot('ret|de|gdv'), RF.money, M);
  one('sum|tdc', 'Total development cost', de.totalDevelopmentCost, (E) => E.tot('ret|de|tdc'), RF.money, M);
  one('sum|land', 'Land cost', su.land, (E) => E.tot('ret|Land'), RF.money, M, { indent: 1 });
  one('sum|cons', 'Construction', su.construction, (E) => E.tot('ret|Construction & Infrastructure'), RF.money, M, { indent: 1 });
  one('sum|opex', 'Operating expenses over the hold', de.operatingExpenses, (E) => E.tot('ret|de|opex'), RF.money, M);
  one('sum|fin', 'Total financing cost', de.totalFinancingCost, (E) => E.tot('ret|de|fin'), RF.money, M);
  one('sum|surplus', 'Development surplus after finance', de.profitAfterFinancing, (E) => E.tot('ret|de|after'), RF.money, M, { style: 'subtotal' });
  one('sum|margin', 'Development margin', nz(de.developmentMargin), (E) => E.tot('ret|de|margin'), RF.pct);
  if (ov.fundLayer) {
    const feeRow = plPlan(state, snap).find((r) => r.key === 'pl|__all__||Total Fund Management Fee');
    if (feeRow) one('sum|fees', 'Fund fees over the life (charged in the P&L)', -(feeRow.values ?? []).slice(0, N).reduce((s2: number, v: number) => s2 + (v ?? 0), 0), (E) => `-${E.tot('pl|__all__||Total Fund Management Fee')}`, RF.money, M);
  }
  one('sum|peakeq', 'Peak equity', m.peakEquity, (E) => E.tot('rm|peakeq'), RF.money, M);
  one('sum|cap', 'Cap rate at exit', nz(m.capRateAtExit), (E) => E.tot('rm|cap'), RF.pct);
  gap('sum|gap|c');

  // ── Cost per sqm ──────────────────────────────────────────────────────────
  const cps = ov.costPerSqm;
  section('sum|#cps', 'Cost per square metre');
  const tdcF: Fx = (E) => E.cell('sum|tdc', B), gfaF: Fx = (E) => E.cell('sum|gfa', B), nsaF: Fx = (E) => E.cell('sum|nsa', B);
  one('sum|cps:dev', 'Development cost per sqm of GFA', nz(cps.developmentCostPerGfa), ratio(tdcF, gfaF), RF.rate, PER);
  one('sum|cps:con', 'Construction cost per sqm of GFA', nz(cps.constructionCostPerGfa), ratio((E) => E.cell('sum|cons', B), gfaF), RF.rate, PER);
  one('sum|cps:sal', 'Development cost per saleable sqm', nz(cps.developmentCostPerSaleable), ratio(tdcF, nsaF), RF.rate, PER);
  one('sum|cps:rev', 'Revenue per saleable sqm', nz(cps.revenuePerSaleable), ratio((E) => E.tot('pl|__all__||Total Revenue'), nsaF), RF.rate, PER);
  gap('sum|gap|d');

  // ── Capital stack ─────────────────────────────────────────────────────────
  section('sum|#stack', 'Capital stack');
  head('sum|#stackcols', 'Source', [[B, 'Amount'], [B + 1, 'Share of sources'], [B + 2, 'Share of the stack']]);
  const stack: Array<[string, string, number, Fx]> = [
    ['sum|st:debt', 'Debt', su.existingDebt + su.newDebt, (E) => `${E.tot('ret|Existing Debt')}+${E.tot('ret|su|debtCapex')}+${E.tot('ret|su|debtInt')}`],
    ['sum|st:cash', 'Cash equity', su.existingEquity + su.newEquityCash, (E) => `${E.tot('ret|Existing Equity')}+${E.tot('ret|New Equity (cash)')}`],
    ['sum|st:kind', 'In-kind equity', su.inKindEquity, (E) => E.tot('ret|In-Kind Equity (land)')],
  ];
  const stackTot = stack.reduce((s2, x) => s2 + x[2], 0);
  for (const [k, label, v, f] of stack) {
    rows.push({ key: k, label, kind: 'cells', cells: [
      { col: B, v, fmt: RF.money, f },
      { col: B + 1, v: su.totalSources > 0 ? v / su.totalSources : 'n/a', fmt: RF.pct, f: (E) => `IF(${E.tot('ret|Total Sources')}>0,${E.cell(k, B)}/${E.tot('ret|Total Sources')},"n/a")` },
      { col: B + 2, v: stackTot > 0 ? v / stackTot : 0, fmt: RF.pct, f: (E) => `IF(SUM(${stack.map((x) => E.cell(x[0], B)).join(',')})>0,${E.cell(k, B)}/SUM(${stack.map((x) => E.cell(x[0], B)).join(',')}),0)` },
    ] });
  }
  gap('sum|gap|e');

  // ── Funding requirement, every model year ────────────────────────────────
  section('sum|#fund', 'Funding requirement by year');
  const need = financingPlan(state, snap).rows.find((r) => r.key === 'fl:need')?.values ?? new Array<number>(N).fill(0);
  rows.push({ key: 'sum|fund:yr', label: 'Year', kind: 'cells', cells: Array.from({ length: N }, (_, t) => ({ col: SUM_YEAR_COL + t, v: snap.yearLabels[t], fmt: RF.year, f: (E: SEnv) => E.yr(t), bold: true })) });
  rows.push({ key: 'sum|fund', label: 'Funding need', kind: 'cells', cells: Array.from({ length: N }, (_, t) => ({ col: SUM_YEAR_COL + t, v: Number(need[t] ?? 0), fmt: RF.money, f: (E: SEnv) => E.per('fnc:main:netreq', t) })) });
  gap('sum|gap|f');

  // ── Scheme ────────────────────────────────────────────────────────────────
  const sc = ov.scheme;
  section('sum|#scheme', 'Scheme');
  const sellLines = areas.lines.filter((l) => l.strategy === 'Sell' || l.strategy === 'Sell + Manage');
  const hotelLines = areas.lines.filter((l) => l.strategy === 'Operate');
  const leaseLines = areas.lines.filter((l) => l.strategy === 'Lease');
  const sumOf = (E: SEnv, keys: string[]): string => (keys.length ? `SUM(${keys.map((k) => E.ref(k)).join(',')})` : '0');
  one('sum|landsqm', 'Land', sc.landSqm, (E) => E.ref('chaintot:lines:land'), RF.int, 'sqm');
  one('sum|landval', 'Land value', sc.landValue, (E) => E.ref('landtot:value'), RF.money, M);
  one('sum|gfa', 'Total GFA', sc.gfaSqm, (E) => E.ref('chaintot:lines:tg'), RF.int, 'sqm');
  one('sum|bua', 'Total BUA (parking included)', sc.buaSqm, (E) => E.ref('chaintot:lines:bua'), RF.int, 'sqm');
  one('sum|ratio', 'Plot ratio (GFA over land)', nz(sc.plotRatio), ratio(gfaF, (E) => E.cell('sum|landsqm', B)), RF.mult);
  // THE NSA USED (2026-11-03): the table total, with each line's NSA used (Inputs, the larger of its
  // sub-units' area and its Stated NSA) in place of the line's table figure, as the platform counts it.
  const usedLines = nsaUsedLines(state, areas);
  one('sum|nsa', 'Saleable and leasable area (NSA)', sc.saleableSqm, (E) => {
    const used = new Set(usedLines.filter((l) => E.has(`nsaline:${l.key}`)).map((l) => l.key));
    const lineCells = areas.lines.map((l) => (used.has(l.key) ? `nsaline:${l.key}` : lineKey(l.key, 'nsa')));
    return sumOf(E, [...lineCells, ...areas.companions.map((c) => compKey(c.name, 'nsa'))]);
  }, RF.int, 'sqm');
  one('sum|units', 'Units (sell lines)', sc.units, (E) => sumOf(E, sellLines.map((l) => lineKey(l.key, 'units'))), RF.int);
  one('sum|keys', 'Keys (hotel lines)', sc.keys, (E) => sumOf(E, hotelLines.map((l) => lineKey(l.key, 'units'))), RF.int);
  one('sum|lease', 'Lettable area (lease lines and retail strips)', sc.leasableSqm, (E) => sumOf(E, [...leaseLines.map((l) => lineKey(l.key, 'nsa')), ...areas.companions.map((c) => compKey(c.name, 'nsa'))]), RF.int, 'sqm');
  gap('sum|gap|g');

  // ── By asset type ─────────────────────────────────────────────────────────
  section('sum|#type', 'Land and build by asset type');
  head('sum|#typecols', 'Asset type', [[B, 'Land (sqm)'], [B + 1, 'Share of land'], [B + 2, 'GFA (sqm)'], [B + 3, 'Units'], [B + 4, 'Keys'], [B + 5, 'Lettable (sqm)']]);
  const retailLabel = 'Retail Ground Floor';
  for (const t of ov.byType) {
    const ls = areas.lines.filter((l) => l.typeLabel === t.label);
    const comps = t.label === retailLabel ? areas.companions : [];
    const k = `sum|ty|${t.label}`;
    const keysF = (f: string, only?: (l: typeof ls[number]) => boolean): string[] => [...ls.filter((l) => !only || only(l)).map((l) => lineKey(l.key, f)), ...comps.map((c) => compKey(c.name, f))];
    rows.push({ key: k, label: t.label, kind: 'cells', cells: [
      { col: B, v: t.landSqm, fmt: RF.int, f: (E) => sumOf(E, keysF('land')) },
      { col: B + 1, v: t.landPct, fmt: RF.pct, f: (E) => `IF(${E.cell('sum|landsqm', B)}>0,${E.cell(k, B)}/${E.cell('sum|landsqm', B)},0)` },
      { col: B + 2, v: t.gfaSqm, fmt: RF.int, f: (E) => sumOf(E, keysF('tg')) },
      { col: B + 3, v: t.units, fmt: RF.int, f: (E) => sumOf(E, ls.filter((l) => l.strategy === 'Sell' || l.strategy === 'Sell + Manage').map((l) => lineKey(l.key, 'units'))) },
      { col: B + 4, v: t.keys, fmt: RF.int, f: (E) => sumOf(E, ls.filter((l) => l.strategy === 'Operate').map((l) => lineKey(l.key, 'units'))) },
      { col: B + 5, v: t.leasableSqm, fmt: RF.int, f: (E) => sumOf(E, [...ls.filter((l) => l.strategy === 'Lease').map((l) => lineKey(l.key, 'nsa')), ...comps.map((c) => compKey(c.name, 'nsa'))]) },
    ] });
  }
  {
    const ks = ov.byType.map((t) => `sum|ty|${t.label}`);
    const tot = (E: SEnv, c: number): string => (ks.length ? `SUM(${E.cell(ks[0], c)}:${E.cell(ks[ks.length - 1], c)})` : '0');
    const sumV = (f: 'landSqm' | 'gfaSqm' | 'units' | 'keys' | 'leasableSqm'): number => ov.byType.reduce((s2, t) => s2 + t[f], 0);
    rows.push({ key: 'sum|ty|total', label: 'Total', kind: 'cells', style: 'subtotal', cells: [
      { col: B, v: sumV('landSqm'), fmt: RF.int, f: (E) => tot(E, B) },
      { col: B + 1, v: ov.byType.length ? 1 : 0, fmt: RF.pct, f: (E) => tot(E, B + 1) },
      { col: B + 2, v: sumV('gfaSqm'), fmt: RF.int, f: (E) => tot(E, B + 2) },
      { col: B + 3, v: sumV('units'), fmt: RF.int, f: (E) => tot(E, B + 3) },
      { col: B + 4, v: sumV('keys'), fmt: RF.int, f: (E) => tot(E, B + 4) },
      { col: B + 5, v: sumV('leasableSqm'), fmt: RF.int, f: (E) => tot(E, B + 5) },
    ] });
  }
  gap('sum|gap|h');

  // ── Revenue mix ───────────────────────────────────────────────────────────
  section('sum|#mix', 'Revenue mix');
  head('sum|#mixcols', 'Section', [[B, 'Revenue'], [B + 1, 'Share']]);
  for (const s2 of ov.revenueMix) {
    const k = `sum|mix|${s2.label}`;
    rows.push({ key: k, label: `${s2.label} revenue`, kind: 'cells', cells: [
      { col: B, v: s2.value, fmt: RF.money, f: (E) => E.tot(`pl|__all__||${s2.label} Revenue`) },
      { col: B + 1, v: s2.pct, fmt: RF.pct, f: (E) => `IF(${E.tot('pl|__all__||Total Revenue')}>0,${E.cell(k, B)}/${E.tot('pl|__all__||Total Revenue')},0)` },
    ] });
  }
  gap('sum|gap|i');

  // ── Phases ────────────────────────────────────────────────────────────────
  section('sum|#phases', 'Phases');
  head('sum|#phcols', 'Phase', [[B, 'Construction from'], [B + 1, 'Construction to'], [B + 2, 'Operations from'], [B + 3, 'Lines'], [B + 4, 'Land (sqm)'], [B + 5, 'GFA (sqm)'], [B + 6, 'Capex'], [B + 7, 'Revenue'], [B + 8, 'EBITDA']]);
  for (const ph of ov.phases) {
    const ls = areas.lines.filter((l) => l.phaseName === ph.name);
    const comps = areas.companions.filter((c) => c.phaseName === ph.name);
    const keysF = (f: string): string[] => [...ls.map((l) => lineKey(l.key, f)), ...comps.map((c) => compKey(c.name, f))];
    rows.push({ key: `sum|ph|${ph.id}`, label: ph.name, kind: 'cells', cells: [
      { col: B, v: ph.startYear, fmt: RF.year, f: (E) => `YEAR(${E.ref(`tl:phase:${ph.id}:cs`)})` },
      { col: B + 1, v: ph.constructionEndYear, fmt: RF.year, f: (E) => `YEAR(${E.ref(`tl:phase:${ph.id}:ce`)})` },
      { col: B + 2, v: ph.operationsStartYear, fmt: RF.year, f: (E) => `YEAR(${E.ref(`tl:phase:${ph.id}:os`)})` },
      { col: B + 3, v: ph.lines, fmt: RF.int, f: (E) => `COUNT(${keysF('land').map((k) => E.ref(k)).join(',')})` },
      { col: B + 4, v: ph.landSqm, fmt: RF.int, f: (E) => sumOf(E, keysF('land')) },
      { col: B + 5, v: ph.gfaSqm, fmt: RF.int, f: (E) => sumOf(E, keysF('tg')) },
      { col: B + 6, v: ph.capex, fmt: RF.money, f: (E) => E.tot(`cx2sub:${ph.id}`) },
      { col: B + 7, v: ph.revenue, fmt: RF.money, f: (E) => E.tot(`pl|${ph.id}||Total Revenue`) },
      { col: B + 8, v: ph.ebitda, fmt: RF.money, f: (E) => E.tot(`pl|${ph.id}||EBITDA`) },
    ] });
  }
  gap('sum|gap|j');

  // ── Exit and cash ─────────────────────────────────────────────────────────
  const ex = ov.exit;
  section('sum|#exit', 'Exit and cash');
  one('sum|tv', 'Terminal value (proceeds from disposal)', ex.terminalValue, (E) => E.tot('ret|x|tv'), RF.money, M);
  one('sum|gain', 'Gain on disposal', ex.gainOnDisposal, (E) => E.tot('ret|x|gain'), RF.money, M);
  one('sum|peakdebt', 'Peak debt', ex.peakDebt, (E) => `MAX(0,MAX(${E.rngY('bs|__all__||Debt (long-term)')}))`, RF.money, M);
  one('sum|cashlow', 'Cash low point', ex.cashLow, (E) => `MIN(${E.rngY('bs|__all__||Cash')})`, RF.money, M);
  one('sum|cashlowyr', 'Year of the cash low point', ex.cashLowYear ?? 'n/a',
    // No array formula (2026-11-04): the first year at the low point, through SUMPRODUCT.
    (E) => `SUMPRODUCT(MIN(${E.yrRng()}+(${E.rngY('bs|__all__||Cash')}>MIN(${E.rngY('bs|__all__||Cash')})+0.5)*100000))`, RF.year);
  return rows;
}
