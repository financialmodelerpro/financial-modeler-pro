/**
 * inputsSheetSections.ts (2026-09-17)
 *
 * THE INPUTS, TIMELINE AND LAND & AREA SHEETS' SECTIONS, each a copy of the
 * platform surface it names, in the platform's order, with the screen's
 * headers. Split out of buildModelWorkbook.ts so the sheet builder stays a
 * list of sections and each section's layout reads in one place.
 *
 * THE SHADING RULE, stated once: a cell a user TYPES on the platform is an
 * input (navy-pale FAST shading, `setInput`); a figure the platform DERIVES,
 * inherits from a type or fills in by default is written formula-black
 * (`derived`), so no reader edits a result expecting it to be an assumption.
 *
 * Every figure comes from the function the screen calls. The Module 1 tab 4
 * and tab 5 tables arrive as rows from `assetInputsView.ts`, which owns the
 * reading; this file only lays them out.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import {
  ARGB, NUMFMT, BODY_SIZE, fcell, setInput, markInput, setFormula, setLabel, setSectionHeader, setColHeader, fillRange, isLiveLayout, setNote,
} from './styles';
import type { computeFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import { computePhaseTimeline, resolveAssetAreaMetrics, resolveSubUnitAdr, resolveUsefulLifeYears } from '@/src/core/calculations';
import { countryLabel } from '@/src/core/countries';
import { defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { PHASE_STATUS_LABELS, DEFAULT_COVENANTS, type Asset, type Phase, type SubUnit } from '../state/module1-types';
import {
  buildStandardsView, buildAssetAreaTables, buildSubUnitLines, type ViewCell, type AssetAreaTables,
} from '../../components/modules/_shared/assetInputsView';
import { registerCell } from './cellRegistry';
import { DEAD_SWITCHES, deadSwitchKey, INERT_INPUTS, inertKey } from './liveLayers/inputAudit';
import { normaliseAssetTypeId, resolveRetailSlotTypeId } from '../state/assetTypeStandards';
import { phaseHasModelCapex } from '@/src/core/calculations/modelCapex';
import { hqOpexLinesInForce, normalizeOpexIndexation } from '@/src/core/calculations/opex';
import { planRevenueLines, groupRevenueLines, lineForAsset, type RevenueLine } from '../revenueLines';
import { revenueLineName } from '../reports/revenueOutputReports';
import { planReportLines, lineTitle } from '../reports/lineRows';
import { resolveRowVelocity, resolveLinePace, occupancyAxis } from '../revenue-resolvers';
import { buildSaleCohortTermsBlock, saleCohortRuleText } from '../reports/saleCohortReports';
import { OPEX_CATEGORY_LABELS, OPEX_MODE_LABELS, isFixedCostOpexMode, summarizeOpexIndexation } from '../reports/opexInputLabels';
import { resolveReturnsConfig, computeReturnsSnapshot } from '../returns-resolvers';
import { defaultSensitivityValues } from '@/src/core/calculations/returns';
import { statedLineReceivableDays } from '../receivableDays';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;

/** A row cursor over one sheet. Every section advances `r` past what it wrote. */
export interface SheetCursor {
  wb: ExcelJS.Workbook;
  ws: ExcelJS.Worksheet;
  sheetName: string;
  r: number;
}

// ── cell primitives ─────────────────────────────────────────────────────────

/** A figure the platform derives, inherits or defaults: formula-black, never shaded. */
export function derived(cell: ExcelJS.Cell, value: number | string | undefined, fmt: string = NUMFMT.int, bold = false): void {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
  setFormula(cell, fcell(String(value), value), fmt);
  if (bold) cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.formula } };
  if (typeof value === 'string') cell.alignment = { horizontal: 'right' };
}

/** A typed value as an input, anything else as derived, blank when absent. */
function viewCell(cell: ExcelJS.Cell, v: ViewCell, fmt: string, scale = 1): void {
  if (v.value === undefined) return;
  if (v.typed) setInput(cell, v.value / scale, fmt);
  else derived(cell, v.value / scale, fmt);
}

function headers(c: SheetCursor, heads: string[], startCol = 1): void {
  heads.forEach((h, i) => setColHeader(c.ws.getCell(c.r, startCol + i), h, i === 0 && startCol === 1 ? 'left' : 'right'));
  c.r += 1;
}

function note(c: SheetCursor, text: string): void {
  const cell = c.ws.getCell(c.r, 1);
  cell.value = text;
  cell.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
  c.r += 1;
}

function band(c: SheetCursor, text: string, span: number): void {
  setLabel(c.ws.getCell(c.r, 1), text, { bold: true });
  fillRange(c.ws, c.r, 1, c.r, span, ARGB.subtotal);
  c.r += 1;
}

