/**
 * covenants.ts (2026-06-15): pure lender-covenant evaluation for the RE Metrics
 * tab. No engine / snapshot mutation: it takes ratio series already on the
 * returns snapshot (DSCR, ICR) plus the raw series needed to DERIVE Debt Yield
 * (NOI / debt) and LTV (debt / value), and turns a covenant threshold into a
 * per-period series, worst + average over the loan life, and a pass / breach
 * verdict.
 *
 * LTV is measured at PEAK DEBT, not at exit: debt is repaid by exit here, so
 * LTV at exit is a trivial ~0% that means nothing to a lender. The model has no
 * per-period property value, so the best value basis the snapshot supports is
 * GDV (Gross Development Value). LTV per period = debt outstanding / GDV, and
 * the binding (max) point IS the peak-debt LTV. Where GDV is unavailable it
 * falls back to a single-point LTV at exit, explicitly labelled as such so it
 * cannot be mistaken for a peak-leverage covenant.
 */
import type { CovenantMetric, CovenantThreshold } from './state/module1-types';

export interface CovenantInputs {
  /** Per-period DSCR (CFADS / debt service), 0 where no debt service. */
  dscrPerPeriod: number[];
  /** Engine min / avg DSCR over debt-service periods (used to match the cards). */
  dscrMin: number | null;
  dscrAvg: number | null;
  /** Per-period ICR (EBITDA / interest), 0 where no interest. */
  icrPerPeriod: number[];
  icrMin: number | null;
  /** Per-period NOI + debt outstanding, to derive Debt Yield = NOI / debt and
   *  peak-debt LTV = debt outstanding / GDV. */
  noiPerPeriod: number[];
  debtOutstandingPerPeriod: number[];
  /** Gross Development Value (value basis for peak-debt LTV = debt / GDV). */
  gdvValue: number | null;
  /** Debt at exit / exit enterprise value (LTV fallback when no GDV basis). */
  ltvAtExit: number | null;
}

export interface CovenantEval {
  /** Per-period ratio, null where not applicable (no debt / no series). */
  seriesPerPeriod: Array<number | null>;
  /** The binding value: min for a 'min' covenant, max for a 'max' covenant. */
  worst: number | null;
  /** Mean ratio over applicable periods. */
  avg: number | null;
  /** True = pass, false = breach, null = not applicable / not computable. */
  pass: boolean | null;
  /** True when the verdict is a single point (LTV fallback at exit), not a
   *  per-period series. */
  exitOnly: boolean;
  /** 'x' (multiple) or 'pct' (decimal shown as %). */
  unit: 'x' | 'pct';
  /** LTV basis: 'peak-debt' (debt / GDV) or 'exit' (fallback). Undefined for
   *  metrics where the basis is fixed (DSCR / ICR / Debt Yield / custom). */
  basis?: 'peak-debt' | 'exit';
  /** Human label for the value basis, e.g. 'peak debt / GDV' or 'LTV at exit'. */
  basisLabel?: string;
}

const EPS = 1e-9;

export function covenantUnit(metric: CovenantMetric): 'x' | 'pct' {
  return metric === 'ltv' || metric === 'debt_yield' ? 'pct' : 'x';
}

/** Per-period ratio for a metric (null = not applicable). */
export function covenantSeries(metric: CovenantMetric, inp: CovenantInputs): Array<number | null> {
  const n = inp.dscrPerPeriod.length;
  const blank = (): Array<number | null> => new Array(n).fill(null);
  switch (metric) {
    case 'dscr': return inp.dscrPerPeriod.map((v) => (Math.abs(v) < EPS ? null : v));
    case 'icr': return inp.icrPerPeriod.map((v) => (Math.abs(v) < EPS ? null : v));
    case 'debt_yield':
      // Applicable only when there is BOTH debt and income (construction periods
      // with debt drawn but no NOI are n/a, not a 0% breach).
      return inp.noiPerPeriod.map((noi, t) => {
        const d = inp.debtOutstandingPerPeriod[t] ?? 0;
        return d > EPS && (noi ?? 0) > EPS ? (noi ?? 0) / d : null;
      });
    case 'ltv': {
      // Peak-debt LTV = debt outstanding / GDV per period; the max point is the
      // peak-leverage figure a lender covenants on. Null where no debt is drawn
      // (0% leverage is not a meaningful test point) or no GDV value basis.
      const gdv = inp.gdvValue;
      if (gdv == null || gdv <= EPS) return blank();
      return inp.debtOutstandingPerPeriod.map((d) => ((d ?? 0) > EPS ? (d ?? 0) / gdv : null));
    }
    default: return blank(); // custom
  }
}

/** Evaluate one covenant against the snapshot-derived ratios. */
export function evaluateCovenant(cov: CovenantThreshold, inp: CovenantInputs): CovenantEval {
  const unit = covenantUnit(cov.metric);

  if (cov.metric === 'ltv') {
    // Preferred: peak-debt LTV from the per-period debt / GDV series. The worst
    // (max for a 'max' covenant) is the peak-leverage point.
    const series = covenantSeries('ltv', inp);
    const vals = series.filter((x): x is number => x != null);
    if (vals.length > 0) {
      const worst = cov.operator === 'min' ? Math.min(...vals) : Math.max(...vals);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const pass = cov.operator === 'min' ? worst >= cov.threshold : worst <= cov.threshold;
      return { seriesPerPeriod: series, worst, avg, pass, exitOnly: false, unit, basis: 'peak-debt', basisLabel: 'peak debt / GDV' };
    }
    // Fallback: no GDV basis (or no debt drawn) -> single-point LTV at exit,
    // explicitly labelled so it is not read as a peak-leverage covenant.
    const v = inp.ltvAtExit;
    const pass = v == null ? null : cov.operator === 'max' ? v <= cov.threshold : v >= cov.threshold;
    const blank = new Array<number | null>(inp.dscrPerPeriod.length).fill(null);
    return { seriesPerPeriod: blank, worst: v, avg: v, pass, exitOnly: true, unit, basis: 'exit', basisLabel: 'LTV at exit' };
  }
  if (cov.metric === 'custom') {
    return { seriesPerPeriod: covenantSeries('custom', inp), worst: null, avg: null, pass: null, exitOnly: false, unit };
  }

  const series = covenantSeries(cov.metric, inp);
  const vals = series.filter((x): x is number => x != null);
  if (vals.length === 0) {
    return { seriesPerPeriod: series, worst: null, avg: null, pass: null, exitOnly: false, unit };
  }
  // Prefer engine-provided min / avg for DSCR / ICR so the covenant matches the
  // Min DSCR / Min Interest Cover cards exactly (no drift); derive for the rest.
  const computedWorst = cov.operator === 'min' ? Math.min(...vals) : Math.max(...vals);
  const computedAvg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const worst = cov.metric === 'dscr' && inp.dscrMin != null ? inp.dscrMin
    : cov.metric === 'icr' && inp.icrMin != null ? inp.icrMin
    : computedWorst;
  const avg = cov.metric === 'dscr' && inp.dscrAvg != null ? inp.dscrAvg : computedAvg;
  const pass = cov.operator === 'min' ? worst >= cov.threshold : worst <= cov.threshold;
  return { seriesPerPeriod: series, worst, avg, pass, exitOnly: false, unit };
}
