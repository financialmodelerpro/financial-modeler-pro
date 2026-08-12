/**
 * checksReport.ts (2026-08-12)
 *
 * ONE definition of the model integrity checks, so the workbook's Checks tab
 * and both PDFs certify the same three identities with the same tolerance.
 *
 * The Excel tab carried this logic inline. The PDFs carried NONE of it: the
 * full report had a "BS Check: BALANCED" row inside the balance sheet and
 * nothing else, and the summary PDF had no balance check at all, so a reader
 * had no way to tell whether the statements reconciled.
 *
 * TOLERANCE IS RELATIVE, AND ANCHORED ON THE PEAK. Two mistakes to avoid, both
 * of which have already been made in this codebase:
 *   - an ABSOLUTE band (the workbook's old `maxBsDiff < 1`) is 1.4e-10 on a
 *     seven-billion balance sheet, which no iterative funding solver reaches,
 *     so the model reported CHECK on a healthy residue of 5.1e-8;
 *   - anchoring on the WORST PERIOD's own value divides by something that
 *     legitimately crosses zero (net cash flow does), producing "5.0e+0 of
 *     0.0 m". The anchor is the PEAK magnitude over the whole horizon.
 * The m4Reports balance-sheet row had a third variant, `max(1000, |L+E at the
 * FINAL period| * 1e-6)`, which is relative but anchored on a period that can
 * be near zero after debt is repaid. It now uses this shared rule too.
 *
 * Pure: reads the snapshot only.
 *
 * No em dashes in this file.
 */

/** A residue passes when it is negligible RELATIVE to the magnitude reconciled. */
export const CHECK_REL_TOL = 1e-6;

export interface IntegrityCheck {
  label: string;
  ok: boolean;
  /** Signed worst divergence, in model units. */
  residue: number;
  /** Axis index of the worst period. */
  atIndex: number;
  /** Peak magnitude of the series being reconciled, over the WHOLE horizon. */
  magnitude: number;
  /** What the magnitude is (for the detail line). */
  what: string;
}

interface ChecksSource {
  axisLength: number;
  yearLabels: number[];
  bs: {
    totalAssetsPerPeriod: number[];
    totalLiabilitiesPerPeriod: number[];
    totalEquityPerPeriod: number[];
    cashPerPeriod: number[];
  };
  directCF: { closingCashPerPeriod: number[]; netCashFlowPerPeriod: number[] };
  indirectCF: { netCashFlowPerPeriod: number[] };
}

export function relativeCheckOk(residue: number, magnitude: number): boolean {
  return Math.abs(residue) <= Math.max(1e-6, Math.abs(magnitude) * CHECK_REL_TOL);
}

/** Worst absolute divergence between two series, with the PEAK magnitude to judge it by. */
export function worstDivergence(
  a: readonly number[], b: readonly number[], mag: readonly number[], n: number,
): { residue: number; atIndex: number; magnitude: number } {
  let residue = 0, atIndex = 0, peak = 0;
  for (let t = 0; t < n; t++) {
    const x = (a[t] ?? 0) - (b[t] ?? 0);
    if (Math.abs(x) > Math.abs(residue)) { residue = x; atIndex = t; }
    peak = Math.max(peak, Math.abs(mag[t] ?? 0));
  }
  return { residue, atIndex, magnitude: peak };
}

/**
 * The three identities the model must satisfy. Every one is a REAL comparison
 * of two series: a check that cannot fail is worse than no check, because it
 * certifies the thing it never looked at.
 */
export function buildIntegrityChecks(snap: ChecksSource): IntegrityCheck[] {
  const n = snap.axisLength;
  const bs = snap.bs;
  const lPlusE = bs.totalLiabilitiesPerPeriod.map((v, i) => v + (bs.totalEquityPerPeriod[i] ?? 0));
  const mk = (label: string, a: number[], b: number[], mag: number[], what: string): IntegrityCheck => {
    const w = worstDivergence(a, b, mag, n);
    return { label, ok: relativeCheckOk(w.residue, w.magnitude), residue: w.residue, atIndex: w.atIndex, magnitude: w.magnitude, what };
  };
  return [
    mk('Balance sheet balances (Assets = L + E)', bs.totalAssetsPerPeriod, lPlusE, bs.totalAssetsPerPeriod, 'assets'),
    mk('Cash flow closing == balance sheet cash', snap.directCF.closingCashPerPeriod, bs.cashPerPeriod, bs.cashPerPeriod, 'cash'),
    mk('Direct cash flow == Indirect cash flow', snap.directCF.netCashFlowPerPeriod, snap.indirectCF.netCashFlowPerPeriod, snap.directCF.netCashFlowPerPeriod, 'net cash flow'),
  ];
}

/** The detail sentence for a check, stating the residue AND its scale either way. */
export function checkDetail(c: IntegrityCheck, yearLabels: readonly number[], money: (v: number) => string): string {
  const year = yearLabels[c.atIndex] ?? c.atIndex;
  if (c.magnitude === 0) return `worst period ${year}: nothing to reconcile`;
  const ratio = Math.abs(c.residue / c.magnitude).toExponential(1);
  return c.ok
    ? `worst period ${year}: ${ratio} of peak ${money(Math.abs(c.magnitude))}, within tolerance ${CHECK_REL_TOL.toExponential(0)}`
    : `worst period ${year}: ${ratio} of peak ${money(Math.abs(c.magnitude))}, OUTSIDE tolerance ${CHECK_REL_TOL.toExponential(0)}`;
}
