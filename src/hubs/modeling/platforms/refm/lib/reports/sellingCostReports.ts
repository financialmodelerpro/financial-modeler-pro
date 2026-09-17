/**
 * sellingCostReports.ts (2026-09-17)
 *
 * THE SELLING COSTS TABLES, ONE DEFINITION FOR EVERY SURFACE.
 *
 * The Revenue Output screen states every selling cost (what it is, what it is
 * charged on, per line) and then when it is charged, year on year. Those rows
 * were assembled inside the screen, so the workbook had no way to print the
 * same tables without writing a second copy of the grouping. They live here
 * now: the screen renders from this builder, the workbook's Revenue tab prints
 * it, and the PDF can import it.
 *
 * IT RE-DERIVES NOTHING. The amounts are `computeSellingCosts`, the one place a
 * percent-of-revenue cost is multiplied out (the Capex engine reads the same
 * function), and the year-on-year figures are the engine's own
 * `perLinePerPeriod` from `computeAssetCost`, phased by the collections curve
 * exactly as the Capex tab phases them and projected onto the project axis with
 * the shared `phaseLocalToProjectIndex` rule. What this file adds is the
 * PRESENTATION: the plots of one revenue line summed into the line's row, named
 * as Table 5 names it, and the sentences the screen prints under each table.
 *
 * THE ASSETS ARE THE CALLER'S. A selling cost charges on revenue, never on land
 * or area, so the massing a caller resolves cannot move a figure here; the
 * screen passes the assets it already resolved and the workbook the state it
 * holds.
 *
 * Pure. No em dashes in this file.
 */

import { computeAssetCost, computeAssetRevenue, deriveCostStage } from '@/src/core/calculations';
import { computeSellingCosts, type SellingCostRow, type SellingCostsSnapshot } from '@/src/core/calculations/revenue/sellingCosts';
import { assetVisibleLines } from '@/src/core/calculations/selectedBase';
import { collectionsForAsset, phaseLocalToProjectIndex } from '@/src/core/calculations/capexPhasing';
import {
  assetStrategySells,
  type Asset, type CostLine, type CostOverride, type LandAllocationMode, type Parcel, type Phase, type Project, type SubUnit,
} from '../state/module1-types';
import { resolveCatalogId } from '../state/costCatalog';
import type { ProjectRevenueSnapshot } from '../revenue-resolvers';
import { planRevenueLines, lineForAsset } from '../revenueLines';

export interface SellingCostReportInput {
  revenue: ProjectRevenueSnapshot;
  assets: Asset[];
  phases: Phase[];
  costLines: CostLine[];
  costOverrides: CostOverride[];
  parcels: Parcel[];
  landAllocationMode: LandAllocationMode;
  project: Project;
  subUnits: SubUnit[];
  yearLabels: number[];
  projectStartYear: number;
}

/** One row of the basis table: one selling cost on one revenue LINE, its plots added. */
export interface SellingCostDisplayRow {
  key: string;
  lineKey: string;
  /** The revenue line's label (with its phase where it has one), as Table 5 names it. */
  label: string;
  phaseId: string;
  phaseName: string;
  strategy: string;
  lineId: string;
  lineName: string;
  ratePct: number;
  basisLabel: string;
  basisAmount: number;
  amount: number;
  notes: string[];
}

/** One row of the year-on-year schedule, on the project axis. */
export interface SellingCostScheduleRow {
  key: string;
  assetName: string;
  lineName: string;
  values: number[];
  total: number;
}

export interface SellingCostSchedule {
  rows: SellingCostScheduleRow[];
  totals: number[];
  grand: number;
  /** The schedule's lifetime total less the basis table's. Zero, or the two views disagree. */
  drift: number;
  /** The sentence under the schedule stating that check. */
  checkText: (fmt: (n: number) => string) => string;
}

export interface SellingCostReport {
  /** The engine's own rows, per plot. */
  result: SellingCostsSnapshot;
  display: SellingCostDisplayRow[];
  /** The rows that charge zero and say why, in display order. */
  zeroNotes: Array<{ key: string; lineKey: string; lineId: string; label: string; lineName: string; note: string }>;
  /** The sentence under the basis table (counts of lines, revenue lines and plots). */
  footnote: string;
  /** Null when no row has a period series (the screen omits the table). */
  schedule: SellingCostSchedule | null;
}