function kv(c: SheetCursor, label: string, value: number | string | undefined, fmt: string, input: boolean, name?: string, noteText?: string, regKey?: string): number {
  setLabel(c.ws.getCell(c.r, 1), label);
  if (regKey) registerCell(regKey, c.ws, c.ws.getCell(c.r, 2));
  if (value !== undefined) {
    if (input) setInput(c.ws.getCell(c.r, 2), value, fmt);
    else derived(c.ws.getCell(c.r, 2), value, fmt);
  }
  if (noteText) {
    const n = c.ws.getCell(c.r, 3);
    n.value = noteText;
    n.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
  }
  if (name) c.wb.definedNames.add(`${c.sheetName}!$B$${c.r}`, name);
  const row = c.r; c.r += 1; return row;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A calendar date the way the platform stores it, read in UTC so no time
 *  zone moves it across a month or a year. */
export function utcMonthYear(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function utcDate(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function utcYear(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d.getUTCFullYear();
}
export function phaseStatusLabel(status: string | undefined): string {
  return PHASE_STATUS_LABELS[(status ?? 'planning') as keyof typeof PHASE_STATUS_LABELS] ?? String(status);
}

// ── MODULE 1 TAB 1: PROJECT AND PHASES ──────────────────────────────────────

export function emitProjectSection(c: SheetCursor, state: FinancialsResolverState): void {
  const p = state.project;
  setSectionHeader(c.ws.getRow(c.r), 'Project', 5); c.r += 1;
  kv(c, 'Project Name', p.name || '(unnamed)', '@', true);
  kv(c, 'Currency', p.currency ?? 'SAR', '@', true);
  kv(c, 'Project Start Date', utcDate(p.startDate), '@', true, undefined, undefined, 'project:startDate');
  kv(c, 'Project Status', String(p.status ?? 'draft'), '@', true);
  // DISPLAY ONLY on the platform, and the country is its own row below, so the
  // location is printed as typed with no code appended to it.
  kv(c, 'Location', p.location || '-', '@', true);
  kv(c, 'Country', p.country ? countryLabel(p.country) : 'Not set', '@', true);
  c.r += 1;
}

export function emitPhasesSection(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  // THE LIVE LAYOUT HOLDS TYPED VALUES ONLY (2026-10-20): the phase end dates and the axis
  // year are worked out on the Timeline, which reads these cells.
  const live = isLiveLayout();
  setSectionHeader(c.ws.getRow(c.r), 'Phases', live ? 5 : 8); c.r += 1;
  headers(c, live ? ['Phase Name', 'Phase Start Date', 'Construction (years)', 'Operations (years)', 'Status']
    : ['Phase Name', 'Phase Start Date', 'Construction (years)', 'Operations (years)', 'Construction End', 'Operations Start', 'Operations End', 'Status']);
  for (const ph of state.phases) {
    if (live) {
      setLabel(c.ws.getCell(c.r, 1), ph.name);
      setInput(c.ws.getCell(c.r, 2), utcDate(ph.startDate && ph.startDate.length === 10 ? ph.startDate : state.project.startDate), '@');
      setInput(c.ws.getCell(c.r, 3), ph.constructionPeriods ?? 0, NUMFMT.int);
      setInput(c.ws.getCell(c.r, 4), ph.operationsPeriods ?? 0, NUMFMT.int);
      (['start', 'cp', 'op'] as const).forEach((k, i) => registerCell(`phase:${ph.id}:${k}`, c.ws, c.ws.getCell(c.r, 2 + i)));
      setInput(c.ws.getCell(c.r, 5), phaseStatusLabel(ph.status), '@');
      registerCell(`phase:${ph.id}:status`, c.ws, c.ws.getCell(c.r, 5));
      // No "start year at export" (2026-10-25): the input grids are keyed by construction or operating year (2026-10-26), so they move with the phase.
      c.r += 1;
      continue;
    }
    const tl = computePhaseTimeline(ph, state.project);
    setLabel(c.ws.getCell(c.r, 1), ph.name);
    setInput(c.ws.getCell(c.r, 2), utcDate(ph.startDate && ph.startDate.length === 10 ? ph.startDate : state.project.startDate), '@');
    setInput(c.ws.getCell(c.r, 3), ph.constructionPeriods ?? 0, NUMFMT.int);
    setInput(c.ws.getCell(c.r, 4), ph.operationsPeriods ?? 0, NUMFMT.int);
    (['start', 'cp', 'op', 'cEnd', 'oStart', 'oEnd'] as const).forEach((k, i) => registerCell(`phase:${ph.id}:${k}`, c.ws, c.ws.getCell(c.r, 2 + i)));
    derived(c.ws.getCell(c.r, 5), ph.constructionPeriods === 0 ? 'Operational from start' : utcMonthYear(tl.constructionEnd), '@');
    derived(c.ws.getCell(c.r, 6), utcMonthYear(tl.operationsStart), '@');
    derived(c.ws.getCell(c.r, 7), utcMonthYear(tl.operationsEnd), '@');
    setInput(c.ws.getCell(c.r, 8), phaseStatusLabel(ph.status), '@');
    c.r += 1;
  }
  if (live) { c.r += 1; return; }
  // The model axis starts at the earliest phase: derived, and the name the
  // period sheets key their year headings to.
  setLabel(c.ws.getCell(c.r, 1), 'Model axis start year (derived)', { bold: true });
  derived(c.ws.getCell(c.r, 2), snap.projectStartYear, NUMFMT.year);
  registerCell('project:axisYear', c.ws, c.ws.getCell(c.r, 2));
  c.wb.definedNames.add(`${c.sheetName}!$B$${c.r}`, 'ProjectStartYear');
  c.r += 2;
}

// ── MODULE 1 TAB 4: ASSET TYPES AND STANDARDS ───────────────────────────────

export function emitStandardsSection(c: SheetCursor, state: FinancialsResolverState): void {
  const v = buildStandardsView(state);
  const currency = state.project.currency ?? '';
  // THE LIVE WORKBOOK SHOWS ONLY TYPES THE MODEL USES (2026-10-25, founder): a type no visible
  // asset is of (and not the type the retail parking ratio is read from) is read by nothing.
  const live = isLiveLayout();
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const usedTypes = new Set<string>(visibleAssets.map((a) => normaliseAssetTypeId(a.assetTypeId ?? '')).filter(Boolean));
  { const slot = resolveRetailSlotTypeId(state.project, visibleAssets); if (slot) usedTypes.add(slot); }
  const typeShown = (id: string | undefined): boolean => !live || id === undefined || usedTypes.has(normaliseAssetTypeId(id));
  const types = v.types.filter((t) => typeShown(t.id));
  setSectionHeader(c.ws.getRow(c.r), 'Asset types and values', 10); c.r += 1;
  if (types.length === 0) { note(c, 'No asset types in this project.'); c.r += 1; }
  else {
    headers(c, ['Asset type', 'Category', 'Strategy for new assets', 'Avg unit size (sqm)', 'Parking ratio', 'Ratio basis', 'Utilisation %', 'Coverage %', 'FAR', 'Service %']);
    for (const t of types) {
      setLabel(c.ws.getCell(c.r, 1), t.label);
      (['unit', 'ratio', 'basis', 'util', 'cov', 'far', 'svc'] as const).forEach((k, i) => registerCell(`type:${t.id}:${k}`, c.ws, c.ws.getCell(c.r, 4 + i)));
      setInput(c.ws.getCell(c.r, 2), t.category || '-', '@');
      if (t.strategy) setInput(c.ws.getCell(c.r, 3), t.strategy, '@');
      if (t.unitSizeSqm !== undefined) setInput(c.ws.getCell(c.r, 4), t.unitSizeSqm, NUMFMT.rate);
      if (t.ratio !== undefined) setInput(c.ws.getCell(c.r, 5), t.ratio, NUMFMT.rate);
      if (t.ratioBasis !== undefined) setInput(c.ws.getCell(c.r, 6), t.ratioBasis, '@');
      else derived(c.ws.getCell(c.r, 6), t.ratioBasisDefault, '@');
      if (t.utilisationPct !== undefined) setInput(c.ws.getCell(c.r, 7), t.utilisationPct / 100, NUMFMT.pct2);
      if (t.coveragePct !== undefined) setInput(c.ws.getCell(c.r, 8), t.coveragePct / 100, NUMFMT.pct2);
      if (t.far !== undefined) setInput(c.ws.getCell(c.r, 9), t.far, NUMFMT.rate);
      if (t.servicePct !== undefined) setInput(c.ws.getCell(c.r, 10), t.servicePct / 100, NUMFMT.pct2);
      for (const col of [4, 5, 7, 8, 9, 10]) fixedHere(c, c.r, col, 'A type default applies only where a plot or sub-unit of this type states none, and in this model none relies on it.');
      c.r += 1;
    }
    note(c, live ? 'A blank value is not set, never zero. A type default shows only where a plot or sub-unit of the type states none and inherits it.' : 'A blank value is not set, never zero. Utilisation, coverage, FAR and service are defaults a plot inherits where it states none on Table 2.');
    c.r += 1;
  }
  setSectionHeader(c.ws.getRow(c.r), 'Parking and cost escalation', 3); c.r += 1;
  kv(c, 'Parking area per slot (sqm) for this project', v.slotAreaSqm, NUMFMT.rate, true, undefined, undefined, 'project:slotArea');
  // Free cells on the same row, for the live workbook to state the retail
  // parking ratio the chain reads (it can come from a type no longer listed).
  registerCell('project:retailSlotLabel', c.ws, c.ws.getCell(c.r - 1, 3));
  registerCell('project:retailSlotArea', c.ws, c.ws.getCell(c.r - 1, 4));
  // BLANK WHEN ABSENT, NEVER 0: an absent rate is "not set" on the platform.
  // The live workbook types it here either way (0% where the platform states none); the Capex cell echoes it.
  const escLive = isLiveLayout();
  kv(c, isLiveLayout() ? 'Construction cost escalation (% a year, from the first model year)' : `Construction cost escalation (% a year, from ${v.baseYear})`, v.escalationPct === undefined ? (escLive ? 0 : undefined) : v.escalationPct / 100, NUMFMT.pct2, true,
    undefined, v.escalationPct === undefined ? (escLive ? 'Not set on the platform, so 0%: rates are not escalated.' : 'Not set: rates are not escalated.') : undefined,
    // The live workbook's Capex reads this cell itself (2026-10-27: no echo on Capex).
    escLive ? 'cx:esc' : v.escalationPct === undefined ? undefined : 'inp=cx:esc@3');
  c.r += 1;

  // THE LIVE WORKBOOK SHOWS NO TYPE PRICES (2026-10-25): every price it reads is the sub-unit's own
  // Table 5 rate, so a type's sale price, ADR or rent here would be a second, unread copy.
  const prices = !live;
  const standardsTable = (title: string, rows0: typeof v.construction, construction: boolean): void => {
    const rows = rows0.filter((row) => typeShown(row.assetTypeId));
    setSectionHeader(c.ws.getRow(c.r), title, construction ? (prices ? 9 : 5) : 5); c.r += 1;
    const multiPhase = state.phases.length > 1;
    headers(c, construction
      ? ['Item', 'Applies to', 'Basis', isLiveLayout() ? 'Rate (first model year money)' : `Rate (${v.baseYear} money)`, 'By phase', ...(prices ? ['Price per unit', 'Price per unit reads as', 'Price per sqm', 'Price per sqm reads as'] : [])]
      : ['Item', 'Basis', isLiveLayout() ? 'Rate (first model year money)' : `Rate (${v.baseYear} money)`, 'By phase']);
    for (const row of rows) {
      setLabel(c.ws.getCell(c.r, 1), row.label);
      let col = 2;
      if (construction) { setLabel(c.ws.getCell(c.r, col), row.appliesTo); col += 1; }
      setLabel(c.ws.getCell(c.r, col), row.basis); col += 1;
      if (row.rate !== undefined) { setInput(c.ws.getCell(c.r, col), row.isPercent ? row.rate / 100 : row.rate, row.isPercent ? NUMFMT.pct2 : NUMFMT.rate); fixedHere(c, c.r, col, 'No cost line in this model charges at this standard.'); }
      registerCell(`std:${row.id}:rate`, c.ws, c.ws.getCell(c.r, col));
      col += 1;
      if (multiPhase && row.byPhase.length > 0) {
        setInput(c.ws.getCell(c.r, col), row.byPhase.map((b) => `${b.phaseName} ${row.isPercent ? `${b.rate}%` : b.rate.toLocaleString('en-US')}`).join('; '), '@');
      }
      col += 1;
      if (construction && prices) {
        for (const pr of [row.pricePerUnit, row.pricePerSqm]) {
          if (pr === null) { derived(c.ws.getCell(c.r, col), '-', '@'); col += 2; continue; }
          if (pr === undefined) { col += 2; continue; }
          if (pr.value !== undefined) { setInput(c.ws.getCell(c.r, col), pr.value, NUMFMT.rate); fixedHere(c, c.r, col, 'A type price applies only to a sub-unit with no price of its own, and in this model every sub-unit of this type states one.'); }
          setLabel(c.ws.getCell(c.r, col + 1), `${pr.unit}${currency ? ` (${currency})` : ''}`);
          col += 2;
        }
      }
      c.r += 1;
    }
    c.r += 1;
  };
  standardsTable(prices ? 'Cost standards: construction cost, sale price and ADR' : 'Cost standards: construction cost', v.construction, true);
  standardsTable('Cost standards: soft costs', v.soft, false);
  note(c, live ? 'Defaults only: a rate typed on a Capex phase line wins, and a phase rate here wins over the row rate in that phase.' : 'Defaults only: a rate typed on a Capex phase line wins, a phase rate here wins over the row rate in that phase, and a type price applies to every Table 5 row of that type with no price of its own.');
  c.r += 1;
}

// ── MODULE 1 TAB 5, TABLE 1: PLOTS ──────────────────────────────────────────

export function emitPlotsSection(c: SheetCursor, state: FinancialsResolverState): void {
  if (state.parcels.length === 0) return;
  const cur = state.project.currency ?? 'SAR';
  // THE LIVE LAYOUT HOLDS TYPED VALUES ONLY (2026-10-20): the plot values are worked out on Land & Area.
  const live = isLiveLayout();
  setSectionHeader(c.ws.getRow(c.r), 'Plots, the land', live ? 6 : 9); c.r += 1;
  headers(c, live ? ['Plot', 'Phase', 'Area (sqm)', `${cur}/sqm`, 'Cash %', 'In-Kind %'] : ['Plot', 'Phase', 'Area (sqm)', `${cur}/sqm`, 'Cash %', 'In-Kind %', 'Land Value', 'Cash Value', 'In-Kind Value']);
  let area = 0, value = 0, cash = 0, inKind = 0;
  for (const pa of state.parcels) {
    const a = Math.max(0, pa.area ?? 0), rate = Math.max(0, pa.rate ?? 0);
    const lv = a * rate, cv = lv * (Math.max(0, pa.cashPct ?? 0) / 100), iv = lv * (Math.max(0, pa.inKindPct ?? 0) / 100);
    setLabel(c.ws.getCell(c.r, 1), pa.name);
    setInput(c.ws.getCell(c.r, 2), state.phases.find((ph) => ph.id === pa.phaseId)?.name ?? '-', '@');
    setInput(c.ws.getCell(c.r, 3), pa.area ?? 0, NUMFMT.int);
    setInput(c.ws.getCell(c.r, 4), pa.rate ?? 0, NUMFMT.rate);
    setInput(c.ws.getCell(c.r, 5), (pa.cashPct ?? 0) / 100, NUMFMT.pct);
    setInput(c.ws.getCell(c.r, 6), (pa.inKindPct ?? 0) / 100, NUMFMT.pct);
    if (!live) {
      derived(c.ws.getCell(c.r, 7), lv, NUMFMT.money);
      derived(c.ws.getCell(c.r, 8), cv, NUMFMT.money);
      derived(c.ws.getCell(c.r, 9), iv, NUMFMT.money);
    }
    (['area', 'rate', 'cash', 'inkind', 'value', 'cashValue', 'inkindValue'] as const).forEach((k, i) => { if (!live || i < 4) registerCell(`parcel:${pa.id}:${k}`, c.ws, c.ws.getCell(c.r, 3 + i)); });
    area += a; value += lv; cash += cv; inKind += iv;
    c.r += 1;
  }
  if (live) { c.r += 1; return; }
  setLabel(c.ws.getCell(c.r, 1), 'Totals', { bold: true });
  derived(c.ws.getCell(c.r, 3), area, NUMFMT.int, true);
  derived(c.ws.getCell(c.r, 4), area > 0 ? value / area : 0, NUMFMT.rate, true);
  derived(c.ws.getCell(c.r, 7), value, NUMFMT.money, true);
  derived(c.ws.getCell(c.r, 8), cash, NUMFMT.money, true);
  derived(c.ws.getCell(c.r, 9), inKind, NUMFMT.money, true);
  (['area', 'rate', 'x', 'y', 'value', 'cashValue', 'inkindValue'] as const).forEach((k, i) => { if (k !== 'x' && k !== 'y') registerCell(`parcels:total:${k}`, c.ws, c.ws.getCell(c.r, 3 + i)); });
  fillRange(c.ws, c.r, 1, c.r, 9, ARGB.subtotal);
  c.r += 1;
  note(c, 'Land is allocated by sqm only: each asset draws from its plot on Table 2. The debt / equity split of land cash is on Financing (Land Funding).');
  c.r += 1;
}

// ── MODULE 1 TAB 5, TABLE 2: ASSETS BY PLOT, WHAT YOU ENTER ─────────────────

export function emitAssetEntrySection(c: SheetCursor, tables: AssetAreaTables, state: FinancialsResolverState): void {
  // THE NSA RULE ON THE ROW (2026-09-28, founder): an asset's net saleable area is the
  // LARGER of its sub-units' area (Table 5) and the NSA stated on the asset
  // (resolveAssetAreaMetrics). The stated figure is an input like any other, and the
  // figure the model uses sits beside it, so the rule is read where it is applied.
  const visible = state.assets.filter((a) => a.visible !== false);
  const nsaOf = (id: string): { stated: number; used: number } | undefined => {
    const a = visible.find((x) => x.id === id);
    if (!a) return undefined;
    return { stated: Math.max(0, a.sellableBuaSqm ?? 0), used: resolveAssetAreaMetrics(a, state.project, state.parcels, visible, state.subUnits, state.landAllocationMode).nsa };
  };
  // MAX FLOORS IS NOT IN THE LIVE WORKBOOK (2026-10-25): a planning note nothing reads, on the platform either.
  const floors = !isLiveLayout(), sh = floors ? 0 : 1;
  setSectionHeader(c.ws.getRow(c.r), 'Assets by plot, what you enter', 11 - sh); c.r += 1;
  headers(c, ['Type', 'Strategy', 'Plot Area (sqm)', 'Land Utilisation %', 'Ground Coverage %', 'FAR', ...(floors ? ['Max Floors'] : []), 'Retail % (ground floor)', 'Service %', 'Stated NSA (sqm)', isLiveLayout() ? 'NSA used: Land & Area' : 'NSA used (sqm)']);
  let inherited = false, whole = false;
  for (const g of tables.plots) {
    band(c, `${g.plotLabel}${g.phaseName ? `, ${g.phaseName}` : ''}. ${g.check}`, 11 - sh);
    if (g.entries.length === 0) { note(c, 'No assets drawing from this plot yet.'); continue; }
    for (const e of g.entries) {
      setLabel(c.ws.getCell(c.r, 1), e.typeLabel, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), e.strategy, '@');
      viewCell(c.ws.getCell(c.r, 3), e.plotAreaSqm, NUMFMT.int);
      viewCell(c.ws.getCell(c.r, 4), e.utilisationPct, NUMFMT.pct2, 100);
      viewCell(c.ws.getCell(c.r, 5), e.coveragePct, NUMFMT.pct2, 100);
      viewCell(c.ws.getCell(c.r, 6), e.far, NUMFMT.rate);
      if (floors) {
        viewCell(c.ws.getCell(c.r, 7), e.maxFloors, NUMFMT.int);
        fixedHere(c, c.r, 7, 'Max floors is a planning note: nothing in the model reads it, on the platform either.');
      }
      viewCell(c.ws.getCell(c.r, 8 - sh), e.retailPct, NUMFMT.pct2, 100);
      viewCell(c.ws.getCell(c.r, 9 - sh), e.servicePct, NUMFMT.pct2, 100);
      (['plot', 'util', 'cov', 'far', 'floors', 'retail', 'svc'] as const).forEach((k, i) => {
        if (k === 'floors' && !floors) return;
        registerCell(`entry:${e.assetId}:${k}`, c.ws, c.ws.getCell(c.r, 3 + i - (i > 4 ? sh : 0)));
      });
      const nsa = nsaOf(e.assetId);
      if (nsa) {
        // A blank states none (the platform stores 0 and the rule reads it as nothing).
        const sc = c.ws.getCell(c.r, 10 - sh);
        if (nsa.stated > 0) setInput(sc, nsa.stated, NUMFMT.int); else { markInput(sc); sc.numFmt = NUMFMT.int; }
        registerCell(`entry:${e.assetId}:nsa`, c.ws, sc);
        // The live workbook works it out on Land & Area (it reads the sub-units' areas there).
        if (!isLiveLayout()) {
          derived(c.ws.getCell(c.r, 11 - sh), nsa.used, NUMFMT.int);
          registerCell(`entry:${e.assetId}:nsaUsed`, c.ws, c.ws.getCell(c.r, 11 - sh));
        }
      }
      if ([e.utilisationPct, e.coveragePct, e.far, e.servicePct].some((x) => x.note === 'from the type')) inherited = true;
      if (e.plotAreaSqm.note) whole = true;
      c.r += 1;
    }
  }
  if (inherited) note(c, 'Unshaded coverage, FAR, utilisation or service figures are inherited from the asset type (Asset types and values above); the plot states none.');
  if (whole) note(c, 'An unshaded Plot Area is a blank on the platform: the asset draws its whole plot.');
  note(c, 'NSA used is the LARGER of the sub-units\' area on Table 5 and the Stated NSA typed here (a blank states none). It is the net saleable area every cost per sqm, the Summary and the land and area tables read.');
  if (tables.companions.length > 0) {
    note(c, `Ground-floor retail strips (${tables.companions.map((x) => x.name).join('; ')}) are derived from the retail share above, not typed: their areas and carved land are on Land & Area.`);
  }
  c.r += 1;
}

// ── MODULE 1 TAB 5, TABLE 5: SUB-UNITS UNDER THE MERGED LINE ────────────────

export function emitSubUnitSection(c: SheetCursor, state: FinancialsResolverState): void {
  const lines = buildSubUnitLines(state);
  if (lines.length === 0) return;
  const cur = state.project.currency ?? 'SAR';
  const live = isLiveLayout();
  // THE OTHER BASIS IS NOT IN THE LIVE WORKBOOK (2026-10-25): a row sells, lets or operates on its
  // own basis, and the price it would carry on the other one is read by nothing.
  setSectionHeader(c.ws.getRow(c.r), 'Sub-units, under the merged line', live ? 8 : 10); c.r += 1;
  headers(c, ['Sub-unit', 'Category', 'NSA Share %', 'Area (sqm)', 'Average Unit Size (sqm)', 'Units or Keys', `Rate (${cur})`, 'Rate Basis', ...(live ? [] : ['Rate, other basis', 'Other basis'])]);
  for (const line of lines) {
    band(c, live ? line.title : `${line.title}. ${line.check}`, live ? 8 : 10);
    for (const u of line.rows) {
      // Live layout: a share is of the whole line's NSA, so the row is named without a plot.
      setLabel(c.ws.getCell(c.r, 1), u.plot && (!live || u.plot === 'no asset' || line.rows.filter((x) => x.name === u.name).length > 1) ? `${u.name} (${u.plot})` : u.name, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), u.category, '@');
      if (live) {
        // THE LIVE WORKBOOK: only the stated half of each pair is here; the rest follows the line's
        // NSA on Land & Area (Sub-unit areas), which comes after this tab.
        if (u.sharePct.typed) { viewCell(c.ws.getCell(c.r, 3), u.sharePct, NUMFMT.pct2, 100); registerCell(`suin:${u.id}:share`, c.ws, c.ws.getCell(c.r, 3)); }
        const stripDerived = line.key.startsWith('retail__') && line.rows.length === 1;
        if (u.areaSqm.typed && !stripDerived) { viewCell(c.ws.getCell(c.r, 4), u.areaSqm, NUMFMT.int); registerCell(`suin:${u.id}:area`, c.ws, c.ws.getCell(c.r, 4)); }
        if (u.units.typed) { viewCell(c.ws.getCell(c.r, 6), u.units, NUMFMT.int); registerCell(`suin:${u.id}:units`, c.ws, c.ws.getCell(c.r, 6)); }
      } else {
        viewCell(c.ws.getCell(c.r, 3), u.sharePct, NUMFMT.pct2, 100);
        viewCell(c.ws.getCell(c.r, 4), u.areaSqm, NUMFMT.int);
        viewCell(c.ws.getCell(c.r, 6), u.units, NUMFMT.int);
      }
      if (u.unitSizeSqm !== undefined) setInput(c.ws.getCell(c.r, 5), u.unitSizeSqm, NUMFMT.rate);
      (live ? (['unit', 'rate'] as const) : (['share', 'area', 'unit', 'units', 'rate'] as const)).forEach((k) => registerCell(`su:${u.id}:${k}`, c.ws, c.ws.getCell(c.r, 3 + ['share', 'area', 'unit', 'units', 'rate'].indexOf(k))));
      setInput(c.ws.getCell(c.r, 7), u.rate, NUMFMT.rate);
      setLabel(c.ws.getCell(c.r, 8), u.rateBasis);
      if (live) { /* no other basis */ } else if (u.otherRate) {
        if (u.otherRate.value !== undefined) { setInput(c.ws.getCell(c.r, 9), u.otherRate.value, NUMFMT.rate); fixedHere(c, c.r, 9, 'The row sells on the other basis; this price is kept for a switch, not used.'); }
        setLabel(c.ws.getCell(c.r, 10), u.otherRate.basis);
      } else if (u.otherNote) setLabel(c.ws.getCell(c.r, 10), u.otherNote);
      c.r += 1;
    }
    if (!live) {
      setLabel(c.ws.getCell(c.r, 1), line.title === 'Not on a line' ? 'Total, not on a line' : 'Line total', { bold: true, indent: 1 });
      if (line.nsaSqm > 0) derived(c.ws.getCell(c.r, 3), line.areaSqm / line.nsaSqm, NUMFMT.pct2, true);
      derived(c.ws.getCell(c.r, 4), line.areaSqm, NUMFMT.int, true);
      registerCell(`suline:${line.key}:share`, c.ws, c.ws.getCell(c.r, 3));
      registerCell(`suline:${line.key}:area`, c.ws, c.ws.getCell(c.r, 4));
      c.r += 1;
    }
  }
  note(c, live
    ? 'Share and area are one pair: whichever is shaded is the statement. The other, the units and each line\'s total follow the line\'s NSA on Land & Area (Sub-unit areas). In count mode the count is typed and the area follows.'
    : 'Share and area are one pair: whichever is shaded is the statement and the other follows the line\'s NSA. In count mode the count is typed and the area follows.');
  c.r += 1;
}

// ── LAND & AREA: SUB-UNIT AREAS AND THE NSA USED (live workbook) ──────────────

/** The lines the NSA used table shows (live layout), each with the assets it adds: the Inputs Table 2 rows. */
export function nsaUsedLines(state: FinancialsResolverState, tables: AssetAreaTables): Array<{ key: string; title: string; assetIds: string[] }> {
  const entryIds = new Set(tables.plots.flatMap((g) => g.entries.map((e) => e.assetId)));
  const ls = { assets: state.assets, phases: state.phases, parcels: state.parcels };
  return planReportLines(ls, (a) => entryIds.has(a.id))
    .map((l) => ({ key: l.key, title: lineTitle(l, ls), assetIds: l.assetIds.filter((id) => entryIds.has(id)) }))
    .filter((l) => l.assetIds.length > 0);
}

/** Each sub-unit's share of its line's NSA, its area and units, and each line's NSA used. */
export function emitSubUnitAreas(c: SheetCursor, state: FinancialsResolverState, tables: AssetAreaTables): void {
  const lines = buildSubUnitLines(state);
  if (lines.length) {
    setSectionHeader(c.ws.getRow(c.r), 'Sub-unit areas', 4); c.r += 1;
    headers(c, ['Sub-unit', 'NSA Share %', 'Area (sqm)', 'Units or Keys']);
    for (const line of lines) {
      band(c, line.title, 4);
      // A share is of the whole LINE's NSA, so a row covers the line and is named without a plot
      // (2026-10-26). One on no asset still says so, and two rows of one name keep their plots apart.
      for (const u of line.rows) {
        setLabel(c.ws.getCell(c.r, 1), u.plot && (u.plot === 'no asset' || line.rows.filter((x) => x.name === u.name).length > 1) ? `${u.name} (${u.plot})` : u.name, { indent: 1 });
        if (u.sharePct.value !== undefined) derived(c.ws.getCell(c.r, 2), u.sharePct.value / 100, NUMFMT.pct2);
        derived(c.ws.getCell(c.r, 3), u.areaSqm.value ?? 0, NUMFMT.int);
        if (u.units.value !== undefined) derived(c.ws.getCell(c.r, 4), u.units.value, NUMFMT.int);
        (['share', 'area', 'units'] as const).forEach((k, i) => registerCell(`su:${u.id}:${k}`, c.ws, c.ws.getCell(c.r, 2 + i)));
        c.r += 1;
      }
    }
    c.r += 1;
  }
  // ONE ROW PER LINE (2026-10-26): a line's sub-units sit on one of its plots' assets but cover the
  // whole line, so a per-plot split showed one plot holding the line and the other none. The row adds
  // its assets' NSA used, each the larger of its sub-units' area and its Stated NSA (resolveAssetAreaMetrics).
  const visible = state.assets.filter((a) => a.visible !== false);
  const nsaLines = nsaUsedLines(state, tables);
  if (nsaLines.length) {
    setSectionHeader(c.ws.getRow(c.r), 'NSA used by line', 2); c.r += 1;
    headers(c, ['Line', 'NSA used (sqm)']);
    for (const l of nsaLines) {
      const nsa = l.assetIds.reduce((s, id) => {
        const a = visible.find((x) => x.id === id);
        return s + (a ? resolveAssetAreaMetrics(a, state.project, state.parcels, visible, state.subUnits, state.landAllocationMode).nsa : 0);
      }, 0);
      setLabel(c.ws.getCell(c.r, 1), l.title, { indent: 1 });
      derived(c.ws.getCell(c.r, 2), nsa, NUMFMT.int);
      registerCell(`nsaline:${l.key}`, c.ws, c.ws.getCell(c.r, 2));
      c.r += 1;
    }
    c.r += 1;
  }
}

// ── DEPRECIATION INPUTS (Module 4, Fixed Assets) ────────────────────────────

/** The category whose default life an asset inherits (the strategy switch of `resolveUsefulLifeYears`). */
export function usefulLifeCategory(a: Pick<Asset, 'strategy'>): string {
  return a.strategy === 'Operate' ? 'hospitality' : a.strategy === 'Lease' ? 'retail'
    : a.strategy === 'Sell' || a.strategy === 'Sell + Manage' ? 'residential' : 'default';
}
const USEFUL_LIFE_CATEGORY_LABELS: Record<string, string> = { hospitality: 'Hospitality', retail: 'Retail / Lease', residential: 'Residential', default: 'Other' };

export function emitDepreciationSection(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  const assets = state.assets;
  const lines = planReportLines({ assets, phases: state.phases, parcels: state.parcels }, (a) => snap.fixedAssets.byAsset.has(a.id));
  if (lines.length === 0) return;
  setSectionHeader(c.ws.getRow(c.r), 'Depreciation Inputs (all assets)', 7); c.r += 1;
  const live = isLiveLayout();
  if (live) {
    // THE CATEGORY DEFAULTS, TYPED ONCE (2026-10-20): an asset that states no life takes its
    // category's (`resolveUsefulLifeYears`); Schedules works out the life in force.
    headers(c, ['Default useful life', 'Years']);
    const cats = new Map<string, number>();
    for (const line of lines) {
      const h = assets.find((a) => a.id === line.assetIds[0]);
      if (h) cats.set(usefulLifeCategory(h), resolveUsefulLifeYears({ ...h, usefulLifeYears: undefined } as Asset));
    }
    for (const [cat, yrs] of cats) {
      setLabel(c.ws.getCell(c.r, 1), USEFUL_LIFE_CATEGORY_LABELS[cat] ?? cat, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), yrs, NUMFMT.int);
      registerCell(`fadefault:${cat}`, c.ws, c.ws.getCell(c.r, 2));
      c.r += 1;
    }
    c.r += 1;
  }
  headers(c, live ? ['Asset', 'Strategy', 'Method', 'Useful life (blank = default)', 'Rate', 'Opening Land', 'Opening Bldg NBV']
    : ['Asset', 'Strategy', 'Method', 'Useful Life (yrs)', 'Rate', 'Opening Land', 'Opening Bldg NBV']);
  for (const line of lines) {
    const host = assets.find((a) => a.id === line.assetIds[0]);
    if (!host) continue;
    const rows = line.assetIds.map((id) => snap.fixedAssets.byAsset.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const lifeEffective = (rows[0]?.usefulLifeYears ?? 0) > 0 ? rows[0].usefulLifeYears : resolveUsefulLifeYears(host);
    const lifeStored = host.usefulLifeYears;
    const isRB = host.depreciationMethod === 'reducing_balance';
    setLabel(c.ws.getCell(c.r, 1), lineTitle(line, { assets, phases: state.phases, parcels: state.parcels }));
    setLabel(c.ws.getCell(c.r, 2), host.strategy === 'Operate' ? (host.isCompanion ? 'Hospitality (Manage)' : 'Hospitality') : host.strategy === 'Lease' ? 'Retail / Lease' : String(host.strategy));
    setInput(c.ws.getCell(c.r, 3), isRB ? 'Reducing Balance (WDV)' : 'Straight Line (SL)', '@');
    if (live) {
      // A life the asset states, typed; blank takes the category default above.
      if (lifeStored !== undefined && lifeStored > 0) setInput(c.ws.getCell(c.r, 4), lifeStored, NUMFMT.int);
      else { markInput(c.ws.getCell(c.r, 4)); c.ws.getCell(c.r, 4).numFmt = NUMFMT.int; }
      registerCell(`falife:${host.id}`, c.ws, c.ws.getCell(c.r, 4));
    } else if (lifeStored !== undefined && lifeStored > 0) setInput(c.ws.getCell(c.r, 4), lifeStored, NUMFMT.int);
    else derived(c.ws.getCell(c.r, 4), lifeEffective, NUMFMT.int);
    if (isRB) {
      if (host.depreciationRate !== undefined) setInput(c.ws.getCell(c.r, 5), host.depreciationRate, NUMFMT.pct2);
      else if (!live) derived(c.ws.getCell(c.r, 5), lifeEffective > 0 ? 2 / lifeEffective : 0, NUMFMT.pct2);
    } else if (!live) derived(c.ws.getCell(c.r, 5), lifeEffective > 0 ? 1 / lifeEffective : 0, NUMFMT.pct2);
    const openingLand = rows.reduce((s, x) => s + (x.land.openingAtAxisStart ?? 0), 0);
    const openingBldg = rows.reduce((s, x) => s + (x.depreciable.openingNBVPerPeriod[0] ?? 0), 0);
    if (live) {
      // The opening balances at the model start, typed here (existing operations, which the live
      // workbook refuses; at zero they are declared inert below). Schedules no longer echoes them.
      setInput(c.ws.getCell(c.r, 6), openingLand, NUMFMT.money);
      setInput(c.ws.getCell(c.r, 7), openingBldg, NUMFMT.money);
      const phase = state.phases.find((p) => p.id === host.phaseId);
      if (openingLand === 0 && openingBldg === 0 && phaseHasModelCapex(phase)) for (const col of [6, 7]) registerCell(inertKey(INERT_INPUTS.openingFixedAssets, c.sheetName, c.r, col), c.ws, c.ws.getCell(c.r, col));
    } else {
      derived(c.ws.getCell(c.r, 6), openingLand > 0 ? openingLand : '-', openingLand > 0 ? NUMFMT.money : '@');
      derived(c.ws.getCell(c.r, 7), openingBldg > 0 ? openingBldg : '-', openingBldg > 0 ? NUMFMT.money : '@');
    }
    c.r += 1;
  }
  if (!live) note(c, 'An unshaded useful life is blank on the platform and inherits the asset category default. Straight line rate = 1 / life; a blank reducing balance rate = 2 / life.');
  c.r += 1;
}

// ── MODULE 4: P&L INPUTS ────────────────────────────────────────────────────

export function emitStatementInputsSection(c: SheetCursor, state: FinancialsResolverState): void {
  const p = state.project;
  const terminology = p.financialTerminology ?? defaultTerminologyForCountry(p.country);
  const zakat = terminology === 'saudi';
  setSectionHeader(c.ws.getRow(c.r), 'P&L Inputs', 3); c.r += 1;
  kv(c, 'Terminology mode', zakat ? 'Saudi (EBITDA / EBIT / Zakat)' : 'Standard (EBITDA / EBIT / Tax)', '@', p.financialTerminology !== undefined,
    undefined, p.financialTerminology === undefined ? 'Not set: follows the country.' : undefined);
  kv(c, `${zakat ? 'Zakat' : 'Tax'} Rate (%)`, p.tax?.rate ?? 0, NUMFMT.pct2, true, 'TaxRate', undefined, 'project:taxRate');
  kv(c, `${zakat ? 'Zakat' : 'Tax'} on the disposal gain`, p.tax?.applyToDisposalGain === true ? 'Charge it on the gain at exit' : 'Not charged on the gain at exit', '@', true);
  // Live where a lag was stated at export (the payable rows exist); a zero lag prints no payable.
  const lag = (p.tax?.paymentDays ?? 0) > 0;
  const payRow = kv(c, `${zakat ? 'Zakat' : 'Tax'} payment (days)`, p.tax?.paymentDays ?? 0, NUMFMT.int, true, undefined, undefined, lag ? 'project:taxDays' : undefined);
  if (!lag) fixedHere(c, payRow, 2, `Days after the year end it is paid; 0 pays it in the year it is charged. A lag stated at export is live.`);
  registerCell(deadSwitchKey(DEAD_SWITCHES.zakatDays, c.sheetName, payRow, 2), c.ws, c.ws.getCell(payRow, 2));
  kv(c, 'Basis', (p.tax?.basis ?? 'zakat') === 'cit' ? 'Corporate income tax (losses carried forward, 25% cap)' : 'Zakat (net worth; no loss carry-forward)', '@', true);
  kv(c, 'Statutory reserve transfer (% of PAT)', p.statutoryReserve?.transferRate ?? 0, NUMFMT.pct, true, undefined, undefined, 'project:reserveRate');
  const capRow = kv(c, 'Statutory reserve cap (% share capital)', p.statutoryReserve?.capOfShareCapital ?? 0, NUMFMT.pct, true, undefined, undefined, 'project:reserveCap');
  fixedHere(c, capRow, 2, 'A cap of zero at export applies no cap; a cap stated at export is live.');
  registerCell(deadSwitchKey(DEAD_SWITCHES.reserveCap, c.sheetName, capRow, 2), c.ws, c.ws.getCell(capRow, 2));
  kv(c, 'Share capital (explicit, 0 = auto)', p.shareCapital ?? 0, NUMFMT.money, true, undefined, undefined, 'project:shareCapital');
  // 2026-10-06: where hotel and lease lines state their OWN receivable days
  // (receivableDays.ts), the engine collects them on those, so this one door is
  // the days EVERY such line collects on (the live layers refuse a model whose
  // lines differ from it), and it says so; typing it moves every line.
  const ownDays = state.assets.some((a) => a.visible !== false && statedLineReceivableDays(a) !== undefined);
  kv(c, isLiveLayout() ? 'Operating receivables, project DSO (days; a hotel or lease line with no days of its own)' : ownDays ? 'Operating receivables, days (every hotel and lease line)' : 'Operating receivables, DSO (days)', p.operatingAr?.dsoDays ?? 0, NUMFMT.int, true, 'DsoDays', undefined, 'project:dso');
  c.r += 1;
}

// ── MODULE 5: RETURNS ASSUMPTIONS ───────────────────────────────────────────

const TERMINAL_METHOD_LABELS: Record<string, string> = {
  exit_multiple: 'Exit Multiple', cap_rate: 'Exit Cap Rate', perpetuity: 'Perpetuity (Gordon)', none: 'None',
};

export function emitReturnsSection(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  const cfg = resolveReturnsConfig(state.project, snap.axisLength);
  const stored = state.project.returns ?? {};
  setSectionHeader(c.ws.getRow(c.r), 'Returns Assumptions', 3); c.r += 1;
  const drRow = kv(c, 'Discount Rate (%)', cfg.discountRate, NUMFMT.pct, stored.discountRate !== undefined, 'DiscountRate', undefined, 'inp=ret|Discount Rate (%)@4');
  if (isLiveLayout()) registerCell(inertKey(INERT_INPUTS.discountRate, c.sheetName, drRow, 2), c.ws, c.ws.getCell(drRow, 2));
  kv(c, 'Exit Year', snap.projectStartYear + cfg.exitYearOffset, NUMFMT.year, stored.exitYearOffset !== undefined, 'ExitYear', undefined, 'inp=ret|Exit Year@4');
  kv(c, 'Terminal Value Method', TERMINAL_METHOD_LABELS[cfg.terminalMethod] ?? cfg.terminalMethod, '@', stored.terminalMethod !== undefined);
  if (cfg.terminalMethod === 'exit_multiple') kv(c, 'Exit Multiple (x stabilised NOI)', cfg.exitMultiple, NUMFMT.mult, stored.exitMultiple !== undefined, 'ExitMultiple', undefined, 'inp=ret|Exit Multiple (x stabilised NOI)@4');
  if (cfg.terminalMethod === 'perpetuity' || cfg.terminalMethod === 'cap_rate') {
    const gRow = kv(c, 'Growth g (%)', cfg.perpetuityGrowth, NUMFMT.pct2, stored.perpetuityGrowth !== undefined, 'PerpetuityGrowth', undefined, 'inp=ret|Growth g (%)@4');
    if (isLiveLayout() && cfg.terminalMethod === 'cap_rate' && cfg.capRateSource === 'manual' && !cfg.applyGrowthToTerminal) registerCell(inertKey(INERT_INPUTS.growthG, c.sheetName, gRow, 2), c.ws, c.ws.getCell(gRow, 2));
  }
  if (cfg.terminalMethod !== 'none') {
    kv(c, 'Terminal value basis', cfg.terminalValueBasis === 'exit_year' ? 'Exit year' : 'Year before exit', '@', stored.terminalValueBasis !== undefined);
  }
  if (cfg.terminalMethod === 'cap_rate') {
    const manual = cfg.capRateSource === 'manual';
    kv(c, 'Exit Cap Rate (%)', manual ? cfg.capRate : cfg.capRateDerived, NUMFMT.pct2, manual, 'CapRate',
      manual ? `Set by you (WACC less growth would be ${(cfg.capRateDerived * 100).toFixed(2)}%).` : 'WACC less growth, derived.', manual ? 'inp=ret|Exit Cap Rate (%)@4' : undefined);
  }
  if (cfg.terminalMethod !== 'none') {
    kv(c, 'Terminal metric', cfg.applyGrowthToTerminal ? 'Grown by (1 + g)' : 'Exit year as is', '@', stored.applyGrowthToTerminal !== undefined);
  }
  c.r += 1;
  if (!isLiveLayout()) return;
  // THE EXISTING POSITION AT THE MODEL START (live workbook, 2026-10-20): typed here, the Returns
  // sheet reads them. Existing operations are not built live, so these are as exported.
  {
    const ex = snap.financing.existing;
    setSectionHeader(c.ws.getRow(c.r), 'Existing position at the model start', 2); c.r += 1;
    const one = (label: string, v: number, key: string): void => {
      setLabel(c.ws.getCell(c.r, 1), label);
      setInput(c.ws.getCell(c.r, 2), v, NUMFMT.money);
      registerCell(key, c.ws, c.ws.getCell(c.r, 2));
      c.r += 1;
    };
    one('Historical development investment', Math.max(0, ex.preCapexTotal), 'retin:hist');
    one('Existing debt', Math.max(0, ex.debtOutstandingTotal), 'retin:debt');
    one('Existing equity', snap.financing.equity.totalExisting, 'retin:equity');
    c.r += 1;
  }
  // THE SENSITIVITY GRID'S AXES (live workbook, 2026-10-20): typed here, the Returns grid reads them.
  {
    setSectionHeader(c.ws.getRow(c.r), 'Sensitivity grid axes', 8); c.r += 1;
    const axis = (label: string, vals: number[], key: string): void => {
      setLabel(c.ws.getCell(c.r, 1), label);
      vals.forEach((v, i) => { setInput(c.ws.getCell(c.r, 2 + i), v, NUMFMT.pct2); registerCell(`${key}:${i}`, c.ws, c.ws.getCell(c.r, 2 + i)); });
      c.r += 1;
    };
    axis('Sales price change', defaultSensitivityValues('sales_price_pct', cfg.discountRate), 'sensin:price');
    axis('Exit cap rate', defaultSensitivityValues('exit_cap_rate', cfg.discountRate), 'sensin:cap');
    c.r += 1;
  }
  // THE EQUITY PARTNERS AND THE LENDER COVENANTS (live workbook): typed here, the Returns sheet echoes them.
  const partners = state.project.partners ?? [];
  const effective = partners.length ? partners : [{ id: 'sponsor', name: 'Sponsor', cashPct: 100, inKindPct: 100, existingPct: 100 }];
  const ps = computeReturnsSnapshot(snap, state.project).partners.partners;
  const pct = (v: number | undefined): number => (Number.isFinite(v) ? (v as number) / 100 : 0);
  setSectionHeader(c.ws.getRow(c.r), 'Equity partners (each partner\'s share of each equity type; a blank Agreed % uses the time-weighted share)', 5); c.r += 1;
  headers(c, ['Partner', 'New cash equity %', 'In-kind equity %', 'Existing equity %', 'Agreed % (override)']);
  effective.forEach((p, j) => {
    setLabel(c.ws.getCell(c.r, 1), p.name);
    setInput(c.ws.getCell(c.r, 2), pct(p.cashPct), NUMFMT.pct2);
    registerCell(`inp=retg|Equity Partners|% share|${j + 1}`, c.ws, c.ws.getCell(c.r, 2));
    setInput(c.ws.getCell(c.r, 3), pct(p.inKindPct), NUMFMT.pct2);
    registerCell(`inp=retg|Equity Partners|% share~1|${j + 1}`, c.ws, c.ws.getCell(c.r, 3));
    setInput(c.ws.getCell(c.r, 4), pct(p.existingPct), NUMFMT.pct2);
    registerCell(`inp=retg|Equity Partners|% share~2|${j + 1}`, c.ws, c.ws.getCell(c.r, 4));
    const ag = c.ws.getCell(c.r, 5);
    if (ps[j]?.shareholdingIsManual) setInput(ag, ps[j].shareholdingPct, NUMFMT.pct2); else { markInput(ag); ag.numFmt = NUMFMT.pct2; }
    registerCell(`inp=retg|Equity Partners|Agreed % (override)|${j + 1}#blank`, c.ws, ag);
    c.r += 1;
  });
  c.r += 1;
  const covenants = state.project.covenants ?? DEFAULT_COVENANTS;
  if (covenants.length) {
    setSectionHeader(c.ws.getRow(c.r), 'Lender covenants (the threshold each is tested against)', 3); c.r += 1;
    headers(c, ['Covenant', 'Test', 'Threshold']);
    for (const cov of covenants) {
      setLabel(c.ws.getCell(c.r, 1), cov.label);
      setLabel(c.ws.getCell(c.r, 2), cov.operator === 'min' ? 'at least' : 'at most');
      setInput(c.ws.getCell(c.r, 3), cov.threshold, cov.metric === 'ltv' || cov.metric === 'debt_yield' ? NUMFMT.pct2 : NUMFMT.mult);
      registerCell(`inp=retg|Lender Covenants|${cov.label}|2`, c.ws, c.ws.getCell(c.r, 3));
      c.r += 1;
    }
    c.r += 1;
  }
}

// ── MODULE 2: REVENUE INPUTS, PER LINE ──────────────────────────────────────

const INDEX_METHOD_LABELS: Record<string, string> = {
  none: 'None', single_rate: 'Flat', yoy_compound: 'YoY Compound', yoy_per_period: 'Per-Year', step: 'Step',
};

interface LineWindow { phaseOffset: number; cStart: number; construction: number[]; operations: number[]; handoverIdx: number; defaultOpsIdx: number; opsIdx: number }

/** The screen's own window arithmetic (Module2Revenue, the per-line card). */
function lineWindow(host: Asset, phase: Phase | undefined, snap: Snap): LineWindow {
  const start = snap.projectStartYear;
  const N = Math.max(1, snap.axisLength);
  const phaseStart = utcYear(phase?.startDate, start);
  const phaseOffset = Math.max(0, phaseStart - start);
  const cp = Math.max(0, phase?.constructionPeriods ?? 0);
  const op = Math.max(0, phase?.operationsPeriods ?? 0);
  const overlap = Math.max(0, phase?.overlapPeriods ?? 0);
  const cStart = Math.max(0, Math.min(N - 1, phaseStart - start));
  const handoverIdx = Math.max(cStart, Math.min(N - 1, cStart + cp - 1));
  const defaultOpsIdx = Math.max(cStart, Math.min(N - 1, handoverIdx + 1 - overlap));
  const override = host.strategy === 'Lease' ? host.revenue?.lease?.operationsStartYearOverride : host.revenue?.operate?.operationsStartYearOverride;
  const opsIdx = override != null ? Math.max(cStart, Math.min(N - 1, override - start)) : defaultOpsIdx;
  const opsEnd = Math.max(opsIdx, Math.min(N - 1, defaultOpsIdx + op - 1));
  const range = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k);
  return {
    phaseOffset, cStart,
    construction: cp > 0 ? range(cStart, handoverIdx) : [],
    operations: op > 0 ? range(opsIdx, opsEnd) : [],
    handoverIdx, defaultOpsIdx, opsIdx,
  };
}

