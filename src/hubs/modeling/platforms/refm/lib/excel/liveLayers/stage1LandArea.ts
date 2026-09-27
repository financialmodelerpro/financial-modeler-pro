/**
 * stage1LandArea.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 1.
 *
 * LIVE after this layer: the Timeline sheet, the Land & Area sheet, and on the
 * Inputs sheet the phase dates, the model axis year, the plot values, the
 * Table 2 figures inherited from a type or drawn from a whole plot, and the
 * sub-unit areas, shares and unit counts. Every formula copies the ENGINE rule
 * it replaces (named at each block), never a re-derivation:
 *
 *   dates        computePhaseTimeline (annual: end = start + cp years - 1 day,
 *                operations start the day after, end after op years)
 *   axis year    the earliest phase start's year (computeProjectTimeline)
 *   land chain   computeLandChain, fed as computeAssetChain feeds it
 *                (resolveChainDefaults: the plot's figure, else the type's)
 *   retail carve retailCarveContext / carveRetailLand: each host's GROSS land
 *                runs a bare chain (coverage, FAR, service inherited; NOT
 *                utilisation) and gives up gross x retail GFA / total GFA
 *   totals       totalsFromRows (sums; landscape %, unit size and parking ratio
 *                from the sums)
 *   land by asset resolveAssetAreaMetrics (value = sqm x the plot's rate, cash
 *                and in-kind at each plot's own split)
 *
 * REFUSES rather than approximates: a monthly model, a phase overlap, a land
 * mode other than sqm, a multi-parcel / custom-rate / weighted land draw, an
 * asset whose land draw is unset, and a retail host whose utilisation is
 * inherited (the carve chain would read none, and Excel cannot tell a typed
 * cell from an inherited one once it is edited). A refusal leaves every sheet
 * of this stage as values and says why on the sheet.
 *
 * STRUCTURAL, stated on the sheets: which plot an asset draws from, the
 * parking ratio basis, and which assets host which retail strip are fixed at
 * export; a figure that was blank ("-") at export stays text until re-export.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import type { CellRegistry } from '../cellRegistry';
import { quoteSheet, colLetter } from '../styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isRetailCompanion, retailCompanionSubUnitId } from '@/src/core/calculations/retailCompanion';
import { resolveAssetPlotDraw, computeAssetUnitCount } from '@/src/core/calculations';
import { groupAssetsForConsolidation } from '@/src/core/calculations/consolidation';
import {
  resolveAssetTypeKey, resolveAssetTypeValues, resolveRetailSlotArea, resolveRetailSlotTypeId, normaliseAssetTypeId,
} from '../../state/assetTypeStandards';
import { assetHasSubstance } from '../../../components/modules/_shared/assetTableModel';
import { buildSubUnitLines, buildAssetLandView } from '../../../components/modules/_shared/assetInputsView';
import type { Asset, Parcel, SubUnit } from '../../state/module1-types';

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const serialOf = (iso: string): number => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000);

class Writer {
  formulas = new Map<string, number>();
  constructor(private wb: ExcelJS.Workbook, private reg: CellRegistry) {}
  has(key: string): boolean { return this.reg.get(key) !== undefined; }
  /** Absolute, sheet-qualified reference to a registered cell. */
  ref(key: string): string {
    const a = this.reg.need(key);
    return `${quoteSheet(a.sheet)}!$${colLetter(a.col)}$${a.row}`;
  }
  cell(key: string): ExcelJS.Cell { const a = this.reg.need(key); return this.wb.getWorksheet(a.sheet)!.getCell(a.row, a.col); }
  /** Write a formula over a registered cell, caching the value the platform wrote there. */
  f(key: string, formula: string, numFmt?: string): void {
    const c = this.cell(key);
    const v = c.value as unknown;
    const cached = (v && typeof v === 'object' && 'result' in (v as object)) ? (v as { result: unknown }).result : v;
    c.value = { formula, result: (typeof cached === 'number' || typeof cached === 'string') ? cached : undefined } as unknown as ExcelJS.CellValue;
    if (numFmt) c.numFmt = numFmt;
    const sheet = this.reg.need(key).sheet;
    this.formulas.set(sheet, (this.formulas.get(sheet) ?? 0) + 1);
  }
  /** Re-type an input's value (a stored text date becomes a real date the formulas can read). */
  input(key: string, value: number, numFmt: string): void { const c = this.cell(key); c.value = value; c.numFmt = numFmt; }
}


