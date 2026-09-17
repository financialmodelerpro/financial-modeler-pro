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
  ARGB, NUMFMT, BODY_SIZE, fcell, setInput, setFormula, setLabel, setSectionHeader, setColHeader, fillRange,
} from './styles';
import type { computeFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import { computePhaseTimeline, resolveSubUnitAdr, resolveUsefulLifeYears } from '@/src/core/calculations';
import { countryLabel } from '@/src/core/countries';
import { defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { PHASE_STATUS_LABELS, type Asset, type Phase, type SubUnit } from '../state/module1-types';
import {
  buildStandardsView, buildAssetAreaTables, buildSubUnitLines, type ViewCell, type AssetAreaTables,
} from '../../components/modules/_shared/assetInputsView';
import { planRevenueLines, groupRevenueLines, type RevenueLine } from '../revenueLines';
import { planReportLines, lineTitle } from '../reports/lineRows';
import { resolveRowVelocity } from '../revenue-resolvers';
import { buildSaleCohortTermsBlock, saleCohortRuleText } from '../reports/saleCohortReports';
import { OPEX_CATEGORY_LABELS, OPEX_MODE_LABELS, isFixedCostOpexMode, summarizeOpexIndexation } from '../opexLineLabels';
import { resolveReturnsConfig } from '../returns-resolvers';

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

function kv(c: SheetCursor, label: string, value: number | string | undefined, fmt: string, input: boolean, name?: string, noteText?: string): number {
  setLabel(c.ws.getCell(c.r, 1), label);
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
  kv(c, 'Project Start Date', utcDate(p.startDate), '@', true);
  kv(c, 'Project Status', String(p.status ?? 'draft'), '@', true);
  // DISPLAY ONLY on the platform, and the country is its own row below, so the
  // location is printed as typed with no code appended to it.
  kv(c, 'Location', p.location || '-', '@', true);
  kv(c, 'Country', p.country ? countryLabel(p.country) : 'Not set', '@', true);
  c.r += 1;
}

export function emitPhasesSection(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  setSectionHeader(c.ws.getRow(c.r), 'Phases', 8); c.r += 1;
  headers(c, ['Phase Name', 'Phase Start Date', 'Construction (years)', 'Operations (years)', 'Construction End', 'Operations Start', 'Operations End', 'Status']);
  for (const ph of state.phases) {
    const tl = computePhaseTimeline(ph, state.project);
    setLabel(c.ws.getCell(c.r, 1), ph.name);
    setInput(c.ws.getCell(c.r, 2), utcDate(ph.startDate && ph.startDate.length === 10 ? ph.startDate : state.project.startDate), '@');
    setInput(c.ws.getCell(c.r, 3), ph.constructionPeriods ?? 0, NUMFMT.int);
    setInput(c.ws.getCell(c.r, 4), ph.operationsPeriods ?? 0, NUMFMT.int);
    derived(c.ws.getCell(c.r, 5), ph.constructionPeriods === 0 ? 'Operational from start' : utcMonthYear(tl.constructionEnd), '@');
    derived(c.ws.getCell(c.r, 6), utcMonthYear(tl.operationsStart), '@');
    derived(c.ws.getCell(c.r, 7), utcMonthYear(tl.operationsEnd), '@');
    setInput(c.ws.getCell(c.r, 8), phaseStatusLabel(ph.status), '@');
    c.r += 1;
  }
  // The model axis starts at the earliest phase: derived, and the name the
  // period sheets key their year headings to.
  setLabel(c.ws.getCell(c.r, 1), 'Model axis start year (derived)', { bold: true });
  derived(c.ws.getCell(c.r, 2), snap.projectStartYear, NUMFMT.year);
  c.wb.definedNames.add(`${c.sheetName}!$B$${c.r}`, 'ProjectStartYear');
  c.r += 2;
}

// ── MODULE 1 TAB 4: ASSET TYPES AND STANDARDS ───────────────────────────────

export function emitStandardsSection(c: SheetCursor, state: FinancialsResolverState): void {
  const v = buildStandardsView(state);
  const currency = state.project.currency ?? '';
  setSectionHeader(c.ws.getRow(c.r), 'Asset types and values', 10); c.r += 1;
  if (v.types.length === 0) { note(c, 'No asset types in this project.'); c.r += 1; }
  else {
    headers(c, ['Asset type', 'Category', 'Strategy for new assets', 'Avg unit size (sqm)', 'Parking ratio', 'Ratio basis', 'Utilisation %', 'Coverage %', 'FAR', 'Service %']);
    for (const t of v.types) {
      setLabel(c.ws.getCell(c.r, 1), t.label);
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
      c.r += 1;
    }
    note(c, 'A blank value is not set, never zero. Utilisation, coverage, FAR and service are defaults a plot inherits where it states none on Table 2.');
    c.r += 1;
  }
  setSectionHeader(c.ws.getRow(c.r), 'Parking and cost escalation', 3); c.r += 1;
  kv(c, 'Parking area per slot (sqm) for this project', v.slotAreaSqm, NUMFMT.rate, true);
  // BLANK WHEN ABSENT, NEVER 0: an absent rate is "not set" on the platform.
  kv(c, `Construction cost escalation (% a year, from ${v.baseYear})`, v.escalationPct === undefined ? undefined : v.escalationPct / 100, NUMFMT.pct2, true,
    undefined, v.escalationPct === undefined ? 'Not set: rates are not escalated.' : undefined);
  c.r += 1;

  const standardsTable = (title: string, rows: typeof v.construction, construction: boolean): void => {
    setSectionHeader(c.ws.getRow(c.r), title, construction ? 9 : 5); c.r += 1;
    const multiPhase = state.phases.length > 1;
    headers(c, construction
      ? ['Item', 'Applies to', 'Basis', `Rate (${v.baseYear} money)`, 'By phase', 'Price per unit', 'Price per unit reads as', 'Price per sqm', 'Price per sqm reads as']
      : ['Item', 'Basis', `Rate (${v.baseYear} money)`, 'By phase']);
    for (const row of rows) {
      setLabel(c.ws.getCell(c.r, 1), row.label);
      let col = 2;
      if (construction) { setLabel(c.ws.getCell(c.r, col), row.appliesTo); col += 1; }
      setLabel(c.ws.getCell(c.r, col), row.basis); col += 1;
      if (row.rate !== undefined) setInput(c.ws.getCell(c.r, col), row.isPercent ? row.rate / 100 : row.rate, row.isPercent ? NUMFMT.pct2 : NUMFMT.rate);
      col += 1;
      if (multiPhase && row.byPhase.length > 0) {
        setInput(c.ws.getCell(c.r, col), row.byPhase.map((b) => `${b.phaseName} ${row.isPercent ? `${b.rate}%` : b.rate.toLocaleString('en-US')}`).join('; '), '@');
      }
      col += 1;
      if (construction) {
        for (const pr of [row.pricePerUnit, row.pricePerSqm]) {
          if (pr === null) { derived(c.ws.getCell(c.r, col), '-', '@'); col += 2; continue; }
          if (pr === undefined) { col += 2; continue; }
          if (pr.value !== undefined) setInput(c.ws.getCell(c.r, col), pr.value, NUMFMT.rate);
          setLabel(c.ws.getCell(c.r, col + 1), `${pr.unit}${currency ? ` (${currency})` : ''}`);
          col += 2;
        }
      }
      c.r += 1;
    }
    c.r += 1;
  };
  standardsTable('Cost standards: construction cost, sale price and ADR', v.construction, true);
  standardsTable('Cost standards: soft costs', v.soft, false);
  note(c, 'Defaults only: a rate typed on a Capex phase line wins, a phase rate here wins over the row rate in that phase, and a type price applies to every Table 5 row of that type with no price of its own.');
  c.r += 1;
}

// ── MODULE 1 TAB 5, TABLE 1: PLOTS ──────────────────────────────────────────

export function emitPlotsSection(c: SheetCursor, state: FinancialsResolverState): void {
  if (state.parcels.length === 0) return;
  const cur = state.project.currency ?? 'SAR';
  setSectionHeader(c.ws.getRow(c.r), 'Plots, the land', 9); c.r += 1;
  headers(c, ['Plot', 'Phase', 'Area (sqm)', `${cur}/sqm`, 'Cash %', 'In-Kind %', 'Land Value', 'Cash Value', 'In-Kind Value']);
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
    derived(c.ws.getCell(c.r, 7), lv, NUMFMT.money);
    derived(c.ws.getCell(c.r, 8), cv, NUMFMT.money);
    derived(c.ws.getCell(c.r, 9), iv, NUMFMT.money);
    area += a; value += lv; cash += cv; inKind += iv;
    c.r += 1;
  }
  setLabel(c.ws.getCell(c.r, 1), 'Totals', { bold: true });
  derived(c.ws.getCell(c.r, 3), area, NUMFMT.int, true);
  derived(c.ws.getCell(c.r, 4), area > 0 ? value / area : 0, NUMFMT.rate, true);
  derived(c.ws.getCell(c.r, 7), value, NUMFMT.money, true);
  derived(c.ws.getCell(c.r, 8), cash, NUMFMT.money, true);
  derived(c.ws.getCell(c.r, 9), inKind, NUMFMT.money, true);
  fillRange(c.ws, c.r, 1, c.r, 9, ARGB.subtotal);
  c.r += 1;
  note(c, 'Land is allocated by sqm only: each asset draws from its plot on Table 2. The debt / equity split of land cash is on Financing (Land Funding).');
  c.r += 1;
}

// ── MODULE 1 TAB 5, TABLE 2: ASSETS BY PLOT, WHAT YOU ENTER ─────────────────

export function emitAssetEntrySection(c: SheetCursor, tables: AssetAreaTables): void {
  setSectionHeader(c.ws.getRow(c.r), 'Assets by plot, what you enter', 9); c.r += 1;
  headers(c, ['Type', 'Strategy', 'Plot Area (sqm)', 'Land Utilisation %', 'Ground Coverage %', 'FAR', 'Max Floors', 'Retail % (ground floor)', 'Service %']);
  let inherited = false, whole = false;
  for (const g of tables.plots) {
    band(c, `${g.plotLabel}${g.phaseName ? `, ${g.phaseName}` : ''}. ${g.check}`, 9);
    if (g.entries.length === 0) { note(c, 'No assets drawing from this plot yet.'); continue; }
    for (const e of g.entries) {
      setLabel(c.ws.getCell(c.r, 1), e.typeLabel, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), e.strategy, '@');
      viewCell(c.ws.getCell(c.r, 3), e.plotAreaSqm, NUMFMT.int);
      viewCell(c.ws.getCell(c.r, 4), e.utilisationPct, NUMFMT.pct2, 100);
      viewCell(c.ws.getCell(c.r, 5), e.coveragePct, NUMFMT.pct2, 100);
      viewCell(c.ws.getCell(c.r, 6), e.far, NUMFMT.rate);
      viewCell(c.ws.getCell(c.r, 7), e.maxFloors, NUMFMT.int);
      viewCell(c.ws.getCell(c.r, 8), e.retailPct, NUMFMT.pct2, 100);
      viewCell(c.ws.getCell(c.r, 9), e.servicePct, NUMFMT.pct2, 100);
      if ([e.utilisationPct, e.coveragePct, e.far, e.servicePct].some((x) => x.note === 'from the type')) inherited = true;
      if (e.plotAreaSqm.note) whole = true;
      c.r += 1;
    }
  }
  if (inherited) note(c, 'Unshaded coverage, FAR, utilisation or service figures are inherited from the asset type (Asset types and values above); the plot states none.');
  if (whole) note(c, 'An unshaded Plot Area is a blank on the platform: the asset draws its whole plot.');
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
  setSectionHeader(c.ws.getRow(c.r), 'Sub-units, under the merged line', 10); c.r += 1;
  headers(c, ['Sub-unit', 'Category', 'NSA Share %', 'Area (sqm)', 'Average Unit Size (sqm)', 'Units or Keys', `Rate (${cur})`, 'Rate Basis', 'Rate, other basis', 'Other basis']);
  for (const line of lines) {
    band(c, `${line.title}. ${line.check}`, 10);
    for (const u of line.rows) {
      setLabel(c.ws.getCell(c.r, 1), u.plot ? `${u.name} (${u.plot})` : u.name, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), u.category, '@');
      viewCell(c.ws.getCell(c.r, 3), u.sharePct, NUMFMT.pct2, 100);
      viewCell(c.ws.getCell(c.r, 4), u.areaSqm, NUMFMT.int);
      if (u.unitSizeSqm !== undefined) setInput(c.ws.getCell(c.r, 5), u.unitSizeSqm, NUMFMT.rate);
      viewCell(c.ws.getCell(c.r, 6), u.units, NUMFMT.int);
      setInput(c.ws.getCell(c.r, 7), u.rate, NUMFMT.rate);
      setLabel(c.ws.getCell(c.r, 8), u.rateBasis);
      if (u.otherRate) {
        if (u.otherRate.value !== undefined) setInput(c.ws.getCell(c.r, 9), u.otherRate.value, NUMFMT.rate);
        setLabel(c.ws.getCell(c.r, 10), u.otherRate.basis);
      } else if (u.otherNote) setLabel(c.ws.getCell(c.r, 10), u.otherNote);
      c.r += 1;
    }
    setLabel(c.ws.getCell(c.r, 1), line.title === 'Not on a line' ? 'Total, not on a line' : 'Line total', { bold: true, indent: 1 });
    if (line.nsaSqm > 0) derived(c.ws.getCell(c.r, 3), line.areaSqm / line.nsaSqm, NUMFMT.pct2, true);
    derived(c.ws.getCell(c.r, 4), line.areaSqm, NUMFMT.int, true);
    c.r += 1;
  }
  note(c, 'Share and area are one pair: whichever is shaded is the statement and the other follows the line\'s NSA. In count mode the count is typed and the area follows.');
  c.r += 1;
}