/** A strip of per-year values over a window, the years as headers. */
/**
 * FORMULA-LINKED EXPORT KEYS (stage9InputLinks). `inp=<module key>@<col>[#conv]`
 * says the module sheet's copy of this input echoes THIS cell (Inputs is the one
 * place a user types); `fixed:<why>` says the live workbook is built for the
 * value at export, which the audit applies only if no formula reads the cell.
 * Registering writes nothing: the hardcoded export is unchanged.
 */
const linkHere = (c: SheetCursor, row: number, col: number, spec: string | undefined): void => {
  if (spec) registerCell(`inp=${spec}`, c.ws, c.ws.getCell(row, col));
};
export const fixedHere = (c: SheetCursor, row: number, col: number, why: string): void => {
  registerCell(`fixed:${why}|${c.sheetName}!R${row}C${col}`, c.ws, c.ws.getCell(row, col));
};

function yearStrip(c: SheetCursor, label: string, years: number[], values: (idx: number) => number | undefined, fmt: string, input: boolean, snap: Snap, headerLabel = 'Year', linkOf?: (idx: number) => string | undefined): void {
  if (years.length === 0) return;
  setColHeader(c.ws.getCell(c.r, 1), headerLabel, 'left');
  years.forEach((idx, i) => setColHeader(c.ws.getCell(c.r, 2 + i), snap.projectStartYear + idx, 'right'));
  c.r += 1;
  setLabel(c.ws.getCell(c.r, 1), label, { indent: 1 });
  years.forEach((idx, i) => {
    const v = values(idx) ?? 0;
    if (input) setInput(c.ws.getCell(c.r, 2 + i), v, fmt); else derived(c.ws.getCell(c.r, 2 + i), v, fmt);
    if (input) linkHere(c, c.r, 2 + i, linkOf?.(idx));
  });
  c.r += 1;
}

