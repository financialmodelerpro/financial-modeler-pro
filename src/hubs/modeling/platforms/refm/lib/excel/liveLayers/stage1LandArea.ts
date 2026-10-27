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
 * export. A figure the chain cannot derive is 0, never a "-" (2026-10-26), so no formula guards text.
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
import { buildSubUnitLines, buildAssetLandView, buildAssetAreaTables } from '../../../components/modules/_shared/assetInputsView';
import { nsaUsedLines } from '../inputsSheetSections';
import { nsaUsedFormula } from './liveAreas';
import { planReportLines } from '../../reports/lineRows';
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
  /** A cell by sheet and position, for a row the registry names by its label only. */
  sheetCell(sheet: string, row: number, col: number): ExcelJS.Cell { return this.wb.getWorksheet(sheet)!.getCell(row, col); }
  /** Write a formula at a cell, caching what the platform wrote there (or `cached`). */
  fAt(c: ExcelJS.Cell, formula: string, cached?: number): void {
    const v = c.value as unknown;
    const was = (v && typeof v === 'object' && 'result' in (v as object)) ? (v as { result: unknown }).result : v;
    c.value = { formula, result: cached ?? ((typeof was === 'number' || typeof was === 'string') ? was : undefined) } as unknown as ExcelJS.CellValue;
    const sheet = c.worksheet.name;
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
    // THE TIMELINE IS THE ONE SOURCE OF TIMING (2026-10-26, founder): its phase table reads the
    // three typed cells per phase on Inputs (start, construction and operations years) and the
    // status; every date, year and flag below reads that table, and no other tab reads Inputs for timing.
    for (const ph of state.phases) w.input(`phase:${ph.id}:start`, serialOf(ph.startDate as string), 'dd mmm yyyy');
    for (const ph of state.phases) {
      const t = (x: string): string => `tl:phase:${ph.id}:${x}`, p = (x: string): string => R(`phase:${ph.id}:${x}`);
      w.f(t('cs'), p('start'), 'mmm yyyy');
      w.f(t('cp'), p('cp')); w.f(t('op'), p('op'));
      if (w.has(t('status')) && w.has(`phase:${ph.id}:status`)) w.f(t('status'), p('status'));
    }
    for (const ph of state.phases) {
      const k = (x: string): string => `phase:${ph.id}:${x}`;
      const C = R(`tl:phase:${ph.id}:cs`), G = R(`tl:phase:${ph.id}:cp`), H = R(`tl:phase:${ph.id}:op`);
      // Construction end is always a date: with no construction, the start date.
      w.f(k('cEnd'), `IF(${G}=0,${C},EDATE(${C},12*${G})-1)`, 'mmm yyyy');
      w.f(k('oStart'), `EDATE(${C},12*${G})`, 'mmm yyyy');
      w.f(k('oEnd'), `EDATE(${R(k('oStart'))},12*${H})-1`, 'mmm yyyy');
    }
    const starts = state.phases.map((ph) => R(`tl:phase:${ph.id}:cs`)).join(',');
    w.f('project:axisYear', `YEAR(MIN(${starts}))`);

    // ── Timeline ──────────────────────────────────────────────────────────────
    const yearCols = reg.keys().filter((key) => key.startsWith('tl:year:')).map((key) => Number(key.split(':')[2])).sort((a, b) => a - b);
    // One formula across the row: each year is the year before it plus one.
    yearCols.forEach((c, i) => w.f(`tl:year:${c}`, i === 0 ? `${R('project:axisYear')}-1` : `${colLetter(yearCols[i - 1])}$${reg.need(`tl:year:${c}`).row}+1`));
    for (const ph of state.phases) {
      const t = (x: string): string => `tl:phase:${ph.id}:${x}`, p = (x: string): string => R(`phase:${ph.id}:${x}`);
      // In the live layout the end dates are worked out on these very cells (one key, two names).
      const same = (x: string, y: string): boolean => { const A = reg.need(t(x)), B = reg.need(`phase:${ph.id}:${y}`); return A.sheet === B.sheet && A.row === B.row && A.col === B.col; };
      if (!same('ce', 'cEnd')) w.f(t('ce'), p('cEnd'), 'mmm yyyy');
      if (!same('os', 'oStart')) w.f(t('os'), p('oStart'), 'mmm yyyy');
      if (!same('oe', 'oEnd')) w.f(t('oe'), p('oEnd'), 'mmm yyyy');
    }
    w.f('tl:project:start', `MIN(${starts})`, 'mmm yyyy');
    if (w.has('tl:project:count') && state.phases.length) {
      const rows = state.phases.map((ph) => reg.need(`tl:phase:${ph.id}:cs`).row);
      w.f('tl:project:count', `COUNTA($A$${Math.min(...rows)}:$A$${Math.max(...rows)})`);
    }
    w.f('tl:project:end', `MAX(${state.phases.map((ph) => R(`phase:${ph.id}:oEnd`)).join(',')})`, 'mmm yyyy');
    for (const c of yearCols) if (w.has(`tl:ganttYear:${c}`)) w.f(`tl:ganttYear:${c}`, R(`tl:year:${c}`));
    liveGantt(wb, reg, state.phases.map((ph) => ph.id), yearCols);
    livePeriodFlags(w, reg, state.phases.map((ph) => ph.id), yearCols);

    // ── Inputs: plots (value = area x rate, cash / in-kind at the plot's split) ──
    for (const pa of state.parcels as Parcel[]) {
      const k = (x: string): string => `parcel:${pa.id}:${x}`;
      if (w.has(k('areaEcho'))) { w.f(k('areaEcho'), `MAX(0,${R(k('area'))})`); w.f(k('rateEcho'), R(k('rate'))); }
      w.f(k('value'), w.has(k('areaEcho')) ? `MAX(0,${R(k('areaEcho'))})*MAX(0,${R(k('rateEcho'))})` : `MAX(0,${R(k('area'))})*MAX(0,${R(k('rate'))})`);
      w.f(k('cashValue'), `${R(k('value'))}*MAX(0,${R(k('cash'))})`);
      w.f(k('inkindValue'), `${R(k('value'))}*MAX(0,${R(k('inkind'))})`);
    }
    const plotsCol = (x: string): string => (state.parcels as Parcel[]).map((pa) => R(`parcel:${pa.id}:${x}`)).join(',');
    if (w.has('parcels:total:area')) {
      w.f('parcels:total:area', (state.parcels as Parcel[]).every((pa) => w.has(`parcel:${pa.id}:areaEcho`))
        ? `SUM(${plotsCol('areaEcho')})`
        : `${(state.parcels as Parcel[]).map((pa) => `MAX(0,${R(`parcel:${pa.id}:area`)})`).join('+')}`);
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
    const slotArea = resolveRetailSlotArea(project, visible);
    const retailSlotKey = resolveRetailSlotTypeId(project, visible);
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
    // THE RETAIL CARVE-OUT IS ITS OWN ROW (2026-10-26; retailCarveContext / carveRetailLand): what a
    // strip takes from a host is the host's GROSS land x retail GFA / total GFA on the bare chain,
    // which is gross x coverage x retail % / FAR (the land and utilisation cancel), at most the gross.
    // The plot table's carve-out row adds it over the plot's hosts; a host's land is its gross less it.
    const carveOf = (h: Asset): string => {
      const e = (x: string): string => R(`entry:${h.id}:${x}`);
      const G = grossRef(h);
      return `IF(${G}*${e('util')}*${e('far')}>0,MIN(${G},${G}*${e('cov')}*N(${e('retail')})/${e('far')}),0)`;
    };
    const pieceKeys = reg.keys().filter((k) => k.startsWith('piece:'));
    /** The hosts a carve-out row adds: the strip's hosts drawing from that plot. */
    const pieceHosts = (pk: string): Asset[] => {
      const [, parcelId, ...nameParts] = pk.split(':'); const name = nameParts.join(':');
      const strip = strips.find((s) => s.name === name);
      return (strip?.retailHostAssetIds ?? []).map((id) => hosts.find((h) => h.id === id)).filter((h): h is Asset => !!h && h.landAllocation?.parcelId === parcelId);
    };
    for (const a of hosts) {
      const ch = (x: string): string => `chain:${a.id}:${x}`;
      if (!w.has(ch('land'))) continue;
      const e = (x: string): string => R(`entry:${a.id}:${x}`);
      const G = grossRef(a);
      let L = `MAX(0,${G})`;
      const strip = hostOf.get(a.id);
      if (strip) {
        const pk = `piece:${a.landAllocation?.parcelId}:${strip.name}`;
        const alone = w.has(pk) && pieceHosts(pk).length === 1;
        L = `MAX(0,${G}-${alone ? R(pk) : carveOf(a)})`;
      }
      w.f(ch('land'), L);
      const util = e('util'), cov = e('cov'), far = e('far'), svc = e('svc'), ret = `N(${e('retail')})`;
      w.f(ch('nda'), `${R(ch('land'))}*${util}`);
      w.f(ch('fp'), `${R(ch('nda'))}*${cov}`);
      w.f(ch('lsPct'), `1-${cov}`);
      w.f(ch('ls'), `${R(ch('nda'))}*(1-${cov})`);
      w.f(ch('ret'), `${R(ch('fp'))}*${ret}`);
      // A lobby exists only beside retail, so main GFA is one subtraction (landChain.ts, 2026-09-30).
      w.f(ch('lob'), `IF(${ret}>0,${R(ch('fp'))}-${R(ch('ret'))},0)`);
      w.f(ch('tg'), `${R(ch('nda'))}*${far}`);
      w.f(ch('main'), `${R(ch('tg'))}-${R(ch('ret'))}-${R(ch('lob'))}`);
      w.f(ch('nsa'), `${R(ch('main'))}*(1-N(${svc}))`);
      // NO "-" IN A NUMBER CELL (2026-10-26): a figure the chain cannot derive is 0, so every step is a
      // plain formula. Unit size (resolveAvgUnitSize): the sub-units' stated sizes first, the type's as the fallback.
      const sized = (suByAsset.get(a.id) ?? []).filter((u) => w.has(`su:${u.id}:unit`)).map((u) => R(`su:${u.id}:unit`));
      const typeUnit = typeRef(a, 'unit');
      const fallback = typeUnit ?? '0';
      const cnt = sized.map((x) => `COUNTIF(${x},">0")`).join('+'), sm = sized.map((x) => `SUMIF(${x},">0")`).join('+');
      if (sized.length || typeUnit) w.f(ch('usize'), sized.length ? `IF(${cnt}>0,(${sm})/(${cnt}),${fallback})` : fallback);
      // Units: a sub-unit count wins, else NSA / unit size rounded.
      const countUnits = computeAssetUnitCount(a, state.subUnits as SubUnit[]) > 0;
      const unitCells = (suByAsset.get(a.id) ?? []).filter((u) => u.category !== 'Support' && w.has(`su:${u.id}:units`)).map((u) => R(`su:${u.id}:units`));
      w.f(ch('units'), countUnits && unitCells.length
        ? `ROUND(SUM(${unitCells.join(',')}),0)`
        : `IF(${R(ch('usize'))}>0,ROUND(${R(ch('nsa'))}/${R(ch('usize'))},0),0)`);
      const ratio = typeRef(a, 'ratio');
      if (ratio) w.f(ch('ratio'), ratio);
      const basis = resolveAssetTypeValues(a, project.assetTypeValues)?.parkingRatioBasis;
      w.f(ch('slots'), basis === 'sqm_per_slot'
        ? `IF(${R(ch('ratio'))}>0,ROUND(${R(ch('main'))}/${R(ch('ratio'))},0),0)`
        : `ROUND(${R(ch('units'))}*${R(ch('ratio'))},0)`);
      if (slotRef) w.f(ch('rslots'), `IF(${slotRef}>0,ROUND(${R(ch('ret'))}/${slotRef},0),0)`);
      w.f(ch('tslots'), `${R(ch('slots'))}+${R(ch('rslots'))}`);
      if (perSlot) {
        w.f(ch('parea'), `${R(ch('slots'))}*${perSlot}`);
        w.f(ch('rparea'), `${R(ch('rslots'))}*${perSlot}`);
      }
      w.f(ch('tparea'), `${R(ch('parea'))}+${R(ch('rparea'))}`);
      w.f(ch('bua'), `${R(ch('tg'))}+${R(ch('tparea'))}`);
    }

    // The carve-out rows: what each strip takes from each plot, added over its hosts there.
    for (const pk of pieceKeys) {
      const [, parcelId, ...nameParts] = pk.split(':'); const name = nameParts.join(':');
      const hs = pieceHosts(pk);
      w.f(pk, hs.length ? hs.map(carveOf).join('+') : '0');
      // Its NSA on this plot (retailStripNsaByParcel): the retail GFA its hosts carry here, the strip's
      // NSA being its hosts' retail GFA (its row on the line table reads the same).
      const nk = `piecensa:${parcelId}:${name}`;
      if (w.has(nk)) w.f(nk, hs.length ? `SUM(${hs.map((h) => R(`chain:${h.id}:ret`)).join(',')})` : '0');
    }

    // TOTALS ADD THE ROWS ABOVE THEM (2026-10-26; totalsFromRows): each column of a TOTAL row is the
    // sum of its table's rows (a band row holds no number, and a carve-out or strip row leaves the
    // columns that are not its own blank), with the three ratios from the sums.
    const SUMMED = ['land', 'nda', 'fp', 'ls', 'ret', 'lob', 'tg', 'main', 'nsa', 'units', 'slots', 'rslots', 'tslots', 'parea', 'rparea', 'tparea', 'bua'];
    const chainRows = hosts.filter((a) => w.has(`chain:${a.id}:land`)).map((a) => `chain:${a.id}`);
    const sumOf = (rows: string[], f: string): string => rows.map((r) => R(`${r}:${f}`)).join(',');
    const writeColumnTotals = (prefix: string, rowKeys: string[], unitNsaRows: string[]): void => {
      if (!w.has(`${prefix}:land`) || !rowKeys.length) return;
      const rowsAt = rowKeys.map((k) => reg.need(k).row);
      const r0 = Math.min(...rowsAt), r1 = Math.max(...rowsAt);
      for (const f of SUMMED) {
        if (!w.has(`${prefix}:${f}`)) continue;
        const col = colLetter(reg.need(`${prefix}:${f}`).col);
        w.f(`${prefix}:${f}`, `SUM($${col}$${r0}:$${col}$${r1})`);
      }
      const T = (f: string): string => R(`${prefix}:${f}`);
      w.f(`${prefix}:lsPct`, `IF(${T('nda')}>0,${T('ls')}/${T('nda')},0)`);
      w.f(`${prefix}:usize`, `IF(${T('units')}>0,SUM(${unitNsaRows.map((r) => R(`${r}:nsa`)).join(',')})/${T('units')},0)`);
      w.f(`${prefix}:ratio`, `IF(${T('units')}>0,${T('slots')}/${T('units')},0)`);
    };
    writeColumnTotals('chaintot:plots', [...chainRows.map((r) => `${r}:land`), ...pieceKeys], chainRows);

    // Lines (groupAssetsForConsolidation; a member without substance is not pooled): the sums of their
    // plots' rows, and a host line LEAVES OUT THE RETAIL its strip carries (the strip's line shows it).
    const groups = groupAssetsForConsolidation(visible as unknown as Parameters<typeof groupAssetsForConsolidation>[0], state.phases.map((p) => p.id), normaliseAssetTypeId);
    const lineRows: string[] = [];
    for (const g of groups) {
      const prefix = `chainline:${g.key}`;
      const members = (g.assets as unknown as Asset[]).filter((m) => w.has(`chain:${m.id}:land`) && assetHasSubstance(m, state.subUnits as SubUnit[]));
      if (members.length === 0 || !w.has(`${prefix}:land`)) continue;
      lineRows.push(prefix);
      const rows = members.map((m) => `chain:${m.id}`);
      for (const f of ['land', 'nda', 'fp', 'ls', 'lob', 'main', 'nsa', 'units', 'slots', 'parea']) w.f(`${prefix}:${f}`, `SUM(${sumOf(rows, f)})`);
      // Retail GFA, retail parking slots and area stay 0 here: they are the strip's.
      w.f(`${prefix}:tg`, `SUM(${sumOf(rows, 'tg')})-SUM(${sumOf(rows, 'ret')})`);
      w.f(`${prefix}:tslots`, R(`${prefix}:slots`));
      w.f(`${prefix}:tparea`, R(`${prefix}:parea`));
      w.f(`${prefix}:bua`, `${R(`${prefix}:tg`)}+${R(`${prefix}:tparea`)}`);
      w.f(`${prefix}:lsPct`, `IF(${R(`${prefix}:nda`)}>0,${R(`${prefix}:ls`)}/${R(`${prefix}:nda`)},0)`);
      w.f(`${prefix}:usize`, `IF(${R(`${prefix}:units`)}>0,${R(`${prefix}:nsa`)}/${R(`${prefix}:units`)},0)`);
      w.f(`${prefix}:ratio`, `IF(${R(`${prefix}:units`)}>0,${R(`${prefix}:slots`)}/${R(`${prefix}:units`)},0)`);
      // The plots the line pools: counted, never typed.
      if (w.has(`${prefix}:plots`)) w.f(`${prefix}:plots`, `COUNT(${members.map((m) => R(`chain:${m.id}:land`)).join(',')})`);
    }
    // Retail strips on the line table: the land carved, and the retail its hosts' rows carry.
    const compRows: string[] = [];
    for (const s of strips) {
      const prefix = `chaincomp:${s.name}`;
      if (!w.has(`${prefix}:land`)) continue;
      compRows.push(prefix);
      const hs = (s.retailHostAssetIds ?? []).filter((id) => w.has(`chain:${id}:land`));
      const mine = pieceKeys.filter((k) => k.split(':').slice(2).join(':') === s.name).map((k) => R(k));
      w.f(`${prefix}:land`, mine.length ? `SUM(${mine.join(',')})` : '0');
      if (w.has(`${prefix}:hosts`) && mine.length) w.f(`${prefix}:hosts`, `COUNT(${mine.join(',')})`);
      const sumHost = (f: string): string => (hs.length ? `SUM(${hs.map((id) => R(`chain:${id}:${f}`)).join(',')})` : '0');
      w.f(`${prefix}:ret`, sumHost('ret')); w.f(`${prefix}:tg`, R(`${prefix}:ret`)); w.f(`${prefix}:nsa`, R(`${prefix}:ret`));
      w.f(`${prefix}:rslots`, sumHost('rslots')); w.f(`${prefix}:tslots`, R(`${prefix}:rslots`));
      w.f(`${prefix}:rparea`, sumHost('rparea')); w.f(`${prefix}:tparea`, R(`${prefix}:rparea`));
      w.f(`${prefix}:bua`, `${R(`${prefix}:ret`)}+${R(`${prefix}:tparea`)}`);
    }
    writeColumnTotals('chaintot:lines', [...lineRows, ...compRows].map((r) => `${r}:land`), lineRows);

    // Land by asset (resolveAssetAreaMetrics): area x the plot's rate, cash and in-kind at its split.
    const landView = buildAssetLandView(state);
    const pRef = (pid: string | undefined, f: string): string => R(`parcel:${pid}:${f}`);
    /** One land row: area x rate, the cash and in-kind halves at the plot's split. */
    const landRow = (k: (x: string) => string, sqm: string, pid: string | undefined): void => {
      w.f(k('sqm'), sqm);
      w.f(k('rate'), `MAX(0,${pRef(pid, 'rate')})`);
      w.f(k('value'), `${R(k('sqm'))}*${R(k('rate'))}`);
      w.f(k('cash'), `${R(k('value'))}*MAX(0,${pRef(pid, 'cash')})`);
      w.f(k('inkind'), `${R(k('value'))}*MAX(0,${pRef(pid, 'inkind')})`);
    };
    for (const lv of landView) {
      const k = (x: string): string => `land:${lv.assetId}:${x}`;
      if (!w.has(k('sqm'))) continue;
      const a = visible.find((x) => x.id === lv.assetId)!;
      if (isRetailCompanion(a)) {
        const pieces = pieceKeys.filter((pk) => pk.split(':').slice(2).join(':') === a.name).map((pk) => ({ pk, parcel: pk.split(':')[1] }));
        const lp = (p: { parcel: string }) => (x: string): string => `landpiece:${p.parcel}:${a.name}:${x}`;
        if (pieces.length === 1) landRow(k, R(pieces[0].pk), pieces[0].parcel);
        else if (pieces.length > 1 && pieces.every((p) => w.has(lp(p)('sqm')))) {
          // A strip on several plots: a row per plot (area x that plot's rate), the strip's row their sum.
          for (const p of pieces) landRow(lp(p), R(p.pk), p.parcel);
          for (const f of ['sqm', 'value', 'cash', 'inkind']) w.f(k(f), `SUM(${pieces.map((p) => R(lp(p)(f))).join(',')})`);
          w.f(k('rate'), `IF(${R(k('sqm'))}>0,${R(k('value'))}/${R(k('sqm'))},0)`);
        } else {
          w.f(k('sqm'), pieces.length ? `SUM(${pieces.map((p) => R(p.pk)).join(',')})` : '0');
          w.f(k('value'), pieces.length ? pieces.map((p) => `${R(p.pk)}*MAX(0,${pRef(p.parcel, 'rate')})`).join('+') : '0');
          w.f(k('rate'), `IF(${R(k('sqm'))}>0,${R(k('value'))}/${R(k('sqm'))},0)`);
          w.f(k('cash'), pieces.length ? pieces.map((p) => `${R(p.pk)}*MAX(0,${pRef(p.parcel, 'rate')})*MAX(0,${pRef(p.parcel, 'cash')})`).join('+') : '0');
          w.f(k('inkind'), pieces.length ? pieces.map((p) => `${R(p.pk)}*MAX(0,${pRef(p.parcel, 'rate')})*MAX(0,${pRef(p.parcel, 'inkind')})`).join('+') : '0');
        }
      } else landRow(k, R(`chain:${a.id}:land`), a.landAllocation?.parcelId);
    }
    // A line on several plots: its row is the SUM of its plots' rows, which sit under it.
    const ls0 = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    for (const l of planReportLines(ls0, (a) => landView.some((x) => x.assetId === a.id))) {
      const lk = l.key;
      if (!w.has(`landline:${lk}:sqm`)) continue;
      const members = l.assetIds.filter((id) => w.has(`land:${id}:sqm`)).map((id) => Number(w.cell(`land:${id}:sqm`).row)).sort((x, y) => x - y);
      if (!members.length || members[members.length - 1] - members[0] !== members.length - 1) continue;
      const L = (f: string): string => `landline:${lk}:${f}`;
      for (const [f, col] of [['sqm', 2], ['value', 4], ['cash', 5], ['inkind', 6]] as const) {
        const c = String.fromCharCode(64 + col);
        w.f(L(f), `SUM($${c}$${members[0]}:$${c}$${members[members.length - 1]})`);
      }
      w.f(L('rate'), `IF(${R(L('sqm'))}>0,${R(L('value'))}/${R(L('sqm'))},0)`);
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
        const k = (x: string): string => `su:${u.id}:${x}`, kin = (x: string): string => `suin:${u.id}:${x}`;
        if (!w.has(k('area'))) continue;
        const onLA = reg.get(k('share'))?.sheet === 'Land & Area';
        // A STRIP'S DERIVED ROW (reconcileRetailSubUnits) holds the pooled retail GFA while it is
        // the strip's only row; once the user adds a second, the split is theirs.
        const derivedStripRow = !!strip && u.id === retailCompanionSubUnitId(strip.id)
          && (state.subUnits as SubUnit[]).filter((x) => x.assetId === strip.id).length === 1;
        if (derivedStripRow) {
          w.f(k('area'), nsa);
          w.f(k('share'), `IF(${nsa}>0,${R(k('area'))}/${nsa},"")`);
        } else if (u.metric === 'area') {
          if (onLA && u.sharePct.typed && w.has(kin('share'))) { w.f(k('share'), `N(${R(kin('share'))})`); w.f(k('area'), `${R(k('share'))}*${nsa}`); }
          else if (onLA && w.has(kin('area'))) { w.f(k('area'), `N(${R(kin('area'))})`); w.f(k('share'), `IF(${nsa}>0,${R(k('area'))}/${nsa},"")`); }
          else if (u.sharePct.typed) w.f(k('area'), `${R(k('share'))}*${nsa}`);
          else if (u.areaSqm.typed) w.f(k('share'), `IF(${nsa}>0,${R(k('area'))}/${nsa},"")`);
          w.f(k('units'), `IF(N(${R(k('unit'))})>0,ROUND(${R(k('area'))}/${R(k('unit'))},0),"")`);
        } else if (onLA && w.has(kin('units'))) {
          // A count row: the count is typed and the area is the count x the unit size.
          w.f(k('units'), `N(${R(kin('units'))})`);
          w.f(k('area'), `MAX(0,${R(k('units'))})*MAX(0,N(${R(k('unit'))}))`);
          w.f(k('share'), `IF(${nsa}>0,${R(k('area'))}/${nsa},"")`);
        }
        areas.push(R(k('area')));
      }
      if (w.has(`suline:${line.key}:area`) && areas.length) {
        w.f(`suline:${line.key}:area`, `SUM(${areas.join(',')})`);
        if (typeof w.cell(`suline:${line.key}:share`).value === 'number') w.f(`suline:${line.key}:share`, `IF(${nsa}>0,${R(`suline:${line.key}:area`)}/${nsa},"")`);
      }
    }

    // ── Land & Area: the NSA used per line, each asset's larger of Table 5 and its stated NSA ─
    // resolveAssetAreaMetrics: nsa = max(the Sellable, Operable and Leasable rows' area,
    // asset.sellableBuaSqm), added over the line's assets (nsaUsedFormula, the one expression).
    // A row Table 5 does not show leaves the line the platform's value.
    for (const l of nsaUsedLines(state, buildAssetAreaTables(state))) {
      const key = `nsaline:${l.key}`;
      if (!w.has(key)) continue;
      const terms = l.assetIds.map((id) => nsaUsedFormula(id, state.subUnits as SubUnit[], (x) => (w.has(x) ? R(x) : null)));
      if (terms.some((t) => !t)) continue;
      w.f(key, terms.join('+'));
    }

    const counts = w.formulas;
    return [
      { sheet: 'Timeline', status: 'live' as const, formulas: counts.get('Timeline') ?? 0, note: 'The one source of timing: the phase table reads each phase\'s start, construction and operations years and status on Inputs, and the model years, the dated schedule, the Gantt (conditional formatting), the period flags and the construction and operating year counters read that table; every other tab reads its timing here. The axis length is fixed at export.' },
      { sheet: 'Land & Area', status: 'live' as const, formulas: counts.get('Land & Area') ?? 0, note: 'The chain per plot, merged by line, the retail carve and the land by asset follow Inputs. Which plot an asset draws, the parking ratio basis and which assets host a retail strip are fixed at export. A step the chain cannot derive reads 0.' },
      { sheet: 'Inputs', status: 'partial' as const, formulas: counts.get('Inputs') ?? 0, note: 'Live on this sheet: the phase dates, the model axis year, the plot values, Table 2 figures drawn from a whole plot or inherited from a type, the NSA used (the larger of the sub-units\' area and the Stated NSA), and the sub-unit areas, shares and unit counts.' },
    ];
  },
};