// ── DEPRECIATION INPUTS (Module 4, Fixed Assets) ────────────────────────────

export function emitDepreciationSection(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  const assets = state.assets;
  const lines = planReportLines({ assets, phases: state.phases, parcels: state.parcels }, (a) => snap.fixedAssets.byAsset.has(a.id));
  if (lines.length === 0) return;
  setSectionHeader(c.ws.getRow(c.r), 'Depreciation Inputs (all assets)', 7); c.r += 1;
  headers(c, ['Asset', 'Strategy', 'Method', 'Useful Life (yrs)', 'Rate', 'Opening Land', 'Opening Bldg NBV']);
  for (const line of lines) {
    const host = assets.find((a) => a.id === line.assetIds[0]);
    if (!host) continue;
    const rows = line.assetIds.map((id) => snap.fixedAssets.byAsset.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const lifeEffective = rows[0]?.usefulLifeYears ?? resolveUsefulLifeYears(host);
    const lifeStored = host.usefulLifeYears;
    const isRB = host.depreciationMethod === 'reducing_balance';
    setLabel(c.ws.getCell(c.r, 1), lineTitle(line, { assets, phases: state.phases, parcels: state.parcels }));
    setLabel(c.ws.getCell(c.r, 2), host.strategy === 'Operate' ? (host.isCompanion ? 'Hospitality (Manage)' : 'Hospitality') : host.strategy === 'Lease' ? 'Retail / Lease' : String(host.strategy));
    setInput(c.ws.getCell(c.r, 3), isRB ? 'Reducing Balance (WDV)' : 'Straight Line (SL)', '@');
    if (lifeStored !== undefined && lifeStored > 0) setInput(c.ws.getCell(c.r, 4), lifeStored, NUMFMT.int);
    else derived(c.ws.getCell(c.r, 4), lifeEffective, NUMFMT.int);
    if (isRB) {
      if (host.depreciationRate !== undefined) setInput(c.ws.getCell(c.r, 5), host.depreciationRate, NUMFMT.pct2);
      else derived(c.ws.getCell(c.r, 5), lifeEffective > 0 ? 2 / lifeEffective : 0, NUMFMT.pct2);
    } else derived(c.ws.getCell(c.r, 5), lifeEffective > 0 ? 1 / lifeEffective : 0, NUMFMT.pct2);
    const openingLand = rows.reduce((s, x) => s + (x.land.openingAtAxisStart ?? 0), 0);
    const openingBldg = rows.reduce((s, x) => s + (x.depreciable.openingNBVPerPeriod[0] ?? 0), 0);
    derived(c.ws.getCell(c.r, 6), openingLand > 0 ? openingLand : '-', openingLand > 0 ? NUMFMT.money : '@');
    derived(c.ws.getCell(c.r, 7), openingBldg > 0 ? openingBldg : '-', openingBldg > 0 ? NUMFMT.money : '@');
    c.r += 1;
  }
  note(c, 'An unshaded useful life is blank on the platform and inherits the asset category default. Straight line rate = 1 / life; a blank reducing balance rate = 2 / life.');
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
  kv(c, `${zakat ? 'Zakat' : 'Tax'} Rate (%)`, p.tax?.rate ?? 0, NUMFMT.pct2, true, 'TaxRate');
  kv(c, `${zakat ? 'Zakat' : 'Tax'} on the disposal gain`, p.tax?.applyToDisposalGain === true ? 'Charge it on the gain at exit' : 'Not charged on the gain at exit', '@', true);
  kv(c, `${zakat ? 'Zakat' : 'Tax'} payment (days)`, p.tax?.paymentDays ?? 0, NUMFMT.int, true);
  kv(c, 'Statutory reserve transfer (% of PAT)', p.statutoryReserve?.transferRate ?? 0, NUMFMT.pct, true);
  kv(c, 'Statutory reserve cap (% share capital)', p.statutoryReserve?.capOfShareCapital ?? 0, NUMFMT.pct, true);
  kv(c, 'Share capital (explicit, 0 = auto)', p.shareCapital ?? 0, NUMFMT.money, true);
  kv(c, 'Operating receivables, DSO (days)', p.operatingAr?.dsoDays ?? 0, NUMFMT.int, true, 'DsoDays');
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
  kv(c, 'Discount Rate (%)', cfg.discountRate, NUMFMT.pct, stored.discountRate !== undefined, 'DiscountRate');
  kv(c, 'Exit Year', snap.projectStartYear + cfg.exitYearOffset, NUMFMT.year, stored.exitYearOffset !== undefined, 'ExitYear');
  kv(c, 'Terminal Value Method', TERMINAL_METHOD_LABELS[cfg.terminalMethod] ?? cfg.terminalMethod, '@', stored.terminalMethod !== undefined);
  if (cfg.terminalMethod === 'exit_multiple') kv(c, 'Exit Multiple (x stabilised NOI)', cfg.exitMultiple, NUMFMT.mult, stored.exitMultiple !== undefined, 'ExitMultiple');
  if (cfg.terminalMethod === 'perpetuity' || cfg.terminalMethod === 'cap_rate') kv(c, 'Growth g (%)', cfg.perpetuityGrowth, NUMFMT.pct2, stored.perpetuityGrowth !== undefined, 'PerpetuityGrowth');
  if (cfg.terminalMethod !== 'none') {
    kv(c, 'Terminal value basis', cfg.terminalValueBasis === 'exit_year' ? 'Exit year' : 'Year before exit', '@', stored.terminalValueBasis !== undefined);
  }
  if (cfg.terminalMethod === 'cap_rate') {
    const manual = cfg.capRateSource === 'manual';
    kv(c, 'Exit Cap Rate (%)', manual ? cfg.capRate : cfg.capRateDerived, NUMFMT.pct2, manual, 'CapRate',
      manual ? `Set by you (WACC less growth would be ${(cfg.capRateDerived * 100).toFixed(2)}%).` : 'WACC less growth, derived.');
  }
  if (cfg.terminalMethod !== 'none') {
    kv(c, 'Terminal metric', cfg.applyGrowthToTerminal ? 'Grown by (1 + g)' : 'Exit year as is', '@', stored.applyGrowthToTerminal !== undefined);
  }
  c.r += 1;
}

// ── MODULE 2: REVENUE INPUTS, PER LINE ──────────────────────────────────────

const INDEX_METHOD_LABELS: Record<string, string> = {
  none: 'None', single_rate: 'Flat', yoy_compound: 'YoY Compound', yoy_per_period: 'Per-Year', step: 'Step',
};

interface LineWindow { phaseOffset: number; construction: number[]; operations: number[]; handoverIdx: number; defaultOpsIdx: number; opsIdx: number }

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
    phaseOffset,
    construction: cp > 0 ? range(cStart, handoverIdx) : [],
    operations: op > 0 ? range(opsIdx, opsEnd) : [],
    handoverIdx, defaultOpsIdx, opsIdx,
  };
}

