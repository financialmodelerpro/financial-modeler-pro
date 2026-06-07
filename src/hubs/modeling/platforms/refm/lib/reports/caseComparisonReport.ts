/**
 * caseComparisonReport.ts
 *
 * Shared, pure builder for the Returns "Case Comparison": it computes every
 * case (Management base + each scenario) through the SAME pipeline as the rest
 * of the platform (applyOverrides -> computeFinancialsSnapshot ->
 * computeReturnsSnapshot) and returns the headline KPIs per case plus the delta
 * vs the base case.
 *
 * Both the on-screen tab (Module5CaseComparison) and the PDF export consume
 * this, so the comparison stays in sync automatically (same pattern as
 * lib/reports/m4Reports.ts feeding both surfaces).
 */
import { computeFinancialsSnapshot } from '../financials-resolvers';
import { computeReturnsSnapshot } from '../returns-resolvers';
import { applyOverrides, baseCaseId } from '../cases/applyOverrides';
import type { HydrateSnapshot } from '../state/module1-store';
import type { ProjectCase } from '../state/module1-types';

export type CaseKpiKind = 'pct' | 'money' | 'mult';

export interface CaseKpiDef {
  label: string;
  kind: CaseKpiKind;
  sub?: string;
  get: (rs: ReturnType<typeof computeReturnsSnapshot>) => number | null;
}

/** Headline KPIs, in the same wording as the Returns + RE Metrics tabs. */
export const CASE_KPIS: CaseKpiDef[] = [
  { label: 'Project IRR (FCFF)', kind: 'pct', get: (rs) => rs.result.fcff.irr },
  { label: 'Equity IRR (FCFE)', kind: 'pct', get: (rs) => rs.result.fcfe.irr },
  { label: 'Distributed-Equity IRR', kind: 'pct', get: (rs) => rs.result.dividends.irr },
  { label: 'Equity MOIC', kind: 'mult', get: (rs) => rs.result.fcfe.moic },
  { label: 'Equity Multiple', kind: 'mult', sub: 'distributions / invested', get: (rs) => rs.result.realEstate.equityMultiple },
  { label: 'Gross Development Value', kind: 'money', get: (rs) => rs.developmentEconomics.gdv },
  { label: 'Total Development Cost', kind: 'money', get: (rs) => rs.totalDevelopmentCost },
  { label: 'Profit after Financing', kind: 'money', get: (rs) => rs.developmentEconomics.profitAfterFinancing },
  { label: 'Development Margin', kind: 'pct', sub: 'profit / GDV', get: (rs) => rs.developmentEconomics.developmentMargin },
  { label: 'Peak Equity', kind: 'money', get: (rs) => rs.result.realEstate.peakEquity },
  { label: 'Terminal Equity Value', kind: 'money', get: (rs) => rs.terminalEquityValue },
];

export interface CaseComparisonColumn {
  id: string;
  name: string;
  role: ProjectCase['role'];
  isActive: boolean;
  overrideCount: number;
  /** KPI label -> value (null when the case failed to compute or n/a). */
  values: Record<string, number | null>;
}

export interface CaseComparisonReport {
  baseId: string;
  columns: CaseComparisonColumn[];
  kpis: CaseKpiDef[];
}

export interface CaseComparisonInput {
  /** Management / base model (no overrides applied). */
  baseModel: HydrateSnapshot;
  /** The full case registry (base + scenarios). */
  cases: ProjectCase[];
  /** The case currently being viewed/edited. */
  activeCaseId: string;
  /** The live (possibly unsaved) model for the active case. When omitted, the
   *  active case is resolved from base + its stored overrides like any other. */
  liveActiveModel?: HydrateSnapshot;
  /** Pre-counted override count for the active case (live edits). When omitted,
   *  the active case shows its stored override count. */
  activeOverrideCount?: number;
}

/** Compute the per-case KPI matrix. Each case never throws: a case that fails
 *  to compute yields null values so the rest still render. */
export function buildCaseComparisonReport(input: CaseComparisonInput): CaseComparisonReport {
  const { baseModel, cases, activeCaseId, liveActiveModel, activeOverrideCount } = input;
  const baseId = baseCaseId(cases);

  const columns: CaseComparisonColumn[] = cases.map((c) => {
    let model: HydrateSnapshot;
    if (c.id === activeCaseId && liveActiveModel) model = liveActiveModel;
    else if (c.role === 'base') model = baseModel;
    else model = applyOverrides(baseModel, c.overrides);

    const values: Record<string, number | null> = {};
    try {
      const snap = computeFinancialsSnapshot(model as never);
      const rs = computeReturnsSnapshot(snap, model.project);
      for (const k of CASE_KPIS) values[k.label] = k.get(rs);
    } catch {
      for (const k of CASE_KPIS) values[k.label] = null;
    }
    const overrideCount = c.role === 'base'
      ? 0
      : (c.id === activeCaseId && activeOverrideCount !== undefined
          ? activeOverrideCount
          : Object.keys(c.overrides ?? {}).length);
    return { id: c.id, name: c.name, role: c.role, isActive: c.id === activeCaseId, overrideCount, values };
  });

  return { baseId, columns, kpis: CASE_KPIS };
}
