/**
 * scenarioLevers.ts (2026-09-15, step 8)
 *
 * TWO SCENARIO LEVERS THAT A SINGLE VALUE CAN DRIVE, APPLIED TO THE SERIES THE
 * ENGINE ALREADY READS.
 *
 * Sales pace and occupancy are stored as per-period strips, which a Module 6
 * cell (one value per case) cannot address, so neither had a lever. Each lever
 * is one number on the asset's revenue block, absent on the base, read here
 * where the strip is resolved:
 *
 *   `shiftOccupancy`  every OPERATING period (occupancy above zero) moves by the
 *                     stated percentage points, held within 0 to 100%. A period
 *                     before opening stays closed.
 *   `scaleSalesPace`  a pace factor stretches TIME on the cumulative sales curve:
 *                     what the plan had sold by year t is sold by year t / f.
 *                     0.8 sells the same total later, 1.25 sooner, as far as the
 *                     strip runs (a later sale past the last year is unsold).
 *                     Pre-sales stay in the years before the first post-sales
 *                     year; anything the stretch moves past that point sells as
 *                     post-sales.
 *
 * With the lever absent (or 0 points, or a factor of 1) each returns its input
 * unchanged, so a model without a scenario lever is byte-identical.
 *
 * Pure, no imports. No em dashes in this file.
 */

export function shiftOccupancy(series: number[] | undefined, shiftPts: number | undefined): number[] | undefined {
  if (!series || typeof shiftPts !== 'number' || !Number.isFinite(shiftPts) || shiftPts === 0) return series;
  const d = shiftPts / 100;
  return series.map((x) => (typeof x === 'number' && x > 0 ? Math.max(0, Math.min(1, x + d)) : x));
}

export function scaleSalesPace(
  pre: number[] | undefined,
  post: number[] | undefined,
  factor: number | undefined,
): { pre: number[] | undefined; post: number[] | undefined } {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor === 1) return { pre, post };
  const p = pre ?? [];
  const q = post ?? [];
  const n = Math.max(p.length, q.length);
  if (n === 0) return { pre, post };
  const cum: number[] = [];
  let run = 0;
  for (let t = 0; t < n; t++) { run += (p[t] ?? 0) + (q[t] ?? 0); cum.push(run); }
  // Cumulative planned sales at a fractional year x (0 = before the first year).
  const at = (k: number): number => (k <= 0 ? 0 : cum[Math.min(k, n) - 1]);
  const cumAt = (x: number): number => {
    if (x <= 0) return 0;
    const i = Math.floor(x);
    return at(i) + (at(i + 1) - at(i)) * (x - i);
  };
  const firstPost = q.findIndex((v) => (v ?? 0) > 0);
  const h = firstPost >= 0 ? firstPost : n;
  const outPre = pre ? new Array<number>(p.length).fill(0) : undefined;
  const outPost = post ? new Array<number>(q.length).fill(0) : undefined;
  for (let t = 0; t < n; t++) {
    const sold = cumAt((t + 1) * factor) - cumAt(t * factor);
    if (sold === 0) continue;
    if (t < h && outPre && t < outPre.length) outPre[t] += sold;
    else if (outPost && t < outPost.length) outPost[t] += sold;
    else if (outPre && t < outPre.length) outPre[t] += sold;
  }
  return { pre: outPre, post: outPost };
}