/** A strip of per-year values over a window, the years as headers. */
function yearStrip(c: SheetCursor, label: string, years: number[], values: (idx: number) => number | undefined, fmt: string, input: boolean, snap: Snap, headerLabel = 'Year'): void {
  if (years.length === 0) return;
  setColHeader(c.ws.getCell(c.r, 1), headerLabel, 'left');
  years.forEach((idx, i) => setColHeader(c.ws.getCell(c.r, 2 + i), snap.projectStartYear + idx, 'right'));
  c.r += 1;
  setLabel(c.ws.getCell(c.r, 1), label, { indent: 1 });
  years.forEach((idx, i) => {
    const v = values(idx) ?? 0;
    if (input) setInput(c.ws.getCell(c.r, 2 + i), v, fmt); else derived(c.ws.getCell(c.r, 2 + i), v, fmt);
  });
  c.r += 1;
}

function indexationRows(c: SheetCursor, title: string, ix: { method?: string; rate?: number; startYear?: number; steps?: Array<{ year: number; factor: number }> } | undefined, snap: Snap): void {
  const method = ix?.method ?? 'none';
  kv(c, `${title}: method`, INDEX_METHOD_LABELS[method] ?? method, '@', true);
  if (method === 'yoy_compound' || method === 'single_rate') {
    kv(c, `${title}: rate %`, ix?.rate ?? 0, NUMFMT.pct2, true);
    kv(c, `${title}: start year`, snap.projectStartYear + (ix?.startYear ?? 0), NUMFMT.year, ix?.startYear !== undefined);
  }
  if (method === 'step') {
    for (const s of ix?.steps ?? []) kv(c, `${title}: step from ${s.year}`, s.factor, NUMFMT.rate, true);
  }
}

