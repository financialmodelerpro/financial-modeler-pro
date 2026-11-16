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
import { plPlan, plLineKeys } from './plPlan';
import { RF } from './returnsPlan';
import { bsTotalDebtKey } from './bsPlan';

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
  /** A headline tile row (2026-11-12): its caption, its figure, or the tile's foot. */
  tile?: 'cap' | 'val' | 'pad';
}
/** The headline tiles' columns: each tile two columns wide with a gap after it. */
export const TILE_COLS = [2, 5, 8, 11] as const;

const B = 2;
/** The model years sit in the period columns F onwards. */
export const SUM_YEAR_COL = 6;

export function summaryPlan(state: FinancialsResolverState, snap: Snap, rs: RS): SumRow[] {
  const N = snap.axisLength;
  const ov = buildOverviewReport(snap, rs, state);
  const p = state.project;
  const plKeys = plLineKeys(state);
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

  // ── The headline (2026-11-12, founder): the Dashboard's tiles, each the Summary row it repeats ─────
  {
    const de0 = rs.developmentEconomics;
    const m0 = rs.result.realEstate;
    const fee0 = chargesPerformanceFee(rs), dp0 = distributedReturnPair(rs);
    const tiles: Array<Array<{ cap: string; v: number | string; fmt: string; f: Fx }>> = [
      [
        { cap: 'GROSS DEVELOPMENT VALUE', v: de0.gdv, fmt: RF.money, f: (E) => E.tot('ret|de|gdv') },
        { cap: 'TOTAL DEVELOPMENT COST', v: de0.totalDevelopmentCost, fmt: RF.money, f: (E) => E.tot('ret|de|tdc') },
        { cap: 'DEVELOPMENT MARGIN', v: nz(de0.developmentMargin), fmt: RF.pct, f: (E) => E.tot('ret|de|margin') },
        { cap: 'PEAK EQUITY', v: m0.peakEquity, fmt: RF.money, f: (E) => E.tot('rm|peakeq') },
      ],
      [
        { cap: 'PROJECT IRR (FCFF)', v: nz(rs.result.fcff.irr), fmt: RF.pct, f: (E) => E.ref('ret|h|fcff|4') },
        { cap: 'EQUITY IRR (FCFE)', v: nz(rs.result.fcfe.irr), fmt: RF.pct, f: (E) => E.ref('ret|h|fcfe|4') },
        { cap: 'EQUITY MOIC', v: nz(rs.result.fcfe.moic), fmt: RF.mult, f: (E) => E.ref('ret|h|fcfe|5') },
        fee0
          ? { cap: 'DISTRIBUTIONS IRR (NET)', v: nz(dp0.irr), fmt: RF.pct, f: (E) => E.ref('ret|h|net|4') }
          : { cap: 'DISTRIBUTIONS IRR', v: nz(dp0.irr), fmt: RF.pct, f: (E) => E.ref('ret|h|ddm|4') },
      ],
    ];
    tiles.forEach((set, i) => {
      rows.push({ key: `sum|tile|cap${i}`, label: '', kind: 'cells', tile: 'cap', cells: set.map((t, j) => ({ col: TILE_COLS[j], v: t.cap, fmt: RF.text })) });
      rows.push({ key: `sum|tile|val${i}`, label: '', kind: 'cells', tile: 'val', cells: set.map((t, j) => ({ col: TILE_COLS[j], v: t.v, fmt: t.fmt, f: t.f })) });
      rows.push({ key: `sum|tile|pad${i}`, label: '', kind: 'cells', tile: 'pad', cells: set.map((_t, j) => ({ col: TILE_COLS[j], v: null })) });
      gap(`sum|tile|gap${i}`);
    });
  }

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

  // ── Economics ─────────────────────────────────────────────────────────────
  const de = rs.developmentEconomics, su = rs.sourcesUses, m = rs.result.realEstate;
  section('sum|#econ', 'Development economics');
  // THE TILES CARRY GDV, COST, MARGIN AND PEAK EQUITY (2026-11-16, founder): each figure shows once.
  one('sum|land', 'Land cost', su.land, (E) => E.tot('ret|Land'), RF.money, M);
  one('sum|cons', 'Construction', su.construction, (E) => E.tot('ret|Construction & Infrastructure'), RF.money, M);
  one('sum|opex', 'Operating expenses over the hold', de.operatingExpenses, (E) => E.tot('ret|de|opex'), RF.money, M);
  one('sum|fin', 'Total financing cost', de.totalFinancingCost, (E) => E.tot('ret|de|fin'), RF.money, M);
  one('sum|surplus', 'Development surplus after finance', de.profitAfterFinancing, (E) => E.tot('ret|de|after'), RF.money, M, { style: 'subtotal' });
  if (ov.fundLayer) {
    const feeRow = plPlan(state, snap).find((r) => r.key === 'pl|__all__||Total Fund Management Fee');
    if (feeRow) one('sum|fees', 'Fund fees over the life (charged in the P&L)', -(feeRow.values ?? []).slice(0, N).reduce((s2: number, v: number) => s2 + (v ?? 0), 0), (E) => `-${E.tot('pl|__all__||Total Fund Management Fee')}`, RF.money, M);
  }
  one('sum|cap', 'Cap rate at exit', nz(m.capRateAtExit), (E) => E.tot('rm|cap'), RF.pct);
  gap('sum|gap|c');

  // ── Cost per sqm ──────────────────────────────────────────────────────────
  const cps = ov.costPerSqm;
  section('sum|#cps', 'Cost per square metre');
  const tdcF: Fx = (E) => E.tot('ret|de|tdc'), gfaF: Fx = (E) => E.cell('sum|ty|total', B + 2), nsaF: Fx = (E) => E.cell('sum|nsa', B);
  one('sum|cps:dev', 'Development cost per sqm of GFA', nz(cps.developmentCostPerGfa), ratio(tdcF, gfaF), RF.rate, PER);
  one('sum|cps:con', 'Construction cost per sqm of GFA', nz(cps.constructionCostPerGfa), ratio((E) => E.cell('sum|cons', B), gfaF), RF.rate, PER);
  one('sum|cps:sal', 'Development cost per saleable sqm', nz(cps.developmentCostPerSaleable), ratio(tdcF, nsaF), RF.rate, PER);
  one('sum|cps:rev', 'Revenue per saleable sqm', nz(cps.revenuePerSaleable), ratio((E) => E.tot('pl|__all__||Total Revenue'), nsaF), RF.rate, PER);
  gap('sum|gap|d');

  // ── Capital stack ─────────────────────────────────────────────────────────
  section('sum|#stack', 'Capital stack');
  head('sum|#stackcols', 'Source', [[B, 'Amount'], [B + 1, 'Share of sources'], [B + 2, 'Share of the stack']]);
  const stack: Array<[string, string, number, Fx]> = [
    ['sum|st:debt', 'Debt', su.existingDebt + su.newDebt, (E) => ['ret|Existing Debt', 'ret|su|debtCapex', 'ret|su|debtInt'].filter((k) => E.has(k)).map((k) => E.tot(k)).join('+')],
    ['sum|st:cash', 'Cash equity', su.existingEquity + su.newEquityCash, (E) => ['ret|Existing Equity', 'ret|New Equity (cash)'].filter((k) => E.has(k)).map((k) => E.tot(k)).join('+')],
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
  const sumOf = (E: SEnv, keys: string[]): string => (keys.length ? `SUM(${keys.map((k) => E.ref(k)).join(',')})` : '0');
  one('sum|landval', 'Land value', sc.landValue, (E) => E.ref('landtot:value'), RF.money, M);
  one('sum|bua', 'Total BUA (parking included)', sc.buaSqm, (E) => E.ref('chaintot:lines:bua'), RF.int, 'sqm');
  one('sum|ratio', 'Plot ratio (GFA over land)', nz(sc.plotRatio), ratio(gfaF, (E) => E.cell('sum|ty|total', B)), RF.mult);
  // THE NSA USED (2026-11-03): the table total, with each line's NSA used (Inputs, the larger of its
  // sub-units' area and its Stated NSA) in place of the line's table figure, as the platform counts it.
  const usedLines = nsaUsedLines(state, areas);
  one('sum|nsa', 'Saleable and leasable area (NSA)', sc.saleableSqm, (E) => {
    const used = new Set(usedLines.filter((l) => E.has(`nsaline:${l.key}`)).map((l) => l.key));
    const lineCells = areas.lines.map((l) => (used.has(l.key) ? `nsaline:${l.key}` : lineKey(l.key, 'nsa')));
    return sumOf(E, [...lineCells, ...areas.companions.map((c) => compKey(c.name, 'nsa'))]);
  }, RF.int, 'sqm');
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
      { col: B + 1, v: t.landPct, fmt: RF.pct, f: (E) => `IF(${E.cell('sum|ty|total', B)}>0,${E.cell(k, B)}/${E.cell('sum|ty|total', B)},0)` },
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
      { col: B, v: s2.value, fmt: RF.money, f: (E) => (plKeys.bySection.get(s2.label)?.rev ?? []).map((x) => E.tot(x)).join('+') || '0' },
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
      { col: B + 7, v: ph.revenue, fmt: RF.money, f: (E) => (plKeys.byPhase.get(ph.id) ?? []).map((x) => E.tot(x)).join('+') || '0' },
      { col: B + 8, v: ph.ebitda, fmt: RF.money, f: (E) => E.tot(`pl|${ph.id}||EBITDA`) },
    ] });
  }
  gap('sum|gap|j');

  // ── Exit and cash ─────────────────────────────────────────────────────────
  const ex = ov.exit;
  section('sum|#exit', 'Exit and cash');
  one('sum|tv', 'Terminal value (proceeds from disposal)', ex.terminalValue, (E) => E.tot('ret|x|tv'), RF.money, M);
  one('sum|gain', 'Gain on disposal', ex.gainOnDisposal, (E) => E.tot('pl|__all__||Gain on Disposal of Operating Assets'), RF.money, M);
  one('sum|peakdebt', 'Peak debt', ex.peakDebt, (E) => `MAX(0,MAX(${E.rngY(bsTotalDebtKey(state))}))`, RF.money, M);
  one('sum|cashlow', 'Cash low point', ex.cashLow, (E) => `MIN(${E.rngY('bs|__all__||Cash')})`, RF.money, M);
  one('sum|cashlowyr', 'Year of the cash low point', ex.cashLowYear ?? 'n/a',
    // No array formula (2026-11-04): the first year at the low point, through SUMPRODUCT.
    (E) => `SUMPRODUCT(MIN(${E.yrRng()}+(${E.rngY('bs|__all__||Cash')}>MIN(${E.rngY('bs|__all__||Cash')})+0.5)*100000))`, RF.year);
  return rows;
}
