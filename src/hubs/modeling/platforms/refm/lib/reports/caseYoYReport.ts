/**
 * caseYoYReport.ts
 *
 * Shared, pure builder for the Module 6 "Year-on-Year Impact" view. One block per
 * input a scenario actually changes. Each block shows:
 *   - the changed INPUT's value per case (so it is explicit what changed and to
 *     what value, e.g. Debt %: 100 / 90 / 100);
 *   - every per-period OUTPUT that input drives, Management + each scenario, with
 *     each scenario's delta vs Management after the actuals. A debt-type change
 *     shows debt drawdown AND financing cost (interest + IDC) AND debt closing
 *     balance; a revenue change shows revenue; etc. Only outputs the input
 *     actually moves are shown.
 *
 * Layout helpers carried for the UI to match the other modules:
 *   - kind 'flow' (drawdown, financing cost, revenue, opex, capex, tax) is summed
 *     in the Total column; kind 'stock' (debt closing balance) leaves Total BLANK
 *     (summing a running balance is wrong) and carries a prior (inception) value.
 *   - priorYearLabel = yearLabels[0] - 1 (the inception column the platform tables
 *     lead with, e.g. 2025), so the first column is 2025 like the other modules.
 *
 * No engine change: every series is read from the computed snapshot
 * (computeFinancialsSnapshot.pl / financing), resolving each case's merged model
 * with applyOverrides exactly as caseComparisonReport does.
 */
import { computeFinancialsSnapshot, type ProjectFinancialsSnapshot } from '../financials-resolvers';
import { applyOverrides, baseCaseId, buildOverrides, enumerateOverridableFields, getByPath } from '../cases/applyOverrides';
import { describeAssumption, assumptionFor, buildGridContext, type AssumptionCategory, type AssumptionFormat } from '../cases/assumptionGrid';
import type { HydrateSnapshot } from '../state/module1-store';
import type { ProjectCase } from '../state/module1-types';
import type { CaseComparisonInput } from './caseComparisonReport';

export type YoYOutputKind = 'flow' | 'stock';

// Internal definition of a driven output: a per-period series getter + an
// inception (prior-year) value getter + flow/stock kind.
interface OutputDef {
  key: string;
  label: string;
  kind: YoYOutputKind;
  get: (s: ProjectFinancialsSnapshot) => number[];
  prior: (s: ProjectFinancialsSnapshot) => number;
}

export interface YoYSeriesRow {
  id: string;
  name: string;
  role: ProjectCase['role'];
  /** Per-period values, length === yearLabels.length. */
  values: number[];
  /** Inception (prior-year) value: 0 for flows, opening balance for stocks. */
  prior: number;
}
export interface YoYDeltaRow {
  id: string;
  name: string;
  values: number[];
  prior: number;
}
export interface YoYOutput {
  key: string;
  label: string;
  kind: YoYOutputKind;
  base: YoYSeriesRow;
  scenarios: YoYSeriesRow[];
  deltas: YoYDeltaRow[];
}
export interface YoYInputValue {
  id: string;
  name: string;
  role: ProjectCase['role'];
  /** The input's actual value in this case's merged model. */
  value: number | string | boolean | null;
}
export interface YoYBlock {
  /** Override path of the changed input. */
  path: string;
  inputLabel: string;
  inputFormat: AssumptionFormat;
  /** The changed input's value per case (Management first, then scenarios). */
  inputByCase: YoYInputValue[];
  /** Every per-period output the input drives that a scenario actually moves. */
  outputs: YoYOutput[];
}
export interface CaseYoYReport {
  yearLabels: number[];
  /** Inception column shown first (= yearLabels[0] - 1), matching other modules. */
  priorYearLabel: number;
  blocks: YoYBlock[];
}