function ancillaryRows(c: SheetCursor, title: string, cfg: { mode?: string; percentOfRooms?: number | number[]; ratePerGuest?: number | number[]; fixedAmountPerPeriod?: number | number[] } | undefined): void {
  const scalar = (v: number | number[] | undefined): number => (v == null ? 0 : typeof v === 'number' ? v : (v[0] ?? 0));
  const mode = cfg?.mode ?? 'percent_of_rooms';
  kv(c, `${title}: driver`, mode === 'percent_of_rooms' ? '% of Rooms' : mode === 'per_guest' ? 'Per Guest' : 'Baseline + Growth', '@', true);
  if (mode === 'percent_of_rooms') kv(c, `${title}: % of rooms revenue`, scalar(cfg?.percentOfRooms), NUMFMT.pct2, true);
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
      else if (line.form === 'operate') emitOperateLine(c, line, w, snap);
      else emitLeaseLine(c, line, w, snap);
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
  const velocityRows: Array<{ label: string; pre: (i: number) => number | undefined; post: (i: number) => number | undefined }> = [];
  if (sell.velocityDefault && units.length !== 1) {
    velocityRows.push({ label: 'All sub-units (line pace)', pre: axisOf(sell.velocityDefault.preSalesVelocityByPhase, undefined), post: axisOf(sell.velocityDefault.postSalesVelocityByPhase, undefined) });
  } else {
    for (const u of units) {
      const v = resolveRowVelocity(sell, u.id);
      velocityRows.push({
        label: `${u.name || 'sub-unit'}${v.source === 'default' ? ' (line pace)' : v.source === 'none' ? ' (no velocity: sells nothing)' : ''}`,
        pre: axisOf(v.pre, v.preLegacy), post: axisOf(v.post, v.postLegacy),
      });
    }
  }
  if (w.construction.length > 0) {
    for (const [i, row] of velocityRows.entries()) {
      yearStrip(c, row.label, w.construction, row.pre, NUMFMT.pct, true, snap, i === 0 ? `Pre-Sales velocity, ${snap.projectStartYear + w.construction[0]} to ${snap.projectStartYear + w.construction[w.construction.length - 1]}` : '');
    }
  }
  if (w.operations.length > 0) {
    for (const [i, row] of velocityRows.entries()) {
      yearStrip(c, row.label, w.operations, row.post, NUMFMT.pct, true, snap, i === 0 ? `Sales During Operation, ${snap.projectStartYear + w.operations[0]} to ${snap.projectStartYear + w.operations[w.operations.length - 1]}` : '');
    }
  }
  indexationRows(c, 'Price Indexation', sell.indexation, snap);
  const rec = sell.recognitionProfile ?? { method: 'point_in_time' as const, pointInTimeYear: 'handover' as const };
  kv(c, 'Revenue Recognition', rec.method === 'over_time' ? 'Over-Time' : 'Point-in-Time', '@', true);
  if (rec.method !== 'over_time') {
    const pit = rec.pointInTimeYear ?? 'handover';
    kv(c, 'Recognition year', pit === 'sale_year' ? 'At sale year' : pit === 'custom' ? `At custom year (${rec.pointInTimeCustomYear ?? snap.projectStartYear + w.handoverIdx})` : `At handover (${snap.projectStartYear + w.handoverIdx})`, '@', true);
  } else {
    const pct = rec.percentagesByPhase ?? rec.percentages ?? [];
    let n = 0; for (let i = 0; i < pct.length; i++) if ((pct[i] ?? 0) !== 0) n = i + 1;
    if (n > 0) yearStrip(c, 'Recognition %', Array.from({ length: n }, (_, i) => i), (i) => pct[i], NUMFMT.pct, true, { ...snap, projectStartYear: 1 } as Snap, 'Year from sale');
  }
  // SALE COHORT TERMS PRINT ON EVERY SELL LINE, handover recognition included:
  // they drive collections whatever the recognition method is.
  const block = buildSaleCohortTermsBlock(host, phase, Number(snap.yearLabels[0]) || 0);
  if (block && block.downpayments.length) {
    setColHeader(c.ws.getCell(c.r, 1), 'Sale cohort terms', 'left');
    block.downpayments.forEach((d, i) => setColHeader(c.ws.getCell(c.r, 2 + i), String(d.year), 'right'));
    c.r += 1;
    setLabel(c.ws.getCell(c.r, 1), 'Downpayment % by sale year', { indent: 1 });
    block.downpayments.forEach((d, i) => setInput(c.ws.getCell(c.r, 2 + i), d.value, NUMFMT.pct));
    c.r += 1;
    kv(c, 'Max instalment years after sale', block.instalmentYears, NUMFMT.int, true);
    kv(c, 'Instalments', block.stopAtHandover ? 'Stop at handover' : 'May run past handover', '@', true);
    note(c, saleCohortRuleText(block));
  }
}