export const stage1LandArea: LiveLayer = {
  name: 'stage 1: timeline, land and area',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    // The builder resolves asset names at its front door; the layer reads the SAME state.
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const project = state.project;

    // ── Refusals: configurations this stage does not implement ────────────────
    const refuse: string[] = [];
    if ((project.modelType ?? 'annual') !== 'annual') refuse.push('the model is monthly');
    if (state.phases.some((p) => (p.overlapPeriods ?? 0) > 0)) refuse.push('a phase overlaps construction with operations');
    if (state.phases.some((p) => !(p.startDate && p.startDate.length === 10))) refuse.push('a phase has no start date of its own');
    if (state.landAllocationMode !== 'sqm') refuse.push('land is not allocated by sqm');
    const visible = state.assets.filter((a) => a.visible !== false) as Asset[];
    const hosts = visible.filter((a) => !isRetailCompanion(a) && a.isCompanion !== true);
    const strips = visible.filter((a) => isRetailCompanion(a));
    for (const a of hosts) {
      const draw = resolveAssetPlotDraw(a, state.parcels as Parcel[], visible);
      if (!draw || draw.source === 'unset') refuse.push(`${a.name} has no plot draw`);
      if ((a.landAllocation?.multiParcelSplits?.length ?? 0) > 0) refuse.push(`${a.name} draws from several plots`);
    }
    const hostOf = new Map<string, Asset>();
    for (const s of strips) for (const h of s.retailHostAssetIds ?? []) hostOf.set(h, s);
    for (const [hid] of hostOf) {
      const h = hosts.find((a) => a.id === hid);
      if (h && typeof h.landChain?.utilisationPct !== 'number') refuse.push(`${h.name} hosts retail but states no utilisation of its own`);
    }
    const SHEETS = ['Timeline', 'Land & Area', 'Inputs'];
    if (refuse.length) {
      return SHEETS.map((sheet) => ({ sheet, status: 'values' as const, formulas: 0, note: `Stage 1 could not make this sheet live for this model: ${refuse.join('; ')}.` }));
    }

    const w = new Writer(wb, reg);
    const R = (k: string): string => w.ref(k);

    // ── Inputs: dates (computePhaseTimeline) and the axis year ────────────────
    if (w.has('project:startDate') && project.startDate) w.input('project:startDate', serialOf(project.startDate), 'dd mmm yyyy');
    for (const ph of state.phases) {
      const k = (x: string): string => `phase:${ph.id}:${x}`;
      w.input(k('start'), serialOf(ph.startDate as string), 'dd mmm yyyy');
      const s = R(k('start')), cp = R(k('cp')), op = R(k('op'));
      w.f(k('cEnd'), `IF(${cp}=0,"Operational from start",EDATE(${s},12*${cp})-1)`, 'mmm yyyy');
      w.f(k('oStart'), `IF(${cp}=0,${s},EDATE(${s},12*${cp}))`, 'mmm yyyy');
      w.f(k('oEnd'), `EDATE(${R(k('oStart'))},12*${op})-1`, 'mmm yyyy');
    }
    const starts = state.phases.map((ph) => R(`phase:${ph.id}:start`)).join(',');
    w.f('project:axisYear', `YEAR(MIN(${starts}))`);

    // ── Timeline ──────────────────────────────────────────────────────────────
    const yearCols = reg.keys().filter((key) => key.startsWith('tl:year:')).map((key) => Number(key.split(':')[2])).sort((a, b) => a - b);
    yearCols.forEach((c, i) => w.f(`tl:year:${c}`, i === 0 ? `${R('project:axisYear')}-1` : `${R(`tl:year:${yearCols[i - 1]}`)}+1`));
    for (const ph of state.phases) {
      const t = (x: string): string => `tl:phase:${ph.id}:${x}`, p = (x: string): string => R(`phase:${ph.id}:${x}`);
      w.f(t('cs'), p('start'), 'mmm yyyy'); w.f(t('ce'), p('cEnd'), 'mmm yyyy');
      w.f(t('os'), p('oStart'), 'mmm yyyy'); w.f(t('oe'), p('oEnd'), 'mmm yyyy');
      w.f(t('cp'), p('cp')); w.f(t('op'), p('op'));
    }
    w.f('tl:project:start', `MIN(${state.phases.map((ph) => R(`phase:${ph.id}:start`)).join(',')})`, 'mmm yyyy');
    w.f('tl:project:end', `MAX(${state.phases.map((ph) => R(`phase:${ph.id}:oEnd`)).join(',')})`, 'mmm yyyy');
    for (const c of yearCols) if (w.has(`tl:ganttYear:${c}`)) w.f(`tl:ganttYear:${c}`, R(`tl:year:${c}`));
    liveGantt(wb, reg, state.phases.map((ph) => ph.id), yearCols);

    // ── Inputs: plots (value = area x rate, cash / in-kind at the plot's split) ──
    for (const pa of state.parcels as Parcel[]) {
      const k = (x: string): string => `parcel:${pa.id}:${x}`;
      w.f(k('value'), `MAX(0,${R(k('area'))})*MAX(0,${R(k('rate'))})`);
      w.f(k('cashValue'), `${R(k('value'))}*MAX(0,${R(k('cash'))})`);
      w.f(k('inkindValue'), `${R(k('value'))}*MAX(0,${R(k('inkind'))})`);
    }
    const plotsCol = (x: string): string => (state.parcels as Parcel[]).map((pa) => R(`parcel:${pa.id}:${x}`)).join(',');
    if (w.has('parcels:total:area')) {
      w.f('parcels:total:area', `${(state.parcels as Parcel[]).map((pa) => `MAX(0,${R(`parcel:${pa.id}:area`)})`).join('+')}`);
      w.f('parcels:total:value', `SUM(${plotsCol('value')})`);
      w.f('parcels:total:rate', `IF(${R('parcels:total:area')}>0,${R('parcels:total:value')}/${R('parcels:total:area')},0)`);
      w.f('parcels:total:cashValue', `SUM(${plotsCol('cashValue')})`);
      w.f('parcels:total:inkindValue', `SUM(${plotsCol('inkindValue')})`);
    }

    // ── Inputs Table 2: whole-plot draws and inherited massing are formulas ───
    const typeKey = (a: Asset): string | undefined => resolveAssetTypeKey(a);
    const typeRef = (a: Asset, field: string): string | undefined => {
      const t = typeKey(a);
      return t && w.has(`type:${t}:${field}`) ? R(`type:${t}:${field}`) : undefined;
    };
    for (const a of hosts) {
      const e = (x: string): string => `entry:${a.id}:${x}`;
      if (!w.has(e('plot'))) continue;
      const draw = resolveAssetPlotDraw(a, state.parcels as Parcel[], visible);
      if (draw?.source === 'whole_plot') w.f(e('plot'), R(`parcel:${a.landAllocation?.parcelId}:area`));
      const inherit = (field: 'util' | 'cov' | 'far' | 'svc', typed: number | undefined): void => {
        if (typeof typed === 'number') return;
        const tr = typeRef(a, field);
        if (tr) w.f(e(field), `IF(ISNUMBER(${tr}),${tr},"")`);
      };
      inherit('util', a.landChain?.utilisationPct); inherit('cov', a.landChain?.coveragePct);
      inherit('far', a.landChain?.farRatio); inherit('svc', a.landChain?.servicePct);
    }

    // ── Land & Area: the chain per plot ───────────────────────────────────────
    const slotArea = resolveRetailSlotArea(project.assetTypeValues);
    const retailSlotKey = resolveRetailSlotTypeId(project.assetTypeValues);
    let slotRef: string | undefined;
    if (retailSlotKey !== undefined) {
      if (w.has(`type:${retailSlotKey}:ratio`) && typeof w.cell(`type:${retailSlotKey}:ratio`).value === 'number') slotRef = R(`type:${retailSlotKey}:ratio`);
      else {
        // The ratio the chain reads is on a type NOT in the project's list (its values
        // outlived it). It is shown here as a labelled input, beside parking per slot.
        const lab = w.cell('project:retailSlotLabel');
        lab.value = `Retail parking: sqm of retail GFA per slot (the chain reads this; it is held by "${retailSlotKey}", a type no longer in the list)`;
        lab.font = { name: 'Calibri', size: 8.5, italic: true };
        const cell = w.cell('project:retailSlotArea'); cell.value = slotArea as number; cell.numFmt = '#,##0.00';
        cell.font = { name: 'Calibri', size: 9.5, color: { argb: 'FF1B3A6B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F8' } };
        slotRef = R('project:retailSlotArea');
      }
    }
    const perSlot = w.has('project:slotArea') ? R('project:slotArea') : undefined;
    const suByAsset = new Map<string, SubUnit[]>();
    for (const u of state.subUnits as SubUnit[]) (suByAsset.get(u.assetId) ?? suByAsset.set(u.assetId, []).get(u.assetId)!).push(u);

    const grossRef = (a: Asset): string => {
      const draw = resolveAssetPlotDraw(a, state.parcels as Parcel[], visible);
      return draw?.source === 'typed' ? R(`entry:${a.id}:plot`) : R(`parcel:${a.landAllocation?.parcelId}:area`);
    };
    for (const a of hosts) {
      const ch = (x: string): string => `chain:${a.id}:${x}`;
      if (!w.has(ch('land'))) continue;
      const e = (x: string): string => R(`entry:${a.id}:${x}`);
      const G = grossRef(a);
      // Carve (retailCarveContext): the bare chain on the GROSS land, the plot's own utilisation.
      let L = `MAX(0,${G})`;
      if (hostOf.has(a.id)) {
        // Coverage and FAR here are the plot's, else the type's: the Table 2 cells, which inherit by formula.
        const cov = e('cov'), far = e('far'), ret = `N(${e('retail')})`;
        const retail = `(${G}*${e('util')}*${cov}*${ret})`, total = `(${G}*${e('util')}*${far})`;
        L = `MAX(0,${G}-IF(${total}>0,${G}*${retail}/${total},0))`;
      }
      w.f(ch('land'), L);
      const util = e('util'), cov = e('cov'), far = e('far'), svc = e('svc'), ret = `N(${e('retail')})`;
      w.f(ch('nda'), `${R(ch('land'))}*${util}`);
      w.f(ch('fp'), `${R(ch('nda'))}*${cov}`);
      w.f(ch('lsPct'), `1-${cov}`);
      w.f(ch('ls'), `${R(ch('nda'))}*(1-${cov})`);
      w.f(ch('ret'), `${R(ch('fp'))}*${ret}`);
      w.f(ch('lob'), `${R(ch('fp'))}-${R(ch('ret'))}`);
      w.f(ch('tg'), `${R(ch('nda'))}*${far}`);
      w.f(ch('main'), `IF(${ret}=0,${R(ch('tg'))},${R(ch('tg'))}-${R(ch('ret'))}-${R(ch('lob'))})`);
      w.f(ch('nsa'), `${R(ch('main'))}*(1-N(${svc}))`);
      // Unit size (resolveAvgUnitSize): the sub-units' stated sizes first, the type's as the fallback.
      const sized = (suByAsset.get(a.id) ?? []).filter((u) => w.has(`su:${u.id}:unit`)).map((u) => R(`su:${u.id}:unit`));
      const typeUnit = typeRef(a, 'unit');
      const fallback = typeUnit ? `IF(ISNUMBER(${typeUnit}),${typeUnit},"-")` : '"-"';
      const cnt = sized.map((x) => `COUNTIF(${x},">0")`).join('+'), sm = sized.map((x) => `SUMIF(${x},">0")`).join('+');
      w.f(ch('usize'), sized.length ? `IF(${cnt}>0,(${sm})/(${cnt}),${fallback})` : fallback);
      // Units: a sub-unit count wins, else NSA / unit size rounded.
      const countUnits = computeAssetUnitCount(a, state.subUnits as SubUnit[]) > 0;
      const unitCells = (suByAsset.get(a.id) ?? []).filter((u) => u.category !== 'Support' && w.has(`su:${u.id}:units`)).map((u) => R(`su:${u.id}:units`));
      w.f(ch('units'), countUnits && unitCells.length
        ? `ROUND(SUM(${unitCells.join(',')}),0)`
        : `IF(AND(ISNUMBER(${R(ch('usize'))}),N(${R(ch('usize'))})>0),ROUND(${R(ch('nsa'))}/${R(ch('usize'))},0),"-")`);
      const ratio = typeRef(a, 'ratio');
      w.f(ch('ratio'), ratio ? `IF(ISNUMBER(${ratio}),${ratio},"-")` : '"-"');
      const basis = resolveAssetTypeValues(a, project.assetTypeValues)?.parkingRatioBasis;
      w.f(ch('slots'), basis === 'sqm_per_slot'
        ? `IF(ISNUMBER(${R(ch('ratio'))}),IF(${R(ch('ratio'))}>0,ROUND(${R(ch('main'))}/${R(ch('ratio'))},0),0),"-")`
        : `IF(AND(ISNUMBER(${R(ch('ratio'))}),ISNUMBER(${R(ch('units'))})),ROUND(${R(ch('units'))}*${R(ch('ratio'))},0),"-")`);
      w.f(ch('rslots'), slotRef ? `IF(${R(ch('ret'))}>0,IF(${slotRef}>0,ROUND(${R(ch('ret'))}/${slotRef},0),"-"),"-")` : '"-"');
      w.f(ch('tslots'), `IF(AND(NOT(ISNUMBER(${R(ch('slots'))})),NOT(ISNUMBER(${R(ch('rslots'))}))),"-",N(${R(ch('slots'))})+N(${R(ch('rslots'))}))`);
      w.f(ch('parea'), perSlot ? `IF(AND(ISNUMBER(${R(ch('slots'))}),ISNUMBER(${perSlot})),${R(ch('slots'))}*${perSlot},"-")` : '"-"');
      w.f(ch('rparea'), perSlot ? `IF(AND(ISNUMBER(${R(ch('rslots'))}),ISNUMBER(${perSlot})),${R(ch('rslots'))}*${perSlot},"-")` : '"-"');
      w.f(ch('tparea'), `IF(AND(NOT(ISNUMBER(${R(ch('parea'))})),NOT(ISNUMBER(${R(ch('rparea'))}))),"-",N(${R(ch('parea'))})+N(${R(ch('rparea'))}))`);
      w.f(ch('bua'), `${R(ch('tg'))}+N(${R(ch('tparea'))})`);
    }

    // Retail pieces: what each strip carved from each plot = sum over its hosts there of gross - net.
    const pieceKeys = reg.keys().filter((k) => k.startsWith('piece:'));
    for (const pk of pieceKeys) {
      const [, parcelId, ...nameParts] = pk.split(':'); const name = nameParts.join(':');
      const strip = strips.find((s) => s.name === name);
      const hs = (strip?.retailHostAssetIds ?? []).map((id) => hosts.find((h) => h.id === id)).filter((h): h is Asset => !!h && h.landAllocation?.parcelId === parcelId);
      w.f(pk, hs.length ? hs.map((h) => `(${grossRef(h)}-${R(`chain:${h.id}:land`)})`).join('+') : '0');
    }

    // Totals (totalsFromRows): sums, with the three ratios from the sums.
    const chainRows = hosts.filter((a) => w.has(`chain:${a.id}:land`)).map((a) => `chain:${a.id}`);
    const sumOf = (rows: string[], f: string): string => rows.map((r) => R(`${r}:${f}`)).join(',');
    const SUMMED = ['nda', 'fp', 'ls', 'ret', 'lob', 'tg', 'main', 'nsa', 'units', 'slots', 'rslots', 'tslots', 'parea', 'rparea', 'tparea', 'bua'];
    const writeTotals = (prefix: string, rows: string[], extraLand: string[]): void => {
      if (!w.has(`${prefix}:land`)) return;
      w.f(`${prefix}:land`, `SUM(${[...rows.map((r) => R(`${r}:land`)), ...extraLand].join(',')})`);
      for (const f of SUMMED) {
        if (!w.has(`${prefix}:${f}`)) continue;
        const cells = sumOf(rows, f);
        if (typeof w.cell(`${prefix}:${f}`).value === 'string') w.f(`${prefix}:${f}`, `IF(COUNT(${cells})=0,"-",SUM(${cells}))`);
        else w.f(`${prefix}:${f}`, `SUM(${cells})`);
      }
      w.f(`${prefix}:lsPct`, `IF(N(${R(`${prefix}:nda`)})>0,N(${R(`${prefix}:ls`)})/${R(`${prefix}:nda`)},"-")`);
      w.f(`${prefix}:usize`, `IF(N(${R(`${prefix}:units`)})>0,N(${R(`${prefix}:nsa`)})/${R(`${prefix}:units`)},"-")`);
      w.f(`${prefix}:ratio`, `IF(N(${R(`${prefix}:units`)})>0,N(${R(`${prefix}:slots`)})/${R(`${prefix}:units`)},"-")`);
    };
    const pieceRefs = pieceKeys.map((k) => R(k));
    writeTotals('chaintot:plots', chainRows, pieceRefs);
    writeTotals('chaintot:lines', chainRows, pieceRefs);

    // Lines (groupAssetsForConsolidation; a member without substance is not pooled).
    const groups = groupAssetsForConsolidation(visible as unknown as Parameters<typeof groupAssetsForConsolidation>[0], state.phases.map((p) => p.id), normaliseAssetTypeId);
    for (const g of groups) {
      const prefix = `chainline:${g.key}`;
      const members = (g.assets as unknown as Asset[]).filter((m) => w.has(`chain:${m.id}:land`) && assetHasSubstance(m, state.subUnits as SubUnit[]));
      if (members.length === 0 || !w.has(`${prefix}:land`)) continue;
      writeTotals(prefix, members.map((m) => `chain:${m.id}`), []);
    }
    // Retail strips on the line table: land carved, and their hosts' retail figures.
    for (const s of strips) {
      const prefix = `chaincomp:${s.name}`;
      if (!w.has(`${prefix}:land`)) continue;
      const hs = (s.retailHostAssetIds ?? []).filter((id) => w.has(`chain:${id}:land`));
      const mine = pieceKeys.filter((k) => k.split(':').slice(2).join(':') === s.name).map((k) => R(k));
      w.f(`${prefix}:land`, mine.length ? `SUM(${mine.join(',')})` : '0');
      const sumHost = (f: string): string => (hs.length ? `SUM(${hs.map((id) => R(`chain:${id}:${f}`)).join(',')})` : '0');
      w.f(`${prefix}:ret`, sumHost('ret')); w.f(`${prefix}:tg`, R(`${prefix}:ret`)); w.f(`${prefix}:nsa`, R(`${prefix}:ret`));
      w.f(`${prefix}:rslots`, sumHost('rslots')); w.f(`${prefix}:rparea`, sumHost('rparea')); w.f(`${prefix}:tparea`, R(`${prefix}:rparea`));
      w.f(`${prefix}:bua`, `${R(`${prefix}:ret`)}+N(${R(`${prefix}:tparea`)})`);
    }

    // Land by asset (resolveAssetAreaMetrics).
    const landView = buildAssetLandView(state);
    const pRef = (pid: string | undefined, f: string): string => R(`parcel:${pid}:${f}`);
    for (const lv of landView) {
      const k = (x: string): string => `land:${lv.assetId}:${x}`;
      if (!w.has(k('sqm'))) continue;
      const a = visible.find((x) => x.id === lv.assetId)!;
      if (isRetailCompanion(a)) {
        const pieces = pieceKeys.filter((pk) => pk.split(':').slice(2).join(':') === a.name).map((pk) => ({ pk, parcel: pk.split(':')[1] }));
        w.f(k('sqm'), pieces.length ? `SUM(${pieces.map((p) => R(p.pk)).join(',')})` : '0');
        w.f(k('value'), pieces.length ? pieces.map((p) => `${R(p.pk)}*MAX(0,${pRef(p.parcel, 'rate')})`).join('+') : '0');
        w.f(k('rate'), `IF(${R(k('sqm'))}>0,${R(k('value'))}/${R(k('sqm'))},0)`);
        w.f(k('cash'), pieces.length ? pieces.map((p) => `${R(p.pk)}*MAX(0,${pRef(p.parcel, 'rate')})*MAX(0,${pRef(p.parcel, 'cash')})`).join('+') : '0');
        w.f(k('inkind'), pieces.length ? pieces.map((p) => `${R(p.pk)}*MAX(0,${pRef(p.parcel, 'rate')})*MAX(0,${pRef(p.parcel, 'inkind')})`).join('+') : '0');
      } else {
        const pid = a.landAllocation?.parcelId;
        w.f(k('sqm'), R(`chain:${a.id}:land`));
        w.f(k('rate'), `MAX(0,${pRef(pid, 'rate')})`);
        w.f(k('value'), `${R(k('sqm'))}*${R(k('rate'))}`);
        w.f(k('cash'), `${R(k('value'))}*MAX(0,${pRef(pid, 'cash')})`);
        w.f(k('inkind'), `${R(k('value'))}*MAX(0,${pRef(pid, 'inkind')})`);
      }
    }
    const cats = [...new Set(landView.map((x) => x.category))];
    for (const cat of cats) {
      const rows = landView.filter((x) => x.category === cat && w.has(`land:${x.assetId}:sqm`));
      for (const f of ['sqm', 'value', 'cash', 'inkind']) if (w.has(`landcat:${cat}:${f}`)) w.f(`landcat:${cat}:${f}`, `SUM(${rows.map((x) => R(`land:${x.assetId}:${f}`)).join(',')})`);
    }
    for (const f of ['sqm', 'value', 'cash', 'inkind']) if (w.has(`landtot:${f}`)) w.f(`landtot:${f}`, `SUM(${landView.filter((x) => w.has(`land:${x.assetId}:${f}`)).map((x) => R(`land:${x.assetId}:${f}`)).join(',')})`);

    // ── Inputs Table 5: sub-unit area follows the line's NSA through its share ─
    for (const line of buildSubUnitLines(state)) {
      const strip = strips.find((s) => `retail__${s.id}` === line.key);
      const nsaKey = strip ? `chaincomp:${strip.name}:nsa` : `chainline:${line.key}:nsa`;
      if (!w.has(nsaKey)) continue;
      const nsa = R(nsaKey);
      const areas: string[] = [];
      for (const u of line.rows) {
        const k = (x: string): string => `su:${u.id}:${x}`;
        if (!w.has(k('area'))) continue;
        // A STRIP'S DERIVED ROW (reconcileRetailSubUnits) holds the pooled retail GFA while it is
        // the strip's only row; once the user adds a second, the split is theirs.
        const derivedStripRow = !!strip && u.id === retailCompanionSubUnitId(strip.id)
          && (state.subUnits as SubUnit[]).filter((x) => x.assetId === strip.id).length === 1;
        if (derivedStripRow) {
          w.f(k('area'), nsa);
          w.f(k('share'), `IF(${nsa}>0,${R(k('area'))}/${nsa},"")`);
        } else if (u.metric === 'area') {
          if (u.sharePct.typed) w.f(k('area'), `${R(k('share'))}*${nsa}`);
          else if (u.areaSqm.typed) w.f(k('share'), `IF(${nsa}>0,${R(k('area'))}/${nsa},"")`);
          w.f(k('units'), `IF(N(${R(k('unit'))})>0,ROUND(${R(k('area'))}/${R(k('unit'))},0),"")`);
        }
        areas.push(R(k('area')));
      }
      if (w.has(`suline:${line.key}:area`) && areas.length) {
        w.f(`suline:${line.key}:area`, `SUM(${areas.join(',')})`);
        if (typeof w.cell(`suline:${line.key}:share`).value === 'number') w.f(`suline:${line.key}:share`, `IF(${nsa}>0,${R(`suline:${line.key}:area`)}/${nsa},"")`);
      }
    }

    const counts = w.formulas;
    return [
      { sheet: 'Timeline', status: 'live' as const, formulas: counts.get('Timeline') ?? 0, note: 'The axis years, the dated phase schedule and the Gantt (conditional formatting) follow the phase dates on Inputs. The axis length is fixed at export.' },
      { sheet: 'Land & Area', status: 'live' as const, formulas: counts.get('Land & Area') ?? 0, note: 'The chain per plot, merged by line, the retail carve and the land by asset follow Inputs. Which plot an asset draws, the parking ratio basis and which assets host a retail strip are fixed at export; a step shown "-" at export stays "-".' },
      { sheet: 'Inputs', status: 'partial' as const, formulas: counts.get('Inputs') ?? 0, note: 'Live on this sheet: the phase dates, the model axis year, the plot values, Table 2 figures drawn from a whole plot or inherited from a type, and the sub-unit areas, shares and unit counts.' },
    ];
  },
};