function normalise(series: number[] | undefined, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!series) return out;
  for (let i = 0; i < n; i++) out[i] = Number(series[i] ?? 0);
  return out;
}
const diverges = (a: number[], b: number[], pa: number, pb: number): boolean =>
  Math.abs(pa - pb) > 1e-6 * Math.max(1, Math.abs(pb)) ||
  a.some((v, i) => Math.abs(v - (b[i] ?? 0)) > 1e-6 * Math.max(1, Math.abs(b[i] ?? 0)));

// Consolidated debt closing balance = sum of facility outstanding per period
// (combined carries no outstanding series), and its inception = sum of openings.
function sumFacilityOutstanding(s: ProjectFinancialsSnapshot): number[] {
  const facs = [...(s.financing?.facilities?.values() ?? [])];
  if (facs.length === 0) return [];
  const n = Math.max(...facs.map((f) => f.outstanding?.length ?? 0));
  const out = new Array<number>(n).fill(0);
  for (const f of facs) for (let t = 0; t < n; t++) out[t] += Number(f.outstanding?.[t] ?? 0);
  return out;
}
function sumFacilityOpening(s: ProjectFinancialsSnapshot): number {
  let v = 0;
  for (const f of (s.financing?.facilities?.values() ?? [])) v += Number(f.openingBalance ?? 0);
  return v;
}

// The driven outputs for one changed input path, by category. Financing inputs
// fan out to drawdown + financing cost + closing balance, scoped to one facility
// for a per-facility input or consolidated for a project-level one.
function outputsForInput(path: string, category: AssumptionCategory, trancheName: (id: string) => string): OutputDef[] {
  if (path === 'project.tax.rate') {
    return [{ key: 'tax', label: 'Tax', kind: 'flow', get: (s) => s.pl.taxPerPeriod, prior: () => 0 }];
  }
  switch (category) {
    case 'revenue':
      return [{ key: 'revenue', label: 'Revenue', kind: 'flow', get: (s) => s.pl.totalRevenuePerPeriod, prior: () => 0 }];
    case 'opex':
      return [{ key: 'opex', label: 'Operating Expenses', kind: 'flow', get: (s) => s.pl.totalOpexPerPeriod, prior: () => 0 }];
    case 'construction':
      return [{ key: 'capex', label: 'Capex', kind: 'flow', get: (s) => s.financing?.capex?.perPeriod?.exclLandInKind ?? [], prior: () => 0 }];
    case 'financing': {
      const m = /^financingTranches\[id=([^\]]+)\]/.exec(path);
      if (m) {
        const id = m[1];
        const name = trancheName(id);
        return [
          { key: `drawdown:${id}`, label: `Debt drawdown, ${name}`, kind: 'flow', get: (s) => s.financing?.facilities?.get(id)?.drawSchedule ?? [], prior: () => 0 },
          { key: `financing:${id}`, label: `Financing cost, ${name} (interest + IDC)`, kind: 'flow', get: (s) => s.financing?.facilities?.get(id)?.interestAccrued ?? [], prior: () => 0 },
          { key: `balance:${id}`, label: `Debt closing balance, ${name}`, kind: 'stock', get: (s) => s.financing?.facilities?.get(id)?.outstanding ?? [], prior: (s) => Number(s.financing?.facilities?.get(id)?.openingBalance ?? 0) },
        ];
      }
      return [
        { key: 'drawdown', label: 'Debt drawdown, all facilities', kind: 'flow', get: (s) => s.financing?.combined?.totalDrawdown ?? [], prior: () => 0 },
        { key: 'financing', label: 'Financing cost, all facilities (interest + IDC)', kind: 'flow', get: (s) => s.financing?.combined?.totalInterestAccrued ?? [], prior: () => 0 },
        { key: 'balance', label: 'Debt closing balance, all facilities', kind: 'stock', get: sumFacilityOutstanding, prior: sumFacilityOpening },
      ];
    }
    default:
      return []; // 'project' endpoint levers (discount rate, exit multiple, perpetuity growth)
  }
}

const CATEGORY_ORDER: Record<string, number> = { revenue: 0, opex: 1, financing: 2, construction: 3, project: 4 };