function emitOperateLine(c: SheetCursor, line: RevenueLine, w: LineWindow, snap: Snap): void {
  const op = line.host.revenue?.operate;
  // THE ADR THE ENGINE SELLS AT: the first positive of the row's stored ADR and
  // its Table 5 price (resolveSubUnitAdr). A stored 0 never shadows a price.
  for (const u of line.subUnits) kv(c, `Starting ADR, ${u.name || 'sub-unit'} (per room per night, Table 5)`, resolveSubUnitAdr(u), NUMFMT.rate, false);
  indexationRows(c, 'ADR indexation', op?.adrIndexation, snap);
  kv(c, 'Operations start year', snap.projectStartYear + w.opsIdx, NUMFMT.year, op?.operationsStartYearOverride != null,
    undefined, `Default (after handover): ${snap.projectStartYear + w.defaultOpsIdx}`);
  yearStrip(c, 'Occupancy', w.operations, (idx) => op?.occupancyPerPeriod?.[idx], NUMFMT.pct, true, snap, 'Occupancy ramp');
  kv(c, 'Average guests per occupied room night', op?.guestsPerOccupiedRoom ?? 1.5, NUMFMT.rate, op?.guestsPerOccupiedRoom !== undefined);
  ancillaryRows(c, 'F&B Revenue', op?.fb);
  ancillaryRows(c, 'Other Revenue', op?.otherRevenue);
  kv(c, 'Accounts Receivable Days', op?.dso ?? 30, NUMFMT.int, op?.dso !== undefined);
}