/**
 * A STRIP KEYED BY PHASE YEAR (live layout, 2026-10-25, founder): the columns are
 * Year 1, Year 2... of the phase, counted from its first year, never a calendar
 * year, so a phase that moves carries its typed years with it and no "start year
 * at export" shift is needed. It is the count the platform stores these arrays in
 * (index 0 = the phase's first year, `expandPhaseLocalToAxis`), so a change of
 * construction years moves nothing the platform would not move either.
 * `yearOf(idx)` turns the axis year a column holds today into its construction or operating year. Each cell is registered
 * `rxgrid|<grid>@<n>`, which the Revenue tab reads through the Timeline year counters.
 */
function phaseYearStrip(c: SheetCursor, label: string, idxs: number[], values: (idx: number) => number | undefined, headerLabel: string, yearOf: (idx: number) => number, grid: string, head = 'Year'): void {
  if (idxs.length === 0) return;
  setColHeader(c.ws.getCell(c.r, 1), headerLabel, 'left');
  idxs.forEach((idx, i) => setColHeader(c.ws.getCell(c.r, 2 + i), `${head} ${yearOf(idx)}`, 'right'));
  c.r += 1;
  setLabel(c.ws.getCell(c.r, 1), label, { indent: 1 });
  idxs.forEach((idx, i) => {
    setInput(c.ws.getCell(c.r, 2 + i), values(idx) ?? 0, NUMFMT.pct);
    registerCell(`rxgrid|${grid}@${yearOf(idx)}`, c.ws, c.ws.getCell(c.r, 2 + i));
  });
  c.r += 1;
}