/**
 * Build the per-period impact report grouped by changed input. Empty `blocks`
 * when no override moves a tracked per-period output (caller shows empty state).
 */
export function buildCaseYoYReport(input: CaseComparisonInput): CaseYoYReport {
  const { baseModel, cases, activeCaseId, liveActiveModel } = input;
  const baseId = baseCaseId(cases);

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
  if (!baseSnap || !baseEntry) return { yearLabels: [], priorYearLabel: 0, blocks: [] };
  const n = baseSnap.yearLabels.length;
  const yearLabels = baseSnap.yearLabels.slice();
  const priorYearLabel = (yearLabels[0] ?? 0) - 1;

  const ctx = buildGridContext(baseModel);
  const fieldByPath = new Map(enumerateOverridableFields(baseModel).map((f) => [f.path, f]));
  const trancheName = (id: string): string => ctx.tranches.get(id)?.name || id;

  // Distinct changed inputs across all scenarios, with their descriptor.
  const changedPaths = new Map<string, { label: string; format: AssumptionFormat; category: AssumptionCategory }>();
  for (const { c, model, snap } of computed) {
    if (c.role === 'base' || !snap) continue;
    const overrides = c.id === activeCaseId && liveActiveModel ? buildOverrides(baseModel, liveActiveModel) : buildOverrides(baseModel, model);
    for (const path of Object.keys(overrides)) {
      if (changedPaths.has(path)) continue;
      const f = fieldByPath.get(path);
      const d = f ? describeAssumption(f, ctx) : assumptionFor(path, undefined, overrides[path], ctx);
      changedPaths.set(path, { label: d.context ? `${d.label} (${d.context})` : d.label, format: d.format, category: d.category });
    }
  }

  const scenarios = computed.filter((e) => e.c.role !== 'base');

  function buildOutput(def: OutputDef): YoYOutput | null {
    const baseValues = normalise(def.get(baseSnap!), n);
    const basePrior = def.prior(baseSnap!);
    const scenarioRows: YoYSeriesRow[] = [];
    const deltaRows: YoYDeltaRow[] = [];
    let moved = false;
    for (const { c, snap } of scenarios) {
      const values = normalise(snap ? def.get(snap) : undefined, n);
      const prior = snap ? def.prior(snap) : 0;
      if (diverges(values, baseValues, prior, basePrior)) moved = true;
      scenarioRows.push({ id: c.id, name: c.name, role: c.role, values, prior });
      deltaRows.push({ id: c.id, name: c.name, values: values.map((v, i) => v - baseValues[i]), prior: prior - basePrior });
    }
    if (!moved) return null; // only show outputs the input actually moves
    return {
      key: def.key, label: def.label, kind: def.kind,
      base: { id: baseEntry!.c.id, name: baseEntry!.c.name, role: 'base', values: baseValues, prior: basePrior },
      scenarios: scenarioRows, deltas: deltaRows,
    };
  }

  const blocks: YoYBlock[] = [];
  const ordered = [...changedPaths.entries()].sort((a, b) =>
    (CATEGORY_ORDER[a[1].category] ?? 9) - (CATEGORY_ORDER[b[1].category] ?? 9) || a[0].localeCompare(b[0]));
  for (const [path, meta] of ordered) {
    const outputs = outputsForInput(path, meta.category, trancheName)
      .map(buildOutput)
      .filter((o): o is YoYOutput => o !== null);
    if (outputs.length === 0) continue; // input drives no moving per-period output
    const inputByCase: YoYInputValue[] = computed.map(({ c, model }) => ({
      id: c.id, name: c.name, role: c.role,
      value: (getByPath(model, path) as number | string | boolean | null) ?? null,
    }));
    blocks.push({ path, inputLabel: meta.label, inputFormat: meta.format, inputByCase, outputs });
  }
  return { yearLabels, priorYearLabel, blocks };
}
