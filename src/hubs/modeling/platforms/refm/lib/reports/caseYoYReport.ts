/**
 * caseYoYReport.ts
 *
 * Shared, pure builder for the Module 6 "Year-on-Year Impact" view. The existing
 * caseComparisonReport shows ENDPOINT KPIs per case; this shows, for each input a
 * scenario actually overrides, the PER-PERIOD output that input drives (debt % ->
 * financing cost, ADR / price -> revenue, opex inflation -> opex, construction /
 * land -> capex, tax rate -> tax), for Management and every scenario, plus the
 * per-period delta of each scenario vs Management.
 *
 * It does NOT recompute or change the engine: it reads the same per-period series
 * the rest of the platform renders from (computeFinancialsSnapshot.pl / financing),
 * resolving each case's merged model with applyOverrides exactly as the comparison
 * report does. A block is emitted only when an override genuinely moves that output
 * in at least one period, so endpoint-only levers (discount rate, exit multiple,
 * perpetuity growth) produce no block.
 */
import { computeFinancialsSnapshot, type ProjectFinancialsSnapshot } from '../financials-resolvers';
import { applyOverrides, baseCaseId, buildOverrides, enumerateOverridableFields } from '../cases/applyOverrides';
import { describeAssumption, assumptionFor, buildGridContext, type AssumptionCategory } from '../cases/assumptionGrid';
import type { HydrateSnapshot } from '../state/module1-store';
import type { ProjectCase } from '../state/module1-types';
import type { CaseComparisonInput } from './caseComparisonReport';

// ── Driven per-period outputs (money). Each reads an existing snapshot series. ──
export interface YoYOutputDef {
  key: string;
  label: string;
  /** Per-period series from the computed snapshot, normalised to axisLength. */
  get: (snap: ProjectFinancialsSnapshot) => number[];
}

const OUTPUT_DEFS: readonly YoYOutputDef[] = [
  { key: 'revenue', label: 'Revenue', get: (s) => s.pl.totalRevenuePerPeriod },
  { key: 'opex', label: 'Operating Expenses', get: (s) => s.pl.totalOpexPerPeriod },
  { key: 'financingCost', label: 'Financing Cost', get: (s) => s.pl.interestExpensePerPeriod },
  { key: 'capex', label: 'Capex', get: (s) => s.financing?.capex?.perPeriod?.exclLandInKind ?? [] },
  { key: 'tax', label: 'Tax', get: (s) => s.pl.taxPerPeriod },
];
const OUTPUT_ORDER = OUTPUT_DEFS.map((o) => o.key);

// Which driven output an overridden input feeds, by assumption category. Tax rate
// (category 'project') is special-cased to the tax output; other project-level
// levers (discount rate / exit multiple / perpetuity growth) are endpoint-only and
// map to nothing, so they never produce a per-period block.
function outputKeyForOverride(path: string, category: AssumptionCategory): string | null {
  if (path === 'project.tax.rate') return 'tax';
  switch (category) {
    case 'revenue': return 'revenue';
    case 'opex': return 'opex';
    case 'financing': return 'financingCost';
    case 'construction': return 'capex';
    default: return null; // 'project' endpoint levers
  }
}

export interface YoYCaseRow {
  id: string;
  name: string;
  role: ProjectCase['role'];
  /** Driven-output value per period (length === yearLabels.length). */
  values: number[];
}
export interface YoYDeltaRow {
  id: string;
  name: string;
  /** Scenario value minus Management value, per period. */
  values: number[];
}
export interface YoYBlock {
  outputKey: string;
  outputLabel: string;
  /** Plain-English labels of the inputs that drive this output and were changed. */
  changedItems: string[];
  /** Management (base) actuals. */
  base: YoYCaseRow;
  /** Each scenario's actuals. */
  scenarios: YoYCaseRow[];
  /** Each scenario's delta vs Management (after the actual rows). */
  deltas: YoYDeltaRow[];
}
export interface CaseYoYReport {
  yearLabels: number[];
  blocks: YoYBlock[];
}