function emitLeaseLine(c: SheetCursor, line: RevenueLine, w: LineWindow, snap: Snap): void {
  const lease = line.host.revenue?.lease;
  // THE RENT THE ENGINE LETS AT: the Table 5 price, else the line's stored base rate.
  for (const u of line.subUnits) {
    kv(c, `Rent, ${u.name || 'sub-unit'} (per sqm per year, Table 5)`, (u.unitPrice ?? 0) > 0 ? (u.unitPrice as number) : (lease?.baseRate ?? 0), NUMFMT.rate, false);
  }
  indexationRows(c, 'Rent indexation', lease?.rentIndexation, snap);
  kv(c, 'Operations start year', snap.projectStartYear + w.opsIdx, NUMFMT.year, lease?.operationsStartYearOverride != null,
    undefined, `Default (after handover): ${snap.projectStartYear + w.defaultOpsIdx}`);
  yearStrip(c, 'Occupancy', w.operations, (idx) => lease?.occupancyPerPeriod?.[idx], NUMFMT.pct, true, snap, 'Occupancy ramp');
  kv(c, 'Accounts Receivable Days', lease?.arDays ?? 30, NUMFMT.int, lease?.arDays !== undefined);
}

export function emitEscrowInputs(c: SheetCursor, state: FinancialsResolverState, snap: Snap): void {
  const p = state.project;
  const assets = state.assets;
  setSectionHeader(c.ws.getRow(c.r), 'Escrow Inputs', 7); c.r += 1;
  kv(c, 'Project Held % (regulator-locked)', p.escrow?.heldPct ?? 0, NUMFMT.pct2, true);
  kv(c, 'Default Held Until Year (optional)', p.escrow?.defaultHeldUntilYear ?? 'auto: handover year', p.escrow?.defaultHeldUntilYear !== undefined ? NUMFMT.year : '@', p.escrow?.defaultHeldUntilYear !== undefined);
  kv(c, 'Default Release Year (optional)', p.escrow?.defaultReleaseYear ?? 'auto: handover year + 1', p.escrow?.defaultReleaseYear !== undefined ? NUMFMT.year : '@', p.escrow?.defaultReleaseYear !== undefined);
  const lines = planReportLines({ assets, phases: state.phases, parcels: state.parcels }, (a) => snap.escrow.byAsset.has(a.id));
  if (lines.length > 0) {
    headers(c, ['Asset', 'Effective Held %', 'Held % Override', 'Effective Held Until', 'Held Until Override', 'Effective Release Year', 'Release Year Override']);
    for (const line of lines) {
      const host = snap.escrow.byAsset.get(line.assetIds[0]);
      const a = assets.find((x) => x.id === line.assetIds[0]);
      const esc = a?.revenue?.sell?.escrow;
      setLabel(c.ws.getCell(c.r, 1), lineTitle(line, { assets, phases: state.phases, parcels: state.parcels }));
      derived(c.ws.getCell(c.r, 2), host?.effectiveHeldPct ?? 0, NUMFMT.pct2);
      if (esc?.heldPctOverride !== undefined) setInput(c.ws.getCell(c.r, 3), esc.heldPctOverride, NUMFMT.pct2);
      derived(c.ws.getCell(c.r, 4), host?.effectiveHeldUntilYear, NUMFMT.year);
      if (esc?.heldUntilYearOverride !== undefined) setInput(c.ws.getCell(c.r, 5), esc.heldUntilYearOverride, NUMFMT.year);
      derived(c.ws.getCell(c.r, 6), host?.effectiveReleaseYear, NUMFMT.year);
      if (esc?.releaseYearOverride !== undefined) setInput(c.ws.getCell(c.r, 7), esc.releaseYearOverride, NUMFMT.year);
      c.r += 1;
    }
  }
  c.r += 1;
}