/** The module sheets' year columns: the axis year idx sits in column 6 + idx (PERIOD_COLS). */
const axisCol = (idx: number): number => 6 + idx;

function indexationRows(c: SheetCursor, title: string, ix: { method?: string; rate?: number; startYear?: number; steps?: Array<{ year: number; factor: number }> } | undefined, snap: Snap, revfootLine?: string): void {
  const method = ix?.method ?? 'none';
  kv(c, `${title}: method`, INDEX_METHOD_LABELS[method] ?? method, '@', true);
  if (method === 'yoy_compound' || method === 'single_rate') {
    // The Revenue foot carries the rate and the start as a MODEL-YEAR INDEX; Inputs states the calendar year.
    // The live workbook reads these two cells directly (rxin keys, 2026-10-15); the hardcoded one links its foot.
    const live = isLiveLayout() && !!revfootLine;
    kv(c, `${title}: rate %`, ix?.rate ?? 0, NUMFMT.pct2, true, undefined, undefined, live ? `rxin|${revfootLine}|rate` : revfootLine ? `inp=revfoot|${revfootLine}|idx@4` : undefined);
    kv(c, `${title}: start year`, snap.projectStartYear + (ix?.startYear ?? 0), NUMFMT.year, ix?.startYear !== undefined || live, undefined, undefined,
      live ? `rxin|${revfootLine}|from` : revfootLine && ix?.startYear !== undefined ? `inp=revfoot|${revfootLine}|idx@5#yearidx` : undefined);
  }
  if (method === 'step') {
    for (const s of ix?.steps ?? []) kv(c, `${title}: step from ${s.year}`, s.factor, NUMFMT.rate, true);
  }
}

function ancillaryRows(c: SheetCursor, title: string, cfg: { mode?: string; percentOfRooms?: number | number[]; ratePerGuest?: number | number[]; fixedAmountPerPeriod?: number | number[] } | undefined, link?: string): void {
  const scalar = (v: number | number[] | undefined): number => (v == null ? 0 : typeof v === 'number' ? v : (v[0] ?? 0));
  const mode = cfg?.mode ?? 'percent_of_rooms';
  kv(c, `${title}: driver`, mode === 'percent_of_rooms' ? '% of Rooms' : mode === 'per_guest' ? 'Per Guest' : 'Baseline + Growth', '@', true);
  if (mode === 'percent_of_rooms') kv(c, `${title}: % of rooms revenue`, scalar(cfg?.percentOfRooms), NUMFMT.pct2, true, undefined, undefined, link);
  else if (mode === 'per_guest') kv(c, `${title}: rate per guest`, scalar(cfg?.ratePerGuest), NUMFMT.rate, true);
  else kv(c, `${title}: baseline amount`, scalar(cfg?.fixedAmountPerPeriod), NUMFMT.money, true);
}

export function emitRevenueInputs(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  const visible = state.assets.filter((a) => a.visible !== false);
  const lines = planRevenueLines(visible, state.subUnits, state.phases, state.project);
  const reportLines = planReportLines({ assets: visible, phases: state.phases, parcels: state.parcels });
  const titleOf = (line: RevenueLine): string => {
    const rl = reportLines.find((l) => l.assetIds.includes(line.host.id));
    return rl ? lineTitle(rl, { assets: visible, phases: state.phases, parcels: state.parcels }) : `${line.label}${line.phaseName ? `, ${line.phaseName}` : ''}`;
  };
  if (lines.length === 0) { note(c, 'No revenue lines yet.'); c.r += 1; return; }
  for (const group of groupRevenueLines(lines)) {
    band(c, group.section, 12);
    c.r += 1;
    for (const line of group.lines) {
      const host = line.host;
      const phase = state.phases.find((p) => p.id === line.phaseId);
      const w = lineWindow(host, phase, snap);
      setSectionHeader(c.ws.getRow(c.r), `Revenue inputs, ${titleOf(line)} (${line.strategy})`, 12); c.r += 1;
      if (line.form === 'sell') emitSellLine(c, line, w, snap, phase);
      else if (line.form === 'operate') emitOperateLine(c, line, w, snap, state.project.operatingAr?.dsoDays ?? 0);
      else emitLeaseLine(c, line, w, snap, state.project.operatingAr?.dsoDays ?? 0);
      c.r += 1;
    }
  }
}

