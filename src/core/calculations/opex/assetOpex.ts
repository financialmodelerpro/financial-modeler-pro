/**
 * Per-asset Opex engine.
 *
 * Two-pass evaluation:
 *   Pass A — compute every line whose mode does NOT depend on GOP
 *            (fixed_baseline / pct_of_* / per_room / per_sqm).
 *   Pass B — compute Direct + Indirect aggregates, then GOP, then any
 *            'pct_of_gop' lines.
 *
 * GOP convention (matches KPMG SC7 hospitality hierarchy):
 *     GOP = Revenue (TR) - Direct costs - Indirect costs
 * Management fee + Replacement reserve + Rent & insurance are BELOW
 * GOP; NOI = Revenue - Total Opex.
 *
 * All output arrays are project-axis-indexed, axisLength long. Cells
 * outside [opsStartIdx, opsEndIdx] are zero.
 */

import { applyIndexation } from '@/src/core/calculations/revenue/indexation';
import type {
  AssetOpexInputs,
  AssetOpexResult,
  OpexLine,
  OpexLineCategory,
  OpexRevenueContext,
} from './types';

const DIRECT_CATEGORIES: OpexLineCategory[] = ['direct_rooms', 'direct_fb', 'direct_other'];
const INDIRECT_CATEGORIES: OpexLineCategory[] = [
  'indirect_ga', 'indirect_it', 'indirect_sm', 'indirect_pom', 'indirect_energy', 'indirect_eosb',
];
const MGMT_CATEGORIES: OpexLineCategory[] = [
  'mgmt_base', 'mgmt_tech', 'mgmt_incentive', 'replacement_reserve',
];

function inCategory(cat: OpexLineCategory, set: OpexLineCategory[]): boolean {
  return set.indexOf(cat) >= 0;
}

function streamForMode(mode: OpexLine['mode'], rev: OpexRevenueContext): number[] | null {
  switch (mode) {
    case 'pct_of_room_rev': return rev.roomRevenuePerPeriod;
    case 'pct_of_fb_rev': return rev.fbRevenuePerPeriod;
    case 'pct_of_other_rev': return rev.otherRevenuePerPeriod;
    case 'pct_of_total_rev': return rev.totalRevenuePerPeriod;
    case 'pct_of_lease_rev': return rev.leaseRevenuePerPeriod;
    default: return null;
  }
}

export function computeAssetOpex(inputs: AssetOpexInputs): AssetOpexResult {
  const { assetId, lines, keys, leasableSqm, opsStartIdx, opsEndIdx, axisLength, revenue } = inputs;
  const N = Math.max(0, axisLength);
  const start = Math.max(0, Math.min(N - 1, opsStartIdx));
  const end = Math.max(start, Math.min(N - 1, opsEndIdx));

  const zeros = (): number[] => new Array<number>(N).fill(0);
  const perLine: number[][] = lines.map(() => zeros());

  // Pass A: every non-GOP line. GOP-driven lines stay at zero until
  // Pass B fills them.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.disabled) continue;
    if (line.mode === 'pct_of_gop') continue;
    const stream = streamForMode(line.mode, revenue);
    const out = perLine[i];
    for (let t = start; t <= end; t++) {
      const factor = applyIndexation(1.0, t, line.indexation);
      let v = 0;
      switch (line.mode) {
        case 'fixed_baseline':
          v = Math.max(0, line.value) * factor;
          break;
        case 'per_room_year':
          v = Math.max(0, line.value) * Math.max(0, keys) * factor;
          break;
        case 'per_sqm_year':
          v = Math.max(0, line.value) * Math.max(0, leasableSqm) * factor;
          break;
        case 'pct_of_room_rev':
        case 'pct_of_fb_rev':
        case 'pct_of_other_rev':
        case 'pct_of_total_rev':
        case 'pct_of_lease_rev': {
          const rev = stream ? Math.max(0, stream[t] ?? 0) : 0;
          v = Math.max(0, line.value) * rev * factor;
          break;
        }
        default:
          v = 0;
      }
      out[t] = v;
    }
  }

  // Pass B: aggregate direct + indirect, derive GOP, then fill any
  // pct_of_gop lines (mgmt incentive in the default KPMG seed).
  const directCosts = zeros();
  const indirectCosts = zeros();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.disabled) continue;
    const isDirect = inCategory(line.category, DIRECT_CATEGORIES);
    const isIndirect = inCategory(line.category, INDIRECT_CATEGORIES);
    if (!isDirect && !isIndirect) continue;
    for (let t = 0; t < N; t++) {
      if (isDirect) directCosts[t] += perLine[i][t];
      else indirectCosts[t] += perLine[i][t];
    }
  }

  const gop = zeros();
  for (let t = 0; t < N; t++) {
    const tr = revenue.totalRevenuePerPeriod[t] ?? 0;
    gop[t] = tr - directCosts[t] - indirectCosts[t];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.disabled || line.mode !== 'pct_of_gop') continue;
    const out = perLine[i];
    for (let t = start; t <= end; t++) {
      const factor = applyIndexation(1.0, t, line.indexation);
      const base = Math.max(0, gop[t]);
      out[t] = Math.max(0, line.value) * base * factor;
    }
  }

  // Aggregate after Pass B so mgmt + other buckets include the
  // GOP-driven lines.
  const mgmt = zeros();
  const other = zeros();
  const total = zeros();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.disabled) continue;
    const isDirect = inCategory(line.category, DIRECT_CATEGORIES);
    const isIndirect = inCategory(line.category, INDIRECT_CATEGORIES);
    const isMgmt = inCategory(line.category, MGMT_CATEGORIES);
    for (let t = 0; t < N; t++) {
      const v = perLine[i][t];
      if (isMgmt) mgmt[t] += v;
      else if (!isDirect && !isIndirect) other[t] += v;
      total[t] += v;
    }
  }

  const gopMargin = zeros();
  const noi = zeros();
  for (let t = 0; t < N; t++) {
    const tr = revenue.totalRevenuePerPeriod[t] ?? 0;
    gopMargin[t] = tr > 0 ? gop[t] / tr : 0;
    noi[t] = tr - total[t];
  }

  return {
    assetId,
    perLinePerPeriod: perLine,
    directCostsPerPeriod: directCosts,
    indirectCostsPerPeriod: indirectCosts,
    managementFeePerPeriod: mgmt,
    otherOpexPerPeriod: other,
    totalOpexPerPeriod: total,
    gopPerPeriod: gop,
    gopMarginPerPeriod: gopMargin,
    noiPerPeriod: noi,
  };
}
