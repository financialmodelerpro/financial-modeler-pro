/**
 * M5 Returns engine, time-value primitives: NPV, IRR, MOIC, Payback.
 *
 * Pure functions over signed annual cash-flow arrays. period[0] is the
 * first project year, discounted at t = 0 (i.e. cf[i] is discounted by
 * (1 + r)^i). Negative = invested, positive = returned.
 */

/** Net present value of a signed annual cash-flow stream at rate r. */
export function npv(rate: number, cashflows: number[]): number {
  let acc = 0;
  for (let i = 0; i < cashflows.length; i++) {
    acc += (cashflows[i] ?? 0) / Math.pow(1 + rate, i);
  }
  return acc;
}

/** Derivative of NPV with respect to the rate (for Newton's method). */
function dNpv(rate: number, cashflows: number[]): number {
  let acc = 0;
  for (let i = 1; i < cashflows.length; i++) {
    acc += (-i * (cashflows[i] ?? 0)) / Math.pow(1 + rate, i + 1);
  }
  return acc;
}

/**
 * Internal Rate of Return for an annual stream.
 *
 * Returns null when there is no sign change (IRR undefined) or the solver
 * fails to converge. Uses Newton-Raphson seeded at `guess`, then falls
 * back to robust bisection over a wide bracket so a bad Newton step never
 * yields a wrong root. IRR is floored at -99.99% (total loss asymptote).
 */
export function irr(cashflows: number[], guess = 0.1): number | null {
  if (cashflows.length < 2) return null;
  // Need at least one sign change, otherwise IRR is undefined.
  let hasPos = false;
  let hasNeg = false;
  for (const v of cashflows) {
    if (v > 0) hasPos = true;
    else if (v < 0) hasNeg = true;
  }
  if (!hasPos || !hasNeg) return null;

  // Newton-Raphson.
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    const f = npv(rate, cashflows);
    if (Math.abs(f) < 1e-7) return rate;
    const df = dNpv(rate, cashflows);
    if (Math.abs(df) < 1e-12) break; // flat derivative, switch to bisection
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }

  // Bisection fallback over [-0.9999, 100000%].
  let lo = -0.9999;
  let hi = 1000;
  let flo = npv(lo, cashflows);
  let fhi = npv(hi, cashflows);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return null; // no root bracketed
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid, cashflows);
    if (Math.abs(fmid) < 1e-7 || (hi - lo) / 2 < 1e-9) return mid;
    if (flo * fmid < 0) { hi = mid; fhi = fmid; }
    else { lo = mid; flo = fmid; }
  }
  return (lo + hi) / 2;
}

/**
 * Multiple On Invested Capital = total cash returned / total cash invested.
 * Returns 0 when nothing was invested.
 */
export function moic(cashflows: number[]): number {
  let inflow = 0;
  let outflow = 0;
  for (const v of cashflows) {
    if (v > 0) inflow += v;
    else outflow += -v;
  }
  return outflow > 0 ? inflow / outflow : 0;
}

/**
 * Payback period in years (fractional, linearly interpolated within the
 * year the cumulative cash flow first turns non-negative). Returns null if
 * it never recovers.
 */
export function paybackPeriod(cashflows: number[]): number | null {
  let cum = 0;
  for (let i = 0; i < cashflows.length; i++) {
    const prev = cum;
    cum += cashflows[i] ?? 0;
    if (cum >= 0 && i === 0) return 0; // recovered (or never invested) at t=0
    if (cum >= 0 && prev < 0) {
      const flow = cashflows[i] ?? 0;
      // prev = cumulative at end of year i-1 (negative). During year i we
      // receive `flow`, closing the gap. Years elapsed = (i-1) + fraction.
      const frac = flow !== 0 ? -prev / flow : 0;
      return (i - 1) + Math.max(0, Math.min(1, frac));
    }
  }
  return null;
}

/** Largest cumulative cash invested at any point (peak negative exposure). */
export function peakExposure(cashflows: number[]): number {
  let cum = 0;
  let peak = 0;
  for (const v of cashflows) {
    cum += v ?? 0;
    if (cum < peak) peak = cum;
  }
  return -peak;
}