function emitSellLine(c: SheetCursor, line: RevenueLine, w: LineWindow, snap: Snap, phase: Phase | undefined): void {
  const host = line.host;
  const sell = host.revenue?.sell;
  const units: SubUnit[] = line.subUnits;
  if (!sell) { note(c, 'No sale terms on this line yet.'); return; }
  // VELOCITY, read the way the engine reads it: the row's own entry, else the
  // line pace, else nothing (resolveRowVelocity).
  const axisOf = (arr: number[] | undefined, legacy: number[] | undefined) => (idx: number): number | undefined =>
    arr !== undefined ? arr[idx - w.phaseOffset] : legacy?.[idx];
  const velocityRows: Array<{ label: string; revRow?: string; pre: (i: number) => number | undefined; post: (i: number) => number | undefined }> = [];
  if (sell.velocityDefault && units.length !== 1) {
    const pace = resolveLinePace(sell, phase ?? {});
    velocityRows.push({ label: 'All sub-units (line pace)', pre: axisOf(pace?.pre, undefined), post: axisOf(pace?.post, undefined) });
  } else {
    for (const u of units) {
      const v = resolveRowVelocity(sell, u.id, phase ?? {});
      velocityRows.push({
        label: `${u.name || 'sub-unit'}${v.source === 'default' ? ' (line pace)' : v.source === 'none' ? ' (no velocity: sells nothing)' : ''}`,
        // The Revenue card's row for this sub-unit, the velocity the live sale passes read.
        revRow: u.name || undefined,
        pre: axisOf(v.pre, v.preLegacy), post: axisOf(v.post, v.postLegacy),
      });
    }
  }
  const velLink = (table: string, row: { revRow?: string }) => (idx: number): string | undefined =>
    row.revRow ? `revin|${line.key}|${table}|${row.revRow}@${axisCol(idx)}` : undefined;
  if (isLiveLayout()) {
    // Pre-sales keyed by construction year, sales during operation by operating year (2026-10-26):
    // the platform's own keys, so a longer build moves the operating grid with the opening.
    const cy = (idx: number): number => idx - w.phaseOffset + 1;
    const oy = (idx: number): number => idx - w.opsIdx + 1;
    for (const [i, row] of velocityRows.entries()) {
      phaseYearStrip(c, row.label, w.construction, row.pre, i === 0 ? 'Pre-Sales velocity, by construction year' : '', cy, `${line.key}|pre|${row.revRow ?? row.label}`);
    }
    for (const [i, row] of velocityRows.entries()) {
      phaseYearStrip(c, row.label, w.operations, row.post, i === 0 ? 'Sales During Operation, by operating year' : '', oy, `${line.key}|post|${row.revRow ?? row.label}`, 'Ops year');
    }
  }
  if (!isLiveLayout() && w.construction.length > 0) {
    for (const [i, row] of velocityRows.entries()) {
      yearStrip(c, row.label, w.construction, row.pre, NUMFMT.pct, true, snap, i === 0 ? `Pre-Sales velocity, ${snap.projectStartYear + w.construction[0]} to ${snap.projectStartYear + w.construction[w.construction.length - 1]}` : '', velLink('Pre-Sales velocity', row));
    }
  }
  if (!isLiveLayout() && w.operations.length > 0) {
    for (const [i, row] of velocityRows.entries()) {
      yearStrip(c, row.label, w.operations, row.post, NUMFMT.pct, true, snap, i === 0 ? `Sales During Operation, ${snap.projectStartYear + w.operations[0]} to ${snap.projectStartYear + w.operations[w.operations.length - 1]}` : '', velLink('Sales During Operation', row));
    }
  }
  indexationRows(c, 'Price Indexation', sell.indexation, snap, line.key);
  const rec = sell.recognitionProfile ?? { method: 'point_in_time' as const, pointInTimeYear: 'handover' as const };
  kv(c, 'Revenue Recognition', rec.method === 'over_time' ? 'Over-Time' : 'Point-in-Time', '@', true);
  if (rec.method !== 'over_time') {
    const pit = rec.pointInTimeYear ?? 'handover';
    kv(c, 'Recognition year', pit === 'sale_year' ? 'At sale year' : pit === 'custom' ? `At custom year (${rec.pointInTimeCustomYear ?? snap.projectStartYear + w.handoverIdx})` : isLiveLayout() ? 'At handover (the handover year on Timeline)' : `At handover (${snap.projectStartYear + w.handoverIdx})`, '@', true);
  } else {
    const pct = rec.percentagesByPhase ?? rec.percentages ?? [];
    let n = 0; for (let i = 0; i < pct.length; i++) if ((pct[i] ?? 0) !== 0) n = i + 1;
    if (n > 0) yearStrip(c, 'Recognition %', Array.from({ length: n }, (_, i) => i), (i) => pct[i], NUMFMT.pct, true, { ...snap, projectStartYear: 1 } as Snap, 'Year from sale');
  }
  // SALE COHORT TERMS PRINT ON EVERY SELL LINE, handover recognition included:
  // they drive collections whatever the recognition method is.
  const block = buildSaleCohortTermsBlock(host, phase, Number(snap.yearLabels[0]) || 0);
  if (block && block.downpayments.length && isLiveLayout()) {
    // Keyed by the construction year of the sale (phaseYearStrip), not the calendar year.
    const phaseStartYear = utcYear(phase?.startDate, snap.projectStartYear);
    const byIdx = new Map(block.downpayments.map((d) => [d.year - snap.projectStartYear, d.value]));
    phaseYearStrip(c, 'Downpayment % by sale year', [...byIdx.keys()], (idx) => byIdx.get(idx), 'Sale cohort terms, by construction year of the sale',
      (idx) => idx + snap.projectStartYear - phaseStartYear + 1, `${line.key}|dp`);
    kv(c, 'Max instalment years after sale', block.instalmentYears, NUMFMT.int, true, undefined, undefined, `rxin|${line.key}|inst`);
    kv(c, 'Instalments', block.stopAtHandover ? 'Stop at handover' : 'May run past handover', '@', true);
    note(c, saleCohortRuleText(block));
  } else if (block && block.downpayments.length) {
    setColHeader(c.ws.getCell(c.r, 1), 'Sale cohort terms', 'left');
    block.downpayments.forEach((d, i) => setColHeader(c.ws.getCell(c.r, 2 + i), String(d.year), 'right'));
    c.r += 1;
    setLabel(c.ws.getCell(c.r, 1), 'Downpayment % by sale year', { indent: 1 });
    block.downpayments.forEach((d, i) => {
      setInput(c.ws.getCell(c.r, 2 + i), d.value, NUMFMT.pct);
      linkHere(c, c.r, 2 + i, `revin|${line.key}|Sale cohort terms|Downpayment %@${axisCol(d.year - snap.projectStartYear)}`);
    });
    c.r += 1;
    kv(c, 'Max instalment years after sale', block.instalmentYears, NUMFMT.int, true, undefined, undefined, `inp=revin|${line.key}|Sale cohort terms|Max instalment years after sale@4`);
    kv(c, 'Instalments', block.stopAtHandover ? 'Stop at handover' : 'May run past handover', '@', true);
    note(c, saleCohortRuleText(block));
  }
}

/**
 * THE OPERATIONS START, TYPED ONCE (live layout, 2026-10-14): the cell holds an
 * override or nothing, and the Revenue card works out the year from it (blank:
 * the year after handover). The hardcoded export prints the year in force.
 */
function opsStartRow(c: SheetCursor, line: RevenueLine, w: LineWindow, snap: Snap, override: number | null | undefined, link: string): void {
  if (!isLiveLayout()) {
    kv(c, 'Operations start year', snap.projectStartYear + w.opsIdx, NUMFMT.year, override != null,
      undefined, `Default (after handover): ${snap.projectStartYear + w.defaultOpsIdx}`, override != null ? link : undefined);
    return;
  }
  const r = kv(c, 'Operations start year, if not the year after handover', override ?? undefined, NUMFMT.year, true, undefined, 'Blank: the year after handover.', `oxin|opsStart|${line.key}`);
  if (override == null) markInput(c.ws.getCell(r, 2));
}

/**
 * A HOTEL OR LEASE LINE'S RECEIVABLE DAYS (live layout, 2026-10-25, founder: a live input).
 * The cell holds the line's OWN days, the platform's rule (receivableDays.ts): a positive
 * figure is the line's, a blank (or 0) collects on the project DSO. Schedules builds the
 * line's operating receivable, and so its cash timing, from it (`rxin|<line>|arDays`).
 * The hardcoded export prints the days in force, as before.
 */
function arRow(c: SheetCursor, line: RevenueLine, own: number | undefined, ...legacy: Parameters<typeof kv> extends [SheetCursor, ...infer R] ? R : never): void {
  if (!isLiveLayout()) { kv(c, ...legacy); return; }
  const stated = typeof own === 'number' && Number.isFinite(own) && own > 0 ? own : undefined;
  const r = kv(c, 'Accounts Receivable Days (blank = the project DSO)', stated, NUMFMT.int, true, undefined, 'Days after which this line\'s revenue is collected; blank or 0 collects on the project DSO.', `rxin|${line.key}|arDays`);
  if (stated === undefined) { const cell = c.ws.getCell(r, 2); markInput(cell); cell.numFmt = NUMFMT.int; }
}

function emitOperateLine(c: SheetCursor, line: RevenueLine, w: LineWindow, snap: Snap, projectDso: number): void {
  const op = line.host.revenue?.operate;
  // THE ADR THE ENGINE SELLS AT: the first positive of the row's stored ADR and
  // its Table 5 price (resolveSubUnitAdr). A stored 0 never shadows a price.
  // The live workbook reads the ADR where it is typed, the sub-unit's Table 5 rate: no second copy here.
  if (!isLiveLayout()) for (const u of line.subUnits) kv(c, `Starting ADR, ${u.name || 'sub-unit'} (per room per night, Table 5)`, resolveSubUnitAdr(u), NUMFMT.rate, false);
  const L = (label: string, col = 4): string => `inp=revin|${line.key}|*|${label}@${col}`;
  indexationRows(c, 'ADR indexation', op?.adrIndexation, snap, line.key);
  opsStartRow(c, line, w, snap, op?.operationsStartYearOverride, L('Operations start year'));
  const occ = op ? occupancyAxis({ ...op, occupancyShiftPts: undefined }, w.opsIdx - w.cStart, w.phaseOffset, Math.max(1, snap.axisLength)) : [];
  if (isLiveLayout()) phaseYearStrip(c, 'Occupancy', w.operations, (idx) => occ[idx], 'Occupancy ramp, by operating year', (idx) => idx - w.opsIdx + 1, `${line.key}|occ`, 'Ops year');
  else yearStrip(c, 'Occupancy', w.operations, (idx) => occ[idx], NUMFMT.pct, true, snap, 'Occupancy ramp', (idx) => `revin|${line.key}|*|Occupancy ramp@${axisCol(idx)}`);
  if (isLiveLayout()) kv(c, 'Days per year', op?.daysPerYear ?? 365, NUMFMT.int, true, undefined, 'Available room nights = keys x days per year.', `rxin|${line.key}|days`);
  // The live workbook reads these three where they are typed (2026-10-27): the Revenue card is gone.
  const live = isLiveLayout();
  kv(c, 'Average guests per occupied room night', op?.guestsPerOccupiedRoom ?? 1.5, NUMFMT.rate, op?.guestsPerOccupiedRoom !== undefined, undefined, undefined, live ? `rxin|${line.key}|guests` : L('Average guests per occupied room night'));
  ancillaryRows(c, 'F&B Revenue', op?.fb, live ? `rxin|${line.key}|fb` : L('F&B Revenue, F&B %'));
  ancillaryRows(c, 'Other Revenue', op?.otherRevenue, live ? `rxin|${line.key}|other` : L('Other Revenue, Other %'));
  arRow(c, line, op?.dso, op?.dso !== undefined ? 'Accounts Receivable Days (set on this line)' : 'Accounts Receivable Days (the project DSO; this line states none)', op?.dso ?? Math.max(0, projectDso), NUMFMT.int, op?.dso !== undefined, undefined, undefined, L('Accounts Receivable Days'));
}