/**
 * THE PERIOD INDEX AND THE PERIOD FLAGS (2026-10-14). The index row counts the
 * years from the opening column. Each flag compares the column's year with the
 * phase inputs on Inputs, one formula across the row: construction runs from
 * the start year for the construction years, the handover is the last of them
 * (never before the first model year), and a year operates once the handover is
 * behind it and fewer than the operations years have run. The horizon is the
 * engine's axis length: the latest phase end, or the dated project span.
 */
function livePeriodFlags(w: Writer, reg: CellRegistry, phaseIds: string[], yearCols: number[]): void {
  if (yearCols.length === 0) return;
  const yearRow = reg.need(`tl:year:${yearCols[0]}`).row;
  const yr = (c: number): string => `${colLetter(c)}$${yearRow}`;
  const first = `$${colLetter(yearCols[0])}$${yearRow}`;
  const indexCell = (c: number): ExcelJS.Cell => w.sheetCell('Timeline', yearRow + 1, c);
  for (const c of yearCols) w.fAt(indexCell(c), `${yr(c)}-${first}`, c - yearCols[0]);
  const active = yearCols.slice(1);
  const R = (k: string): string => w.ref(k);
  const rowOf = (k: string): number => reg.need(k).row;
  for (const id of phaseIds) {
    // The phase in years, from the phase table: the handover (the last construction year, never
    // before the first model year) and the last operating year.
    const T = (x: string): string => R(`tl:phase:${id}:${x}`);
    if (w.has(`tl:phase:${id}:hy`)) {
      w.f(`tl:phase:${id}:hy`, `MAX(${R('project:axisYear')},YEAR(${T('cs')})+${T('cp')}-1)`);
      w.f(`tl:phase:${id}:ly`, `${T('hy')}+${T('op')}`);
    }
    const con = `tl:flag:${id}:con`, hand = `tl:flag:${id}:hand`, ops = `tl:flag:${id}:ops`;
    if (!w.has(con) || !w.has(hand) || !w.has(ops)) continue;
    // The flags read the phase table: construction from the start year to the handover, the
    // handover year, then operations to the last operating year.
    for (const c of active) {
      w.fAt(w.sheetCell('Timeline', rowOf(con), c), `(${yr(c)}>=YEAR(${T('cs')}))*(${yr(c)}<=${T('hy')})*(${T('cp')}>0)`);
      w.fAt(w.sheetCell('Timeline', rowOf(hand), c), `(${yr(c)}=${T('hy')})*1`);
      w.fAt(w.sheetCell('Timeline', rowOf(ops), c), `(${yr(c)}>${T('hy')})*(${yr(c)}<=${T('ly')})`);
    }
    // The grid counters: 1, 2, 3 ... in construction years and in operating years, else 0.
    const cc = `tl:ctr:${id}:con`, oc = `tl:ctr:${id}:ops`;
    if (w.has(cc) && w.has(oc)) for (const c of active) {
      const L = colLetter(c);
      w.fAt(w.sheetCell('Timeline', rowOf(cc), c), `${L}$${rowOf(con)}*(${yr(c)}-YEAR(${T('cs')})+1)`);
      w.fAt(w.sheetCell('Timeline', rowOf(oc), c), `${L}$${rowOf(ops)}*(${yr(c)}-${T('hy')})`);
    }
  }
  if (w.has('tl:flag:exit') && w.has('inp=ret|Exit Year@4')) {
    for (const c of active) w.fAt(w.sheetCell('Timeline', rowOf('tl:flag:exit'), c), `(${yr(c)}=${R('inp=ret|Exit Year@4')})*1`);
  }
  // The model years: the last is the latest last operating year; how many is last - first + 1.
  if (w.has('tl:lastYear')) w.f('tl:lastYear', `MAX(${phaseIds.map((id) => R(`tl:phase:${id}:ly`)).join(',')})`);
  if (w.has('tl:horizon') && w.has('tl:lastYear')) w.f('tl:horizon', `${R('tl:lastYear')}-${R('project:axisYear')}+1`);
}

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