/** The Gantt: bars painted by conditional formatting from the dated schedule, not by fixed fills. */
function liveGantt(wb: ExcelJS.Workbook, reg: CellRegistry, phaseIds: string[], yearCols: number[]): void {
  const ws = wb.getWorksheet('Timeline'); if (!ws || yearCols.length === 0) return;
  const hdr = reg.get(`tl:ganttYear:${yearCols[0]}`); if (!hdr) return;
  const first = colLetter(yearCols[0]), last = colLetter(yearCols[yearCols.length - 1]);
  const hdrRow = hdr.row;
  const cellOf = (k: string): string => { const a = reg.need(k); return `$${colLetter(a.col)}$${a.row}`; };
  for (const id of phaseIds) {
    const row = reg.get(`tl:gantt:${id}`)?.row; if (!row) continue;
    for (const c of yearCols) ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F7' } };
    const k = (x: string): string => cellOf(`tl:phase:${id}:${x}`);
    ws.addConditionalFormatting({ ref: `${first}${row}:${last}${row}`, rules: [
      { type: 'expression', priority: 1, stopIfTrue: true, formulae: [`AND(${k('op')}>0,YEAR(${k('os')})<=${first}$${hdrRow},${first}$${hdrRow}<=YEAR(${k('oe')}))`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF2EAA4A' } } } },
      { type: 'expression', priority: 2, stopIfTrue: true, formulae: [`AND(${k('cp')}>0,YEAR(${k('cs')})<=${first}$${hdrRow},${first}$${hdrRow}<=YEAR(${k('ce')}))`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF1B3A6B' } } } },
    ] } as unknown as Parameters<typeof ws.addConditionalFormatting>[0]);
  }
  const endRow = reg.get('tl:gantt:end')?.row;
  if (endRow) {
    for (const c of yearCols) {
      const cell = ws.getCell(endRow, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F7' } };
      cell.value = { formula: `IF(${colLetter(c)}$${hdrRow}=YEAR(${cellOf('tl:project:end')}),"END","")`, result: typeof cell.value === 'string' ? cell.value : '' } as unknown as ExcelJS.CellValue;
    }
    ws.addConditionalFormatting({ ref: `${first}${endRow}:${last}${endRow}`, rules: [
      { type: 'expression', priority: 3, formulae: [`${first}$${hdrRow}=YEAR(${cellOf('tl:project:end')})`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF0D2E5A' } } } },
    ] } as unknown as Parameters<typeof ws.addConditionalFormatting>[0]);
  }
}