function emitLeaseLine(c: SheetCursor, line: RevenueLine, w: LineWindow, snap: Snap, projectDso: number): void {
  const lease = line.host.revenue?.lease;
  // THE RENT THE ENGINE LETS AT: the Table 5 price, else the line's stored base rate.
  // The live workbook reads the rent where it is typed, the sub-unit's Table 5 rate: no second copy here.
  if (!isLiveLayout()) for (const u of line.subUnits) {
    kv(c, `Rent, ${u.name || 'sub-unit'} (per sqm per year, Table 5)`, (u.unitPrice ?? 0) > 0 ? (u.unitPrice as number) : (lease?.baseRate ?? 0), NUMFMT.rate, false);
  }
  const L = (label: string, col = 4): string => `inp=revin|${line.key}|*|${label}@${col}`;
  indexationRows(c, 'Rent indexation', lease?.rentIndexation, snap, line.key);
  opsStartRow(c, line, w, snap, lease?.operationsStartYearOverride, L('Operations start year'));
  const occ = lease ? occupancyAxis({ ...lease, occupancyShiftPts: undefined }, w.opsIdx - w.cStart, w.phaseOffset, Math.max(1, snap.axisLength)) : [];
  if (isLiveLayout()) phaseYearStrip(c, 'Occupancy', w.operations, (idx) => occ[idx], 'Occupancy ramp, by operating year', (idx) => idx - w.opsIdx + 1, `${line.key}|occ`, 'Ops year');
  else yearStrip(c, 'Occupancy', w.operations, (idx) => occ[idx], NUMFMT.pct, true, snap, 'Occupancy ramp', (idx) => `revin|${line.key}|*|Occupancy ramp@${axisCol(idx)}`);
  arRow(c, line, lease?.arDays, lease?.arDays !== undefined ? 'Accounts Receivable Days (set on this line)' : 'Accounts Receivable Days (the project DSO; this line states none)', lease?.arDays ?? Math.max(0, projectDso), NUMFMT.int, lease?.arDays !== undefined, undefined, undefined, L('Accounts Receivable Days'));
}

export function emitEscrowInputs(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  const p = state.project;
  const assets = state.assets;
  setSectionHeader(c.ws.getRow(c.r), 'Escrow Inputs', 7); c.r += 1;
  const liveEsc = isLiveLayout();
  // The live workbook reads the escrow inputs here (2026-10-27): Revenue no longer echoes them.
  kv(c, 'Project Held % (regulator-locked)', p.escrow?.heldPct ?? 0, NUMFMT.pct2, true, undefined, undefined, liveEsc ? 'escin|pct' : 'inp=esc|||Project Held % (regulator-locked)@4');
  /** A year that may be blank (auto): shaded either way in the live workbook, which reads a blank as auto. */
  const yearDoor = (label: string, v: number | undefined, auto: string, key: string): void => {
    if (!liveEsc) { kv(c, label, v ?? auto, v !== undefined ? NUMFMT.year : '@', v !== undefined); return; }
    const r = kv(c, label, v, NUMFMT.year, true, undefined, `Blank = ${auto}.`, key);
    if (v === undefined) { const cell = c.ws.getCell(r, 2); markInput(cell); cell.numFmt = NUMFMT.year; }
  };
  yearDoor('Default Held Until Year (optional)', p.escrow?.defaultHeldUntilYear, 'auto: handover year', 'escin|until');
  yearDoor('Default Release Year (optional)', p.escrow?.defaultReleaseYear, 'auto: handover year + 1', 'escin|release');
  const revLines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
  const lines = planReportLines({ assets, phases: state.phases, parcels: state.parcels }, (a) => snap.escrow.byAsset.has(a.id));
  if (lines.length > 0) {
    // THE LIVE WORKBOOK HOLDS THE OVERRIDES ONLY (2026-10-25): the effective figures are worked out on
    // Revenue's escrow table, the tab that uses them, so no derived value sits among the inputs.
    headers(c, liveEsc ? ['Asset', 'Held % Override', 'Held Until Override', 'Release Year Override']
      : ['Asset', 'Effective Held %', 'Held % Override', 'Effective Held Until', 'Held Until Override', 'Effective Release Year', 'Release Year Override']);
    for (const line of lines) {
      const host = snap.escrow.byAsset.get(line.assetIds[0]);
      const a = assets.find((x) => x.id === line.assetIds[0]);
      const esc = a?.revenue?.sell?.escrow;
      setLabel(c.ws.getCell(c.r, 1), lineTitle(line, { assets, phases: state.phases, parcels: state.parcels }));
      if (!liveEsc) derived(c.ws.getCell(c.r, 2), host?.effectiveHeldPct ?? 0, NUMFMT.pct2);
      const ovCell = (col: number, v: number | undefined, fmt: string, modCol: number): void => {
        const cell = c.ws.getCell(c.r, col);
        if (v !== undefined) setInput(cell, v, fmt); else if (liveEsc) { markInput(cell); cell.numFmt = fmt; }
        const rl = a ? lineForAsset(revLines, a.id) : undefined;
        if (liveEsc && rl) registerCell(`escin|${revenueLineName(rl)}|${modCol === 5 ? 'held' : modCol === 7 ? 'until' : 'release'}`, c.ws, cell);
      };
      if (liveEsc) {
        ovCell(2, esc?.heldPctOverride, NUMFMT.pct2, 5);
        ovCell(3, esc?.heldUntilYearOverride, NUMFMT.year, 7);
        ovCell(4, esc?.releaseYearOverride, NUMFMT.year, 9);
      } else {
        ovCell(3, esc?.heldPctOverride, NUMFMT.pct2, 5);
        derived(c.ws.getCell(c.r, 4), host?.effectiveHeldUntilYear, NUMFMT.year);
        ovCell(5, esc?.heldUntilYearOverride, NUMFMT.year, 7);
        derived(c.ws.getCell(c.r, 6), host?.effectiveReleaseYear, NUMFMT.year);
        ovCell(7, esc?.releaseYearOverride, NUMFMT.year, 9);
      }
      c.r += 1;
    }
  }
  c.r += 1;
}

// ── MODULE 3: OPEX INPUTS, PER LINE ─────────────────────────────────────────

const opexValFmt = (mode: string): string => mode === 'fixed_baseline' ? NUMFMT.money : mode.startsWith('per_') ? NUMFMT.rate : NUMFMT.pct;

/**
 * The inflation a card states in words, as the two numbers the live workbook
 * reads (2026-10-14): the rate, and the calendar year it counts from. Only in
 * the live layout and only for a method that has them (compounding or one step).
 */
function opexInflationInputs(c: SheetCursor, who: string, key: string, cfg: unknown, axisYear: number): void {
  if (!isLiveLayout()) return;
  const ix = normalizeOpexIndexation(cfg) as { method?: string; rate?: number; startYear?: number };
  if (ix.method !== 'yoy_compound' && ix.method !== 'single_rate') return;
  kv(c, `${who} inflation: rate %`, ix.rate ?? 0, NUMFMT.pct2, true, undefined, undefined, `oxin|${key}|rate`);
  // An asset's inflation never counts from before it operates (assetOpex.ts); the label says so.
  kv(c, key === 'hq' ? `${who} inflation: counted from year` : 'Inflation counted from (or the operations start, if later)', axisYear + (ix.startYear ?? 0), NUMFMT.year, true, undefined, undefined, `oxin|${key}|from`);
}

export function emitOpexInputs(c: SheetCursor, state: FinancialsResolverState, axisYear: number): void {
  const assets = state.assets;
  const ctx = { assets, phases: state.phases, parcels: state.parcels };
  const lines = planReportLines(ctx, (a) => a.strategy === 'Operate' || a.strategy === 'Lease');
  const hosts = lines.map((line) => ({ line, host: assets.find((a) => a.id === line.assetIds[0])! })).filter((x) => !!x.host);
  const ordered = [...hosts.filter((x) => x.host.strategy === 'Operate'), ...hosts.filter((x) => x.host.strategy === 'Lease')];
  const p = state.project;
  const projectDpo = Math.max(0, p.opexAp?.defaultApDays ?? 0);
  for (const { line, host } of ordered) {
    const title = lineTitle(line, ctx);
    setSectionHeader(c.ws.getRow(c.r), `Opex lines, ${title}`, 7); c.r += 1;
    kv(c, 'Asset Inflation (default for fixed-cost lines)', summarizeOpexIndexation(host.opex?.defaultIndexation), '@', true);
    opexInflationInputs(c, 'Asset', host.id, host.opex?.defaultIndexation, axisYear);
    const all = host.opex?.lines ?? [];
    if (all.length === 0) { note(c, 'No opex lines on this line.'); c.r += 1; continue; }
    headers(c, ['Line item', 'Category', 'Mode', 'Rate', 'Value', 'Inflation', 'On']);
    // The live workbook reads each line's value and On / Off here (2026-10-28): the Opex cards are gone.
    const live = isLiveLayout();
    all.forEach((l, i) => {
      const fixed = isFixedCostOpexMode(l.mode);
      const yoy = l.rateMode === 'yoy';
      setLabel(c.ws.getCell(c.r, 1), l.name, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), OPEX_CATEGORY_LABELS[l.category] ?? String(l.category), '@');
      setInput(c.ws.getCell(c.r, 3), OPEX_MODE_LABELS[l.mode] ?? String(l.mode), '@');
      setInput(c.ws.getCell(c.r, 4), yoy ? 'YoY' : 'Single', '@');
      setInput(c.ws.getCell(c.r, 5), l.value, opexValFmt(String(l.mode)));
      if (live) registerCell(`oxv|${host.id}|${i}`, c.ws, c.ws.getCell(c.r, 5)); else linkHere(c, c.r, 5, `opexin|${host.id}||${l.name}@6`);
      if (!fixed) derived(c.ws.getCell(c.r, 6), 'auto via revenue', '@');
      else if (yoy) derived(c.ws.getCell(c.r, 6), 'supplied by YoY rates', '@');
      else if (l.useAssetDefault !== false) derived(c.ws.getCell(c.r, 6), `Inherits: ${summarizeOpexIndexation(host.opex?.defaultIndexation)}`, '@');
      else setInput(c.ws.getCell(c.r, 6), summarizeOpexIndexation(l.indexation), '@');
      setInput(c.ws.getCell(c.r, 7), l.disabled ? 'Off' : 'On', '@');
      if (live) registerCell(`oxon|${host.id}|${i}`, c.ws, c.ws.getCell(c.r, 7)); else linkHere(c, c.r, 7, `opexin|${host.id}||${l.name}@8`);
      c.r += 1;
    });
    c.r += 1;
  }
  const hq = hqOpexLinesInForce(p.hqOpex?.lines);
  if (hq.length > 0) {
    setSectionHeader(c.ws.getRow(c.r), 'HQ / Corporate opex lines', 6); c.r += 1;
    if (isLiveLayout()) {
      kv(c, 'HQ Inflation (default for fixed lines)', summarizeOpexIndexation(p.hqOpex?.defaultIndexation), '@', true);
      opexInflationInputs(c, 'HQ', 'hq', p.hqOpex?.defaultIndexation, axisYear);
    }
    headers(c, ['Line item', 'Category', 'Mode', 'Value', 'Inflation', 'On']);
    const live = isLiveLayout();
    hq.forEach((l, i) => {
      setLabel(c.ws.getCell(c.r, 1), l.name, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), OPEX_CATEGORY_LABELS[l.category] ?? String(l.category), '@');
      setInput(c.ws.getCell(c.r, 3), OPEX_MODE_LABELS[l.mode] ?? String(l.mode), '@');
      setInput(c.ws.getCell(c.r, 4), l.value, opexValFmt(String(l.mode)));
      if (live) registerCell(`oxv|hq|${i}`, c.ws, c.ws.getCell(c.r, 4)); else linkHere(c, c.r, 4, `opexin|__hq__||${l.name}@6`);
      setInput(c.ws.getCell(c.r, 5), summarizeOpexIndexation(l.indexation), '@');
      setInput(c.ws.getCell(c.r, 6), l.disabled ? 'Off' : 'On', '@');
      if (live) registerCell(`oxon|hq|${i}`, c.ws, c.ws.getCell(c.r, 6)); else linkHere(c, c.r, 6, `opexin|__hq__||${l.name}@8`);
      c.r += 1;
    });
    c.r += 1;
  }
  if (ordered.length === 0 && hq.length === 0) { note(c, 'No operating lines: opex applies to Operate and Lease lines.'); c.r += 1; }
  setSectionHeader(c.ws.getRow(c.r), 'Accounts Payable (DPO)', 3); c.r += 1;
  kv(c, 'Project Default DPO (days)', p.opexAp?.defaultApDays ?? 0, NUMFMT.int, true, 'DpoDays', 'Blank or 0 = pay on incurrence (no AP).', isLiveLayout() ? 'oxin|dpo|default' : 'inp=opexin|__ap__||Project Default DPO (days)@4#dpo');
  kv(c, 'Days basis', p.opexAp?.daysPerYear ?? 365, NUMFMT.int, p.opexAp?.daysPerYear !== undefined || isLiveLayout(), undefined, undefined, isLiveLayout() ? 'oxin|dpo|days' : undefined);
  if (ordered.length > 0) {
    const liveDpo = isLiveLayout();
    // Live layout: the override only (blank = the project default); the days in force are worked out on Opex.
    headers(c, liveDpo ? ['Asset', 'DPO override (blank = default)'] : ['Asset', 'Effective DPO (days)', 'DPO Override']);
    for (const { line, host } of ordered) {
      const override = host.opex?.apDaysOverride;
      setLabel(c.ws.getCell(c.r, 1), lineTitle(line, ctx));
      if (liveDpo) {
        if (override !== undefined) setInput(c.ws.getCell(c.r, 2), override, NUMFMT.int); else markInput(c.ws.getCell(c.r, 2));
        registerCell(`oxin|dpo|${host.id}`, c.ws, c.ws.getCell(c.r, 2));
        c.r += 1;
        continue;
      }
      derived(c.ws.getCell(c.r, 2), override !== undefined && override >= 0 ? override : projectDpo, NUMFMT.int);
      if (override !== undefined) setInput(c.ws.getCell(c.r, 3), override, NUMFMT.int);
      // The live workbook types an override here and works out the effective days beside it.
      registerCell(`oxin|dpo|${host.id}`, c.ws, c.ws.getCell(c.r, 2));
      c.r += 1;
    }
  }
  c.r += 1;
}

