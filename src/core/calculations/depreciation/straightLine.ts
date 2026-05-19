/**
 * Pure straight-line + reducing-balance depreciation allocators.
 *
 * `buildStraightLine(base, life, startIdx, N)` allocates `base/life`
 * per period for `life` periods from `startIdx`. Residual NBV stays at
 * exit (reference's net-worth exit convention).
 *
 * `buildReducingBalance(base, rate, startIdx, N)` allocates
 * `rate × remaining NBV` each period. Asymptotes toward zero without
 * ever fully writing off — the residual NBV at end of axis is the
 * uncharged tail (also matches a net-worth exit).
 *
 * Sentinel values (both functions):
 *   - base <= 0 → all zeros
 *   - rate / life <= 0 → all zeros
 *   - startIdx out of range → clamped / all zeros
 */

export function buildStraightLine(
  base: number,
  life: number,
  startIdx: number,
  axisLength: number,
): number[] {
  const out = new Array<number>(Math.max(0, axisLength)).fill(0);
  if (!Number.isFinite(base) || base <= 0) return out;
  if (!Number.isFinite(life) || life <= 0) return out;
  if (!Number.isFinite(startIdx)) return out;
  const start = Math.max(0, Math.floor(startIdx));
  if (start >= out.length) return out;
  const perYear = base / life;
  const lifeYears = Math.max(1, Math.floor(life));
  const end = Math.min(out.length, start + lifeYears);
  let charged = 0;
  for (let t = start; t < end; t++) {
    const remaining = base - charged;
    if (remaining <= 0) break;
    const v = Math.min(perYear, remaining);
    out[t] = v;
    charged += v;
  }
  return out;
}

/**
 * Reducing-balance (declining-balance) depreciation.
 *
 *   nbv[0] = base
 *   dep[t] = nbv[t] × rate   (for t in [startIdx, axisLength))
 *   nbv[t+1] = nbv[t] − dep[t]
 *
 * Note: with reducing balance, the asset never fully writes off;
 * residual NBV stays on the books at exit (net-worth exit picks it up).
 * If a strict full writeoff is required, the operator switches to
 * straight-line.
 *
 * The `life` parameter is optional and only used to cap the
 * depreciation window — when `life > 0`, depreciation stops after
 * `life` periods (matching the asset's useful-life horizon). Pass
 * `life = 0` (default) for an unbounded RB schedule that runs to the
 * end of the axis.
 */
export function buildReducingBalance(
  base: number,
  rate: number,
  startIdx: number,
  axisLength: number,
  life = 0,
): number[] {
  const out = new Array<number>(Math.max(0, axisLength)).fill(0);
  if (!Number.isFinite(base) || base <= 0) return out;
  if (!Number.isFinite(rate) || rate <= 0) return out;
  if (!Number.isFinite(startIdx)) return out;
  const start = Math.max(0, Math.floor(startIdx));
  if (start >= out.length) return out;
  const cappedLife = Math.max(0, Math.floor(life));
  const end = cappedLife > 0
    ? Math.min(out.length, start + cappedLife)
    : out.length;
  let nbv = base;
  for (let t = start; t < end; t++) {
    if (nbv <= 0) break;
    const dep = nbv * rate;
    out[t] = dep;
    nbv -= dep;
  }
  return out;
}