// ── MODULE 3: OPEX INPUTS, PER LINE ─────────────────────────────────────────

const opexValFmt = (mode: string): string => mode === 'fixed_baseline' ? NUMFMT.money : mode.startsWith('per_') ? NUMFMT.rate : NUMFMT.pct;

export function emitOpexInputs(c: SheetCursor, state: FinancialsResolverState): void {
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
    const all = host.opex?.lines ?? [];
    if (all.length === 0) { note(c, 'No opex lines on this line.'); c.r += 1; continue; }
    headers(c, ['Line item', 'Category', 'Mode', 'Rate', 'Value', 'Inflation', 'On']);
    for (const l of all) {
      const fixed = isFixedCostOpexMode(l.mode);
      const yoy = l.rateMode === 'yoy';
      setLabel(c.ws.getCell(c.r, 1), l.name, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), OPEX_CATEGORY_LABELS[l.category] ?? String(l.category), '@');
      setInput(c.ws.getCell(c.r, 3), OPEX_MODE_LABELS[l.mode] ?? String(l.mode), '@');
      setInput(c.ws.getCell(c.r, 4), yoy ? 'YoY' : 'Single', '@');
      setInput(c.ws.getCell(c.r, 5), l.value, opexValFmt(String(l.mode)));
      if (!fixed) derived(c.ws.getCell(c.r, 6), 'auto via revenue', '@');
      else if (yoy) derived(c.ws.getCell(c.r, 6), 'supplied by YoY rates', '@');
      else if (l.useAssetDefault !== false) derived(c.ws.getCell(c.r, 6), `Inherits: ${summarizeOpexIndexation(host.opex?.defaultIndexation)}`, '@');
      else setInput(c.ws.getCell(c.r, 6), summarizeOpexIndexation(l.indexation), '@');
      setInput(c.ws.getCell(c.r, 7), l.disabled ? 'Off' : 'On', '@');
      c.r += 1;
    }
    c.r += 1;
  }
  const hq = p.hqOpex?.lines ?? [];
  if (hq.length > 0) {
    setSectionHeader(c.ws.getRow(c.r), 'HQ / Corporate opex lines', 6); c.r += 1;
    headers(c, ['Line item', 'Category', 'Mode', 'Value', 'Inflation', 'On']);
    for (const l of hq) {
      setLabel(c.ws.getCell(c.r, 1), l.name, { indent: 1 });
      setInput(c.ws.getCell(c.r, 2), OPEX_CATEGORY_LABELS[l.category] ?? String(l.category), '@');
      setInput(c.ws.getCell(c.r, 3), OPEX_MODE_LABELS[l.mode] ?? String(l.mode), '@');
      setInput(c.ws.getCell(c.r, 4), l.value, opexValFmt(String(l.mode)));
      setInput(c.ws.getCell(c.r, 5), summarizeOpexIndexation(l.indexation), '@');
      setInput(c.ws.getCell(c.r, 6), l.disabled ? 'Off' : 'On', '@');
      c.r += 1;
    }
    c.r += 1;
  }
  if (ordered.length === 0 && hq.length === 0) { note(c, 'No operating lines: opex applies to Operate and Lease lines.'); c.r += 1; }
  setSectionHeader(c.ws.getRow(c.r), 'Accounts Payable (DPO)', 3); c.r += 1;
  kv(c, 'Project Default DPO (days)', p.opexAp?.defaultApDays ?? 0, NUMFMT.int, true, 'DpoDays', 'Blank or 0 = pay on incurrence (no AP).');
  kv(c, 'Days basis', p.opexAp?.daysPerYear ?? 365, NUMFMT.int, p.opexAp?.daysPerYear !== undefined);
  if (ordered.length > 0) {
    headers(c, ['Asset', 'Effective DPO (days)', 'DPO Override']);
    for (const { line, host } of ordered) {
      const override = host.opex?.apDaysOverride;
      setLabel(c.ws.getCell(c.r, 1), lineTitle(line, ctx));
      derived(c.ws.getCell(c.r, 2), override !== undefined && override >= 0 ? override : projectDpo, NUMFMT.int);
      if (override !== undefined) setInput(c.ws.getCell(c.r, 3), override, NUMFMT.int);
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
function chainCells(ws: ExcelJS.Worksheet, r: number, startCol: number, landSqm: number, g: Pooled, ratios: { landscapePct?: number; unitSize?: number; slotRatio?: number }, bold = false): void {
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
    if (v === undefined) { cell.value = '-'; cell.alignment = { horizontal: 'right' }; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; return; }
    derived(cell, v, fmt, bold);
  });
}