// ── LAND & AREA: TABLES 3 AND 4 ─────────────────────────────────────────────

const CHAIN_HEADS = [
  'Plot Area (sqm)', 'Net Developable Area (sqm)', 'Building Footprint (sqm)', 'Landscape %', 'Landscape and Open Area (sqm)',
  'Retail GFA (sqm)', 'Lobby and Circulation GFA (sqm)', 'Total GFA (sqm)', 'Main Asset GFA (sqm)', 'NSA or GLA (sqm)',
  'Average Unit Size (sqm)', 'Units or Keys', 'Parking Ratio', 'Parking Slots', 'Retail Parking Slots', 'Total Parking Slots',
  'Parking Area (sqm)', 'Retail Parking Area (sqm)', 'Total Parking Area (sqm)', 'Total BUA (sqm)',
];
export const LAND_CHAIN_COLS = 1 + CHAIN_HEADS.length;

type Pooled = Record<string, number | undefined>;
/** The twenty chain columns, one row: areas, the two ratios and the counts. */
/** The twenty chain columns' registry names, in column order. */
export const CHAIN_FIELDS = ['land', 'nda', 'fp', 'lsPct', 'ls', 'ret', 'lob', 'tg', 'main', 'nsa', 'usize', 'units', 'ratio', 'slots', 'rslots', 'tslots', 'parea', 'rparea', 'tparea', 'bua'] as const;
function registerChainRow(ws: ExcelJS.Worksheet, r: number, startCol: number, prefix: string): void {
  CHAIN_FIELDS.forEach((f, i) => registerCell(`${prefix}:${f}`, ws, ws.getCell(r, startCol + i)));
}
/** How a figure the chain did not produce is shown: the snapshot's "-", or in the live workbook a 0 (a figure
 *  the formulas work out) or a blank (a column that does not apply to the row). */
type Absent = 'dash' | 'zero' | 'blank';
function chainCells(ws: ExcelJS.Worksheet, r: number, startCol: number, landSqm: number, g: Pooled, ratios: { landscapePct?: number; unitSize?: number; slotRatio?: number }, bold = false, absent: Absent = 'dash'): void {
  const vals: Array<[number | undefined, string]> = [
    [landSqm, NUMFMT.int], [g.landUtilisedSqm, NUMFMT.int], [g.footprintSqm, NUMFMT.int],
    [ratios.landscapePct === undefined ? undefined : ratios.landscapePct, NUMFMT.pct2], [g.landscapeSqm, NUMFMT.int],
    [g.retailGfaSqm, NUMFMT.int], [g.lobbyGfaSqm, NUMFMT.int], [g.totalGfaSqm, NUMFMT.int], [g.mainAssetGfaSqm, NUMFMT.int],
    [g.netSaleableSqm, NUMFMT.int], [ratios.unitSize, NUMFMT.rate], [g.units, NUMFMT.int], [ratios.slotRatio, NUMFMT.rate],
    [g.parkingSlots, NUMFMT.int], [g.retailParkingSlots, NUMFMT.int], [g.totalParkingSlots, NUMFMT.int],
    [g.parkingAreaSqm, NUMFMT.int], [g.retailParkingAreaSqm, NUMFMT.int], [g.totalParkingAreaSqm, NUMFMT.int], [g.totalBuaSqm, NUMFMT.int],
  ];
  vals.forEach(([v, fmt], i) => {
    const cell = ws.getCell(r, startCol + i);
    if (v === undefined) {
      if (absent === 'blank') return;
      if (absent === 'zero') { derived(cell, 0, fmt, bold); return; }
      cell.value = '-'; cell.alignment = { horizontal: 'right' }; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; return;
    }
    derived(cell, v, fmt, bold);
  });
}

/** A host line WITHOUT the retail its strip carries (live layout, 2026-10-26): the strip's own line shows the
 *  retail GFA, its parking and its BUA, so the lines add up to the plots instead of counting retail twice. */
function withoutRetail(g: Pooled): Pooled {
  const ret = g.retailGfaSqm ?? 0, rs = g.retailParkingSlots ?? 0, rp = g.retailParkingAreaSqm ?? 0;
  const less = (x: number | undefined, d: number): number | undefined => (x === undefined ? undefined : x - d);
  return {
    ...g, retailGfaSqm: 0, retailParkingSlots: 0, retailParkingAreaSqm: 0,
    totalGfaSqm: less(g.totalGfaSqm, ret), totalParkingSlots: less(g.totalParkingSlots, rs),
    totalParkingAreaSqm: less(g.totalParkingAreaSqm, rp), totalBuaSqm: less(g.totalBuaSqm, ret + rp),
  };
}

export function emitLandTables(c: SheetCursor, tables: AssetAreaTables): void {
  const ws = c.ws;
  const live = isLiveLayout();
  // ONE COLUMN LAYOUT FOR BOTH TABLES (live layout, 2026-10-26): Phase, Strategy and Plots sit on the left of
  // both, so a measure is in the same column on the plot table and the line table.
  const lead = live ? 3 : 0, at = 2 + lead, cols = LAND_CHAIN_COLS + lead;
  const absent: Absent = live ? 'zero' : 'dash';
  const lineHeads = ['Phase', 'Strategy', 'Plots'];
  const stripOf = (name: string): { strategy: string } | undefined => tables.companions.find((s) => s.name === name);
  // TABLE 3, per plot: the chain run on each plot, never pooled.
  setSectionHeader(ws.getRow(c.r), 'Derived areas by plot (land x utilisation x coverage / FAR)', cols); c.r += 1;
  headers(c, ['Asset', ...(live ? lineHeads : []), ...CHAIN_HEADS]);
  for (const g of tables.plots) {
    band(c, `${g.plotLabel}${g.phaseName ? `, ${g.phaseName}` : ''}`, cols);
    for (const row of g.chains) {
      setLabel(ws.getCell(c.r, 1), row.label, { indent: 1 });
      if (live) {
        setLabel(ws.getCell(c.r, 2), g.phaseName ?? '');
        setLabel(ws.getCell(c.r, 3), g.entries.find((e) => e.assetId === row.assetId)?.strategy ?? '');
      }
      const ch = row.chain as unknown as Pooled;
      chainCells(ws, c.r, at, row.landSqm, ch, {
        landscapePct: row.chain.landscapePct === undefined ? undefined : row.chain.landscapePct / 100,
        unitSize: row.unitSizeSqm,
        slotRatio: row.ratio,
      }, false, absent);
      registerChainRow(ws, c.r, at, `chain:${row.assetId}`);
      c.r += 1;
    }
    for (const piece of g.retailPieces) {
      // Land and NSA, nothing else: its floor area is inside the hosts' rows, its land and its
      // lettable area are not (totalsFromRows), so the column totals foot to the rows above.
      // In the live layout this row IS the carve: the land the strip takes from this plot's hosts.
      setLabel(ws.getCell(c.r, 1), live ? (g.retailPieces.length > 1 ? `Retail carve-out, ${piece.name}` : 'Retail carve-out') : `${piece.name} (land carved from this plot's hosts, and its NSA here)`, { indent: 1 });
      if (live) {
        setLabel(ws.getCell(c.r, 2), g.phaseName ?? '');
        setLabel(ws.getCell(c.r, 3), stripOf(piece.name)?.strategy ?? '');
      }
      chainCells(ws, c.r, at, piece.sqm, { netSaleableSqm: piece.nsaSqm } as Pooled, {}, false, live ? 'blank' : 'dash');
      registerCell(`piece:${g.key}:${piece.name}`, ws, ws.getCell(c.r, at));
      registerCell(`piecensa:${g.key}:${piece.name}`, ws, ws.getCell(c.r, at + CHAIN_FIELDS.indexOf('nsa')));
      c.r += 1;
    }
  }
  totalRow(c, 'TOTAL, all plots', tables.plotTotal, lead, 'chaintot:plots', absent);
  note(c, `Plots hold ${Math.round(tables.parcelsTotalSqm).toLocaleString('en-US')} sqm; the Plot Area column totals ${Math.round(tables.plotTotal.landSqm).toLocaleString('en-US')} sqm including the land the retail strips carved from their hosts. A dash means a step could not be derived, which is not zero.`);
  c.r += 1;

  // TABLE 4, per line: the same rows regrouped, areas added, ratios from the row's own sums.
  const lineCols = 3 + LAND_CHAIN_COLS;
  setSectionHeader(ws.getRow(c.r), 'Merged by line', lineCols); c.r += 1;
  headers(c, ['Type', ...lineHeads, ...CHAIN_HEADS]);
  for (const l of tables.lines) {
    setLabel(ws.getCell(c.r, 1), l.typeLabel, { indent: 1 });
    setLabel(ws.getCell(c.r, 2), l.phaseName);
    setLabel(ws.getCell(c.r, 3), l.strategy);
    derived(ws.getCell(c.r, 4), l.plots, NUMFMT.int);
    registerCell(`chainline:${l.key}:plots`, ws, ws.getCell(c.r, 4));
    chainCells(ws, c.r, 5, l.landSqm, live ? withoutRetail(l.pooled) : l.pooled, { landscapePct: l.landscapePct, unitSize: l.avgUnitSize, slotRatio: l.slotsPerUnit }, false, absent);
    registerChainRow(ws, c.r, 5, `chainline:${l.key}`);
    c.r += 1;
  }
  if (tables.companions.length > 0) {
    note(c, live
      ? 'Retail strips, held on Lease. A host line leaves out the retail its strip carries (the retail GFA, its share of Total GFA, its parking and its BUA); the strip\'s line shows them, with the land its hosts gave up and its lettable area, so the lines add up to the plots.'
      : 'Retail companions, held on Lease. Their floor area is already inside the Retail GFA above; their land is the land their hosts gave up, and their NSA is their own lettable area, which no host row carries, so the totals add their land and their NSA and nothing is counted twice.');
    for (const s of tables.companions) {
      setLabel(ws.getCell(c.r, 1), s.name, { indent: 1 });
      setLabel(ws.getCell(c.r, 2), s.phaseName);
      setLabel(ws.getCell(c.r, 3), s.strategy);
      derived(ws.getCell(c.r, 4), s.hosts, NUMFMT.int);
      registerCell(`chaincomp:${s.name}:hosts`, ws, ws.getCell(c.r, 4));
      const g: Pooled = { retailGfaSqm: s.retailGfaSqm, totalGfaSqm: s.retailGfaSqm, netSaleableSqm: s.nsaSqm, retailParkingSlots: s.slots, retailParkingAreaSqm: s.parkingAreaSqm, totalParkingAreaSqm: s.parkingAreaSqm, totalBuaSqm: s.totalBuaSqm, ...(live ? { totalParkingSlots: s.slots } : {}) };
      chainCells(ws, c.r, 5, s.landSqm, g, {}, false, live ? 'blank' : 'dash');
      registerChainRow(ws, c.r, 5, `chaincomp:${s.name}`);
      c.r += 1;
    }
  }
  totalRow(c, 'TOTAL, all lines', tables.lineTotal, 3, 'chaintot:lines', absent);
  note(c, 'The same totals as by plot: the two tables group the same rows differently, so they must agree.');
  c.r += 1;
}

function totalRow(c: SheetCursor, label: string, t: { landSqm: number; pooled: Pooled; landscapePct?: number; avgUnitSize?: number; slotsPerUnit?: number }, pad = 0, regPrefix?: string, absent: Absent = 'dash'): void {
  const ws = c.ws;
  setLabel(ws.getCell(c.r, 1), label, { bold: true });
  chainCells(ws, c.r, 2 + pad, t.landSqm, t.pooled, { landscapePct: t.landscapePct, unitSize: t.avgUnitSize, slotRatio: t.slotsPerUnit }, true, absent);
  if (regPrefix) registerChainRow(ws, c.r, 2 + pad, regPrefix);
  fillRange(ws, c.r, 1, c.r, LAND_CHAIN_COLS + pad, ARGB.subtotal);
  c.r += 1;
}