function normalise(series: number[] | undefined, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!series) return out;
  for (let i = 0; i < n; i++) out[i] = Number(series[i] ?? 0);
  return out;
}
const diverges = (a: number[], b: number[]): boolean =>
  a.some((v, i) => Math.abs(v - (b[i] ?? 0)) > 1e-6 * Math.max(1, Math.abs(b[i] ?? 0)));

/**
 * Build the per-period impact report. Returns one block per driven output that a
 * scenario override actually moves, with Management + scenario actuals and the
 * scenario-vs-Management deltas. Empty `blocks` when no override moves a tracked
 * output (the caller shows an empty-state note).
 */
export function buildCaseYoYReport(input: CaseComparisonInput): CaseYoYReport {
  const { baseModel, cases, activeCaseId, liveActiveModel } = input;
  const baseId = baseCaseId(cases);

  // Resolve + compute each case once (same resolution as caseComparisonReport).
  const computed = cases.map((c) => {
    let model: HydrateSnapshot;
    if (c.id === activeCaseId && liveActiveModel) model = liveActiveModel;
    else if (c.role === 'base') model = baseModel;
    else model = applyOverrides(baseModel, c.overrides);
    let snap: ProjectFinancialsSnapshot | null = null;
    try { snap = computeFinancialsSnapshot(model as never); } catch { snap = null; }
    return { c, model, snap };
  });
  const baseEntry = computed.find((e) => e.c.id === baseId) ?? computed[0];
  const baseSnap = baseEntry?.snap ?? null;
  if (!baseSnap) return { yearLabels: [], blocks: [] };
  const n = baseSnap.yearLabels.length;
  const yearLabels = baseSnap.yearLabels.slice();

  // Which outputs are driven by a real override, and the item labels behind them.
  const ctx = buildGridContext(baseModel);
  const fieldByPath = new Map(enumerateOverridableFields(baseModel).map((f) => [f.path, f]));
  const itemsByOutput = new Map<string, Set<string>>();
  for (const { c, model, snap } of computed) {
    if (c.role === 'base' || !snap) continue;
    const overrides = c.id === activeCaseId && liveActiveModel
      ? buildOverrides(baseModel, liveActiveModel)
      : buildOverrides(baseModel, model);
    for (const path of Object.keys(overrides)) {
      const f = fieldByPath.get(path);
      const d = f ? describeAssumption(f, ctx) : assumptionFor(path, undefined, overrides[path], ctx);
      const key = outputKeyForOverride(path, d.category);
      if (!key) continue;
      const set = itemsByOutput.get(key) ?? new Set<string>();
      set.add(d.label);
      itemsByOutput.set(key, set);
    }
  }

  const scenarios = computed.filter((e) => e.c.role !== 'base');
  const blocks: YoYBlock[] = [];
  for (const def of OUTPUT_DEFS) {
    const items = itemsByOutput.get(def.key);
    if (!items || items.size === 0) continue;
    const baseValues = normalise(def.get(baseSnap), n);
    const scenarioRows: YoYCaseRow[] = [];
    const deltaRows: YoYDeltaRow[] = [];
    let anyDivergence = false;
    for (const { c, snap } of scenarios) {
      const values = normalise(snap ? def.get(snap) : undefined, n);
      if (diverges(values, baseValues)) anyDivergence = true;
      scenarioRows.push({ id: c.id, name: c.name, role: c.role, values });
      deltaRows.push({ id: c.id, name: c.name, values: values.map((v, i) => v - baseValues[i]) });
    }
    // Only emit a block when an override actually moves this output per period.
    if (!anyDivergence) continue;
    blocks.push({
      outputKey: def.key,
      outputLabel: def.label,
      changedItems: [...items],
      base: { id: baseEntry.c.id, name: baseEntry.c.name, role: 'base', values: baseValues },
      scenarios: scenarioRows,
      deltas: deltaRows,
    });
  }
  blocks.sort((a, b) => OUTPUT_ORDER.indexOf(a.outputKey) - OUTPUT_ORDER.indexOf(b.outputKey));
  return { yearLabels, blocks };
}
