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
 *   - anchoring on the WORST PERIOD's own value divides by something that
 *     legitimately crosses zero (net cash flow does), producing "5.0e+0 of
 *     0.0 m". The anchor is the PEAK magnitude over the whole horizon.
 *   - a band far looser than floating-point noise. See below: this one cost
 *     us a real defect.
 * The m4Reports balance-sheet row had a third variant, `max(1000, |L+E at the
 * FINAL period| * 1e-6)`, which is relative but anchored on a period that can
 * be near zero after debt is repaid. It now uses this shared rule too.
 *
 * WHY THE BAND IS 1e-12 AND NOT 1e-6 (2026-08-18, and this is the second time
 * a loosened tolerance has certified a real break).
 *
 * These three identities are EXACT BY CONSTRUCTION: each side is a sum of the
 * same flows, so a healthy residue is pure double-precision noise and nothing
 * else. Measured on both live projects with the model correct: worst residue
 * 1.9e-6 on a 6,597.1m peak, a relative 2.9e-16, which is one machine epsilon.
 * There is no iterative-solver slack in these three, and the note this comment
 * replaces was wrong to imply there is: the funding solver converges BEFORE
 * the statements are struck.
 *
 * At 1e-6 the band on that project was 6,597 currency units, ten orders of
 * magnitude above the noise. It reported OK on a residue of 360.79, which was
 * recorded in CLAUDE.md and docs/FUND_LAYER_GUIDELINE.md as "pre-existing
 * solver convergence" and pinned as a non-defect. It was a REAL 25,000,000
 * imbalance on the sister project (in-kind equity recognised in a different
 * period from the in-kind land it pays for, see docs/TRAPS.md 7.22), and this
 * check certified the smaller instance of it as healthy. THE PREVIOUS BAND WAS
 * LOOSENED TO MAKE A RED CHECK GREEN, AND THE RED CHECK WAS RIGHT.
 *
 * 1e-12 keeps the anchor fix (the real reason the band went relative) and
 * still leaves roughly 3,000x headroom over the measured noise: 6.6e-3 on the
 * 6,597.1m sheet against a 1.9e-6 residue. It would have caught the 360.79 by
 * five orders of magnitude. If a legitimate residue ever exceeds this, find
 * out WHY before widening it again.
 *
 * Pure: reads the snapshot only.
 *
 * No em dashes in this file.
 */

/** A residue passes when it is negligible RELATIVE to the magnitude reconciled.
 *  Sized against measured floating-point noise, not against convenience: read
 *  the tolerance note above before changing it. */
export const CHECK_REL_TOL = 1e-12;

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

/**
 * CASH BASIS VS SALE BASIS (2026-08-16).
 *
 * `percent_of_revenue_cash` charges on cash COLLECTED; `percent_of_revenue_sale`
 * and `percent_of_total_revenue` charge on GROSS LIST VALUE (units x price).
 * Until 2026-08-16 all three resolved to gross, so the distinction lived on the
 * schema and nowhere else.
 *
 * The two bases coincide whenever every sale is collected inside the hold, which
 * is the ordinary case and is why the split went unnoticed. They part company on
 * escrow held past exit, exit truncation, or revenue never collected.
 *
 * THIS IS AN ADVISORY, NOT AN INTEGRITY CHECK, and deliberately not folded into
 * buildIntegrityChecks. Those are identities that must hold to 1e-6 or the model
 * is broken. A gap between collections and list value is a legitimate model
 * state, so reporting it as a failed check would cry wolf on a correct model.
 * It is surfaced so the case that would justify a per-period revenue base is
 * visible rather than silent.
 */
export const BASIS_DIVERGENCE_TOL = 0.005; // 0.5% of gross

export interface RevenueBasisAdvisory {
  assetId: string;
  assetName: string;
  gross: number;
  collections: number;
  /** collections / gross - 1. Negative means cash falls short of list value. */
  relative: number;
}

/**
 * Assets whose collections diverge materially from gross list value. Empty when
 * every asset agrees, which is the normal case, so a caller renders it
 * unconditionally and shows nothing most of the time.
 */
export function buildRevenueBasisAdvisories(
  assets: ReadonlyArray<{ id: string; name: string }>,
  grossOf: (assetId: string) => number,
  collectionsOf: (assetId: string) => number | undefined,
): RevenueBasisAdvisory[] {
  const out: RevenueBasisAdvisory[] = [];
  for (const a of assets) {
    const gross = grossOf(a.id);
    const collections = collectionsOf(a.id);
    // No revenue configured at all is not a divergence, it is an empty asset.
    if (collections === undefined || gross <= 0) continue;
    const relative = collections / gross - 1;
    if (Math.abs(relative) <= BASIS_DIVERGENCE_TOL) continue;
    out.push({ assetId: a.id, assetName: a.name, gross, collections, relative });
  }
  return out;
}

/**
 * The same advisories straight from a snapshot, so every surface asks the
 * question identically instead of each assembling gross and collections itself.
 * Sell-strategy assets only: nothing else has a sale value or a collection.
 */
export function buildRevenueBasisAdvisoriesFor(
  assets: ReadonlyArray<{ id: string; name: string; strategy?: string; visible?: boolean }>,
  subUnits: ReadonlyArray<{ assetId: string; category?: string; metricValue?: number; unitPrice?: number }>,
  revenue: { bySellAsset: Map<string, { cashCollectedPerPeriod?: number[] } | undefined> } | undefined,
): RevenueBasisAdvisory[] {
  const sell = assets.filter((a) => a.visible !== false
    && (a.strategy === 'Sell' || a.strategy === 'Sell + Manage'));
  const grossOf = (id: string): number => subUnits
    .filter((u) => u.assetId === id
      && (u.category === 'Sellable' || u.category === 'Operable' || u.category === 'Leasable'))
    .reduce((s, u) => s + Math.max(0, u.metricValue ?? 0) * Math.max(0, u.unitPrice ?? 0), 0);
  const collectionsOf = (id: string): number | undefined => {
    const series = revenue?.bySellAsset?.get(id)?.cashCollectedPerPeriod;
    if (!series || series.length === 0) return undefined;
    return series.reduce((s, v) => s + (v ?? 0), 0);
  };
  return buildRevenueBasisAdvisories(sell, grossOf, collectionsOf);
}

/** One sentence naming what the divergence means, for any surface. */
export function revenueBasisAdvisoryText(
  a: RevenueBasisAdvisory,
  money: (v: number) => string,
): string {
  const pct = (a.relative * 100).toFixed(1);
  const dir = a.relative < 0 ? 'below' : 'above';
  return `${a.assetName}: cash collected ${money(a.collections)} is ${pct}% ${dir} gross sale value ${money(a.gross)}. `
    + 'A cost on the cash basis charges on the smaller figure; one on the sale basis charges on the larger.';
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
