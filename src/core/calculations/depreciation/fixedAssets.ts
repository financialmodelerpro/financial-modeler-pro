/**
 * Per-asset fixed-asset roll-forward (Pass 1).
 *
 * Layers the SL allocator over a vintage approach: every period's
 * depreciable addition opens its own straight-line stream from
 * max(t, startIdx), so a unit of capex spent in year 3 starts
 * depreciating at handover or year 3 (whichever is later). Existing-
 * operations opening NBV is treated as a vintage anchored at index 0
 * with its own `openingRemainingLife`.
 *
 * Result roll-forward (per period t):
 *   opening[t]   = closing[t-1]    (opening[0] = openingNBV)
 *   closing[t]   = max(0, opening[t] + additionsPerPeriod[t]
 *                            − depreciationPerPeriod[t])
 *
 * Land additions are echoed but excluded from the depreciation base.
 * They still flow through opening/closing because Land sits on the BS
 * as a non-depreciable line; the reference Excel handles this the same
 * way (Land row has life=0 and contributes to Fixed Asset/WIP balance
 * but never to the Depreciation row).
 */

import type { AssetFixedAssetConfig, AssetFixedAssetResult } from './types';
import { buildStraightLine } from './straightLine';

export function computeAssetFixedAssets(
  config: AssetFixedAssetConfig,
): AssetFixedAssetResult {
  const N = Math.max(0, Math.floor(config.axisLength));
  const additions = ensureLen(config.additionsPerPeriod, N);
  const landAdditions = ensureLen(config.additionsLandPerPeriod, N);
  const depreciableAdditions = additions.map((v, i) => Math.max(0, v - Math.max(0, landAdditions[i] ?? 0)));
  const usefulLife = Math.max(0, config.usefulLifeYears ?? 0);
  const openingNBV = Math.max(0, config.openingNBV ?? 0);
  const openingAccumDep = Math.max(0, config.openingAccumDep ?? 0);
  const openingRemaining = Math.max(0, config.openingRemainingLife ?? usefulLife);
  const startIdx = Math.max(0, Math.floor(config.startIdx ?? 0));

  // ── Per-vintage SL streams ────────────────────────────────────────
  const vintages: number[][] = [];

  // Existing-operations vintage: opening NBV depreciates from idx 0
  // over remaining life. NBV is already net of cumulative depreciation
  // (caller subtracts openingAccumDep from gross book value before
  // passing it in), so this stream represents the remaining writeoff.
  if (openingNBV > 0 && openingRemaining > 0) {
    vintages.push(buildStraightLine(openingNBV, openingRemaining, 0, N));
  }

  // Per-period additions: each vintage starts at max(t, startIdx) so
  // WIP cannot depreciate until handover.
  let totalDepreciableBase = openingNBV;
  for (let t = 0; t < N; t++) {
    const add = depreciableAdditions[t] ?? 0;
    if (add <= 0) continue;
    totalDepreciableBase += add;
    const start = Math.max(t, startIdx);
    vintages.push(buildStraightLine(add, usefulLife, start, N));
  }

  // ── Sum vintages → per-period depreciation ─────────────────────────
  const depreciation = new Array<number>(N).fill(0);
  for (const v of vintages) {
    for (let t = 0; t < N; t++) depreciation[t] += v[t] ?? 0;
  }

  // ── Roll-forward: opening / closing NBV ────────────────────────────
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
    additionsPerPeriod: additions,
    additionsLandPerPeriod: landAdditions,
    depreciableAdditionsPerPeriod: depreciableAdditions,
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
