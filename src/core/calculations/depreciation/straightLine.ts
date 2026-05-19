/**
 * Pure straight-line depreciation allocator.
 *
 * `buildStraightLine(base, life, startIdx, N)` returns a number[] of
 * length N where indices in [startIdx, startIdx + life) receive
 * `base / life`. Indices outside the window are 0. Any residual NBV
 * left after axisLength stays on the books (matches the reference
 * Excel's "Value at exit date" convention; a net-worth exit method
 * writes it off then).
 *
 * Sentinel values:
 *   - life <= 0 → all zeros (Land case)
 *   - base <= 0 → all zeros
 *   - startIdx >= N → all zeros
 *   - startIdx < 0 → clamped to 0
 *   - base / life * (N - startIdx) > base → final period of the
 *     in-axis window carries any rounding residual so the sum-of-axis
 *     is monotone non-decreasing toward `base`.
 *
 * The allocator is component-agnostic: pass any depreciable base; the
 * caller decides whether that's Construction, Soft Costs, Capitalised
 * Interest, etc. Component lives differ across the reference workbook
 * (Construction = 25 yrs, Capitalised Interest = 7 yrs, Pre-Op = 7 yrs)
 * but they all use this same SL math.
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
  // No residual lump: if life > axisLength - start, the remainder
  // stays as NBV at exit (matches the reference's net-worth exit
  // method).
  return out;
}