export const SELLING_COSTS_TITLE = 'Selling Costs';
export const SELLING_COSTS_CAPTION = 'Marketing and commission are percentages of revenue, so they are computed here and the Capex tab reads the result. The rate is still typed on Capex; the basis is the revenue figure named on each row. An asset that is held and operated has no sale, so a selling cost on it is zero and says so.';
export const SELLING_COSTS_YOY_TITLE = 'Selling Costs, Year on Year';
export const SELLING_COSTS_YOY_CAPTION = 'When each selling cost is charged. These are the engine\'s own per-period figures, the same series the Capex schedule renders, so a year here can be read straight against Capex. A selling cost follows sales collections rather than the construction curve, which is why the years differ from the build.';

/** What a selling cost is called: marketing by its stage, commission by its
 *  identity, anything else by its own name. ONE WORDING PER SELLING COST
 *  (2026-09-14, founder: phase 1 read "Marketing Cost" and phase 2 "Marketing"). */
export function sellingCostName(line: CostLine): string {
  if (deriveCostStage(line) === 'marketing' || line.stage === 'marketing' || line.stageOverride === 'marketing') return 'Marketing';
  if (resolveCatalogId(line) === 'commission') return 'Commission';
  return line.name;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Every selling cost in the model, per revenue line, and its year-on-year
 * schedule. Returns null when the model carries no selling cost at all (the
 * screen renders no section).
 */
export function buildSellingCostReport(input: SellingCostReportInput): SellingCostReport | null {
  const {
    revenue, assets, phases, costLines, costOverrides, parcels, landAllocationMode,
    project, subUnits, yearLabels, projectStartYear,
  } = input;

  const result = computeSellingCosts({
    revenue,
    assets: assets.filter((a) => a.visible !== false),
    // THE SHARED VISIBILITY RULE, so a line hidden from an asset on the Capex
    // tab cannot appear here either. Passing the asset's strategy is what scopes
    // a selling cost to the assets that sell.
    linesForAsset: (assetId) => {
      const a = assets.find((x) => x.id === assetId);
      if (!a) return [];
      return assetVisibleLines(costLines, a.phaseId, a.id, a.strategy).map((l) => ({
        id: l.id, name: sellingCostName(l), method: l.method, value: l.value, catalogId: resolveCatalogId(l),
      }));
    },
    // The per-asset override wins exactly as it does in the engine.
    rateFor: (assetId, lineId, lineValue) => {
      const ov = costOverrides.find((o) => o.assetId === assetId && o.lineId === lineId);
      if (ov && ov.overridden !== false && ov.value !== undefined) return ov.value;
      return lineValue;
    },
    sells: (strategy) => assetStrategySells(strategy as Asset['strategy']),
    // Only reached when NO revenue snapshot exists; supplied so the shape is
    // honest rather than a lie by omission.
    fallbackBasis: (assetId) => {
      const a = assets.find((x) => x.id === assetId);
      return a ? computeAssetRevenue(a, subUnits) : 0;
    },
  });
  if (result.rows.length === 0) return null;

  // PER LINE (2026-09-13, founder: "shows the blank Land 2, which is wrong as
  // our asset is merged"). The engine charges a selling cost per asset (plot);
  // the plots of one line share the phase's cost line, so their basis amounts
  // and charges add, and a line reads as one row named as Table 5 names it.
  const lines = planRevenueLines(assets, subUnits, phases, project);
  const phaseName = (id: string): string => phases.find((p) => p.id === id)?.name ?? id;
  const groupOf = (assetId: string): { key: string; label: string } => {
    const line = lineForAsset(lines, assetId);
    return line
      ? { key: line.key, label: line.phaseName ? `${line.label}, ${line.phaseName}` : line.label }
      : { key: assetId, label: assets.find((a) => a.id === assetId)?.name ?? assetId };
  };

  const byKey = new Map<string, SellingCostDisplayRow>();
  for (const r of result.rows) {
    const line = lineForAsset(lines, r.assetId);
    const lineKey = line?.key ?? r.assetId;
    const key = `${lineKey}::${r.lineId}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.basisAmount += r.basis.amount;
      cur.amount += r.amount;
      if (r.note) cur.notes.push(r.note);
      continue;
    }
    byKey.set(key, {
      key, lineKey,
      label: line ? (line.phaseName ? `${line.label}, ${line.phaseName}` : line.label) : r.assetName,
      phaseId: r.phaseId, phaseName: phaseName(r.phaseId), strategy: r.strategy, lineId: r.lineId, lineName: r.lineName,
      ratePct: r.ratePct, basisLabel: r.basis.label, basisAmount: r.basis.amount, amount: r.amount,
      notes: r.note ? [r.note] : [],
    });
  }
  const display = [...byKey.values()];
  const zeroNotes = display
    .filter((r) => r.amount === 0 && r.notes.length > 0)
    .map((r) => ({ key: r.key, lineKey: r.lineKey, lineId: r.lineId, label: r.label, lineName: r.lineName, note: r.notes[0] }));

  const byName = new Set<string>();
  for (const r of result.rows) byName.add(r.catalogId ?? r.lineName);
  const nNames = byName.size;
  const nLines = new Set(display.map((r) => r.lineKey)).size;
  const nPlots = new Set(result.rows.map((r) => r.assetId)).size;
  const footnote = `${nNames} selling cost ${nNames === 1 ? 'line' : 'lines'} across ${plural(nLines, 'revenue line')} (${plural(nPlots, 'plot')}, each line the sum of its plots). These are the same figures the Capex tab charges: one calculation, read by both.`;

  return { result, display, zeroNotes, footnote, schedule: buildSchedule(result.rows, input, groupOf) };
}

/**
 * WHEN each selling cost is charged, per line, on the project axis.
 *
 * THE COLLECTIONS CURVE IS NOT OPTIONAL HERE (2026-08-19). `perLinePerPeriod`
 * is PHASED BY THIS CALL, so omitting the collections series makes this call
 * phase the line differently from the Capex tab. A selling cost carries
 * `phasingSource: 'collections'` and degrades to its own curve without it,
 * which once showed 1,253,606 in a year here against 114,380 on Capex, with
 * the lifetime totals agreeing so the error looked like a rounding quirk.
 */
function buildSchedule(
  rows: SellingCostRow[],
  input: SellingCostReportInput,
  groupOf: (assetId: string) => { key: string; label: string },
): SellingCostSchedule | null {
  const {
    revenue, assets, phases, costLines, costOverrides, parcels, landAllocationMode,
    project, subUnits, yearLabels, projectStartYear,
  } = input;
  const N = yearLabels.length;
  const out: SellingCostScheduleRow[] = [];
  for (const r of rows) {
    const asset = assets.find((a) => a.id === r.assetId);
    const phase = phases.find((p) => p.id === r.phaseId);
    if (!asset || !phase) continue;
    const bd = computeAssetCost({
      asset, project, phase, parcels, assets, subUnits, costLines, costOverrides,
      landAllocationMode, parcelFunding: project.financing?.parcelFunding,
      revenue,
      collectionsPerPeriod: collectionsForAsset(revenue, r.assetId, phase, projectStartYear),
    } as Parameters<typeof computeAssetCost>[0]);
    const local = bd.perLinePerPeriod?.[r.lineId] ?? [];
    const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    const values = new Array<number>(N).fill(0);
    for (let i = 0; i < local.length; i++) {
      const idx = phaseLocalToProjectIndex(i, offset);
      if (idx >= 0 && idx < N) values[idx] += local[i] ?? 0;
    }
    const group = groupOf(r.assetId);
    const key = `${group.key}::${r.lineId}`;
    const existing = out.find((o) => o.key === key);
    if (existing) {
      for (let t = 0; t < N; t++) existing.values[t] += values[t] ?? 0;
      existing.total = existing.values.reduce((x, v) => x + v, 0);
      continue;
    }
    out.push({ key, assetName: group.label, lineName: r.lineName, values, total: values.reduce((x, v) => x + v, 0) });
  }
  if (out.length === 0) return null;
  const totals = new Array<number>(N).fill(0);
  for (const r of out) for (let t = 0; t < N; t++) totals[t] += r.values[t] ?? 0;
  const grand = totals.reduce((x, v) => x + v, 0);
  // The lifetime figures from the basis table, so a mismatch is visible rather
  // than silent. They are the same calculation, so they must agree.
  const lifetimeFromBasis = rows.reduce((x, r) => x + r.amount, 0);
  const drift = grand - lifetimeFromBasis;
  const checkText = (fmt: (n: number) => string): string => (Math.abs(drift) < 0.005
    ? 'The lifetime total matches the basis table above exactly, which is the check that the two views are one calculation.'
    : `The lifetime total differs from the basis table above by ${fmt(drift)}. That should be zero; the two views read the same calculation.`);
  return { rows: out, totals, grand, drift, checkText };
}
