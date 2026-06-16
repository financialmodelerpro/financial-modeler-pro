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
import { applyOverrides, baseCaseId, buildOverrides } from '../cases/applyOverrides';
import type { HydrateSnapshot } from '../state/module1-store';
import type { ProjectCase } from '../state/module1-types';

export type CaseKpiKind = 'pct' | 'money' | 'mult';

export interface CaseKpiDef {
  label: string;
  kind: CaseKpiKind;
  sub?: string;
  /** Text to show when get() returns null, instead of a bare "n/a". Lets a
   *  metric explain WHY it is blank (e.g. a marginal project with no unlevered
   *  IRR) so it never reads as a frozen / dead override. */
  nullLabel?: string;
  get: (rs: ReturnType<typeof computeReturnsSnapshot>) => number | null;
}

/** Headline KPIs, in the same wording as the Returns + RE Metrics tabs. */
export const CASE_KPIS: CaseKpiDef[] = [
  // Project IRR (FCFF) is unlevered; a marginal / all-cash-positive project has
  // no sign change so the IRR is genuinely null. Label that explicitly and lead
  // with the levered Equity IRR (FCFE), which is the headline investors read.
  { label: 'Equity IRR (FCFE)', kind: 'pct', get: (rs) => rs.result.fcfe.irr },
  { label: 'Project IRR (FCFF)', kind: 'pct', sub: 'unlevered', nullLabel: 'n/a (no unlevered IRR)', get: (rs) => rs.result.fcff.irr },
  { label: 'Distributed-Equity IRR', kind: 'pct', get: (rs) => rs.result.dividends.irr },
  { label: 'Equity MOIC', kind: 'mult', get: (rs) => rs.result.fcfe.moic },
  { label: 'Equity Multiple', kind: 'mult', sub: 'distributions / invested', get: (rs) => rs.result.realEstate.equityMultiple },
  { label: 'NPV (FCFF)', kind: 'money', sub: 'at discount rate', get: (rs) => rs.result.fcff.npv },
  { label: 'Gross Development Value', kind: 'money', get: (rs) => rs.developmentEconomics.gdv },
  // Total Development Cost split into Land + Capex (construction), which sum back
  // to the total, so each scenario shows how land vs build cost moves.
  { label: 'Land Cost', kind: 'money', get: (rs) => rs.sourcesUses.land },
  { label: 'Capex (construction)', kind: 'money', sub: 'excl. land', get: (rs) => rs.sourcesUses.construction },
  { label: 'Total Development Cost', kind: 'money', sub: 'land + capex', get: (rs) => rs.totalDevelopmentCost },
  { label: 'Total Financing Cost', kind: 'money', get: (rs) => rs.developmentEconomics.totalFinancingCost },
  { label: 'Profit after Financing', kind: 'money', get: (rs) => rs.developmentEconomics.profitAfterFinancing },
  { label: 'Development Margin', kind: 'pct', sub: 'profit / GDV', get: (rs) => rs.developmentEconomics.developmentMargin },
  { label: 'Cap Rate at Exit', kind: 'pct', get: (rs) => rs.result.realEstate.capRateAtExit },
  { label: 'Min DSCR', kind: 'mult', sub: 'min over operating periods', get: (rs) => rs.result.realEstate.dscrMin },
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
    // Count REAL overrides (fields whose value differs from base), not stored
    // keys: a stored override equal to the base value is a no-op and must not
    // inflate the count. The active case's count is the live diff (passed in);
    // others diff their merged model against base.
    const overrideCount = c.role === 'base'
      ? 0
      : (c.id === activeCaseId && activeOverrideCount !== undefined
          ? activeOverrideCount
          : Object.keys(buildOverrides(baseModel, model)).length);
    return { id: c.id, name: c.name, role: c.role, isActive: c.id === activeCaseId, overrideCount, values };
  });

  return { baseId, columns, kpis: CASE_KPIS };
}