export function emitLandTables(c: SheetCursor, tables: AssetAreaTables): void {
  const ws = c.ws;
  // TABLE 3, per plot: the chain run on each plot, never pooled.
  setSectionHeader(ws.getRow(c.r), 'Derived areas by plot (land x utilisation x coverage / FAR)', LAND_CHAIN_COLS); c.r += 1;
  headers(c, ['Asset', ...CHAIN_HEADS]);
  for (const g of tables.plots) {
    band(c, `${g.plotLabel}${g.phaseName ? `, ${g.phaseName}` : ''}`, LAND_CHAIN_COLS);
    for (const row of g.chains) {
      setLabel(ws.getCell(c.r, 1), row.label, { indent: 1 });
      const ch = row.chain as unknown as Pooled;
      chainCells(ws, c.r, 2, row.landSqm, ch, {
        landscapePct: row.chain.landscapePct === undefined ? undefined : row.chain.landscapePct / 100,
        unitSize: row.unitSizeSqm,
        slotRatio: row.ratio,
      });
      c.r += 1;
    }
    for (const piece of g.retailPieces) {
      setLabel(ws.getCell(c.r, 1), `${piece.name} (land carved from this plot's hosts)`, { indent: 1 });
      derived(ws.getCell(c.r, 2), piece.sqm, NUMFMT.int);
      for (let col = 3; col <= LAND_CHAIN_COLS; col++) { const cell = ws.getCell(c.r, col); cell.value = '-'; cell.alignment = { horizontal: 'right' }; }
      c.r += 1;
    }
  }
  totalRow(c, 'TOTAL, all plots', tables.plotTotal);
  note(c, `Plots hold ${Math.round(tables.parcelsTotalSqm).toLocaleString('en-US')} sqm; the Plot Area column totals ${Math.round(tables.plotTotal.landSqm).toLocaleString('en-US')} sqm including the land the retail strips carved from their hosts. A dash means a step could not be derived, which is not zero.`);
  c.r += 1;

  // TABLE 4, per line: the same rows regrouped, areas added, ratios from the row's own sums.
  const lineCols = 3 + LAND_CHAIN_COLS;
  setSectionHeader(ws.getRow(c.r), 'Merged by line', lineCols); c.r += 1;
  headers(c, ['Type', 'Phase', 'Strategy', 'Plots', ...CHAIN_HEADS]);
  for (const l of tables.lines) {
    setLabel(ws.getCell(c.r, 1), l.typeLabel, { indent: 1 });
    setLabel(ws.getCell(c.r, 2), l.phaseName);
    setLabel(ws.getCell(c.r, 3), l.strategy);
    derived(ws.getCell(c.r, 4), l.plots, NUMFMT.int);
    chainCells(ws, c.r, 5, l.landSqm, l.pooled, { landscapePct: l.landscapePct, unitSize: l.avgUnitSize, slotRatio: l.slotsPerUnit });
    c.r += 1;
  }
  if (tables.companions.length > 0) {
    note(c, 'Retail companions, held on Lease. Their floor area is already inside the Retail GFA above; their land is the land their hosts gave up, so nothing is counted twice.');
    for (const s of tables.companions) {
      setLabel(ws.getCell(c.r, 1), s.name, { indent: 1 });
      setLabel(ws.getCell(c.r, 2), s.phaseName);
      setLabel(ws.getCell(c.r, 3), s.strategy);
      derived(ws.getCell(c.r, 4), s.hosts, NUMFMT.int);
      const g: Pooled = { retailGfaSqm: s.retailGfaSqm, totalGfaSqm: s.retailGfaSqm, netSaleableSqm: s.retailGfaSqm, retailParkingSlots: s.slots, retailParkingAreaSqm: s.parkingAreaSqm, totalParkingAreaSqm: s.parkingAreaSqm, totalBuaSqm: s.totalBuaSqm };
      chainCells(ws, c.r, 5, s.landSqm, g, {});
      c.r += 1;
    }
  }
  totalRow(c, 'TOTAL, all lines', tables.lineTotal, 3);
  note(c, 'The same totals as by plot: the two tables group the same rows differently, so they must agree.');
  c.r += 1;
}

function totalRow(c: SheetCursor, label: string, t: { landSqm: number; pooled: Pooled; landscapePct?: number; avgUnitSize?: number; slotsPerUnit?: number }, pad = 0): void {
  const ws = c.ws;
  setLabel(ws.getCell(c.r, 1), label, { bold: true });
  chainCells(ws, c.r, 2 + pad, t.landSqm, t.pooled, { landscapePct: t.landscapePct, unitSize: t.avgUnitSize, slotRatio: t.slotsPerUnit }, true);
  fillRange(ws, c.r, 1, c.r, LAND_CHAIN_COLS + pad, ARGB.subtotal);
  c.r += 1;
}
