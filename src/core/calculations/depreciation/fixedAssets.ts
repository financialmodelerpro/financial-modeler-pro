/**
 * Per-asset depreciable roll-forward (Pass 1d, 2026-05-19).
 *
 * Engine handles ONLY depreciable additions + opening NBV. Land sits
 * outside this engine.
 *
 * Per-vintage allocation: each period's addition opens its own
 * depreciation stream from max(t, startIdx), routed through the
 * configured method (straight-line or reducing-balance). Existing-
 * operations opening NBV is a separate vintage anchored at index 0
 * over `openingRemainingLife`.
 *
 * Roll-forward per period t:
 *   opening[t]   = closing[t-1]    (opening[0] = openingNBV)
 *   closing[t]   = max(0, opening[t] + additionsPerPeriod[t]
 *                            − depreciationPerPeriod[t])
 *
 * Residual NBV at end of axis stays on the books (reference's
 * net-worth exit convention).
 */

import type { AssetFixedAssetConfig, AssetFixedAssetResult, DepreciationMethod } from './types';
import { buildStraightLine, buildReducingBalance } from './straightLine';

function buildVintage(
  base: number,
  life: number,
  startIdx: number,
  axisLength: number,
  method: DepreciationMethod,
  rbRate: number,
): number[] {
  if (method === 'reducing_balance') {
    return buildReducingBalance(base, rbRate, startIdx, axisLength, life);
  }
  return buildStraightLine(base, life, startIdx, axisLength);
}

export function computeAssetFixedAssets(
  config: AssetFixedAssetConfig,
): AssetFixedAssetResult {
  const N = Math.max(0, Math.floor(config.axisLength));
  const additions = ensureLen(config.additionsPerPeriod, N);
  const usefulLife = Math.max(0, config.usefulLifeYears ?? 0);
  const openingNBV = Math.max(0, config.openingNBV ?? 0);
  const openingAccumDep = Math.max(0, config.openingAccumDep ?? 0);
  const openingRemaining = Math.max(0, config.openingRemainingLife ?? usefulLife);
  const startIdx = Math.max(0, Math.floor(config.startIdx ?? 0));
  const method: DepreciationMethod = config.method ?? 'straight_line';

  // Resolve effective RB rate. Default = 2/usefulLifeYears (double-
  // declining-balance) when not specified, matching the convention
  // every accounting textbook uses to link RB life with SL life.
  const effectiveRate = method === 'reducing_balance'
    ? Math.max(0, config.reducingBalanceRate ?? (usefulLife > 0 ? 2 / usefulLife : 0))
    : undefined;

  // ── Per-vintage streams ───────────────────────────────────────────
  const vintages: number[][] = [];

  if (openingNBV > 0 && openingRemaining > 0) {
    vintages.push(buildVintage(
      openingNBV, openingRemaining, 0, N, method, effectiveRate ?? 0,
    ));
  }

  let totalDepreciableBase = openingNBV;
  for (let t = 0; t < N; t++) {
    const add = additions[t] ?? 0;
    if (add <= 0) continue;
    totalDepreciableBase += add;
    const start = Math.max(t, startIdx);
    vintages.push(buildVintage(
      add, usefulLife, start, N, method, effectiveRate ?? 0,
    ));
  }

  // ── Sum vintages → per-period depreciation ─────────────────────────
  const depreciation = new Array<number>(N).fill(0);
  for (const v of vintages) {
    for (let t = 0; t < N; t++) depreciation[t] += v[t] ?? 0;
  }

  // ── Roll-forward: opening / closing NBV (depreciable only) ────────
  const openingNBVPerPeriod = new Array<number>(N).fill(0);
  const closingNBVPerPeriod = new Array<number>(N).fill(0);
  const accumDepPerPeriod = new Array<number>(N).fill(0);
  let prevClose = openingNBV;
  let cumDep = openingAccumDep;
  for (let t = 0; t < N; t++) {
    openingNBVPerPeriod[t] = prevClose;
    const add = additions[t] ?? 0;
    const dep = depreciation[t] ?? 0;
    let close = prevClose + add - dep;
    if (close < 0) close = 0;
    closingNBVPerPeriod[t] = close;
    cumDep += dep;
    accumDepPerPeriod[t] = cumDep;
    prevClose = close;
  }

  return {
    assetId: config.assetId,
    axisLength: N,
    method,
    effectiveRate,
    additionsPerPeriod: additions,
    depreciationPerPeriod: depreciation,
    accumDepPerPeriod,
    openingNBVPerPeriod,
    closingNBVPerPeriod,
    totalDepreciableBase,
    totalAdditions: additions.reduce((s, v) => s + (v ?? 0), 0),
    totalDepreciation: depreciation.reduce((s, v) => s + (v ?? 0), 0),
  };
}

function ensureLen(arr: number[] | undefined, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!arr) return out;
  for (let i = 0; i < n; i++) out[i] = arr[i] ?? 0;
  return out;
}
