/**
 * Module 3 Opex engine verifier.
 *
 * Hospitality (KPMG-style hierarchy): direct % of dept rev,
 * indirect % of TR, mgmt base % of TR, tech per-key, mgmt incentive
 * % of GOP, replacement reserve % of TR, rent & insurance per-key.
 *
 * Lease: % of lease rev + per-sqm CAM / insurance + property tax %.
 *
 * HQ: fixed_baseline + pct_of_total_rev only.
 */

import {
  computeAssetOpex,
  computeHQOpex,
  defaultHospitalityOpexLines,
  defaultLeaseOpexLines,
  defaultHQOpexLines,
  defaultOpexIndexation,
} from '@/src/core/calculations/opex';
import type { OpexRevenueContext } from '@/src/core/calculations/opex';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assertNear(name: string, actual: number, expected: number, tol = 0.01): void {
  const delta = actual - expected;
  if (Math.abs(delta) <= tol) {
    pass++;
    console.log(`  [PASS] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  } else {
    fail++;
    failures.push(`${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
    console.log(`  [FAIL] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  }
}

function zeros(n: number): number[] { return new Array<number>(n).fill(0); }

console.log('=== Module 3 Opex verifier ===');

// ─────────────────────────────────────────────────────────────────────
// A-series: Hospitality engine basics
// 100 keys, 365 days, 60% occupancy, ADR 1000 => Room rev = 21,900,000
// F&B 30% of room => 6,570,000; Other 10% of room => 2,190,000
// TR = 30,660,000 (for any year inside ops window)
// ─────────────────────────────────────────────────────────────────────
const N = 12;
const opsStart = 4;
const opsEnd = 11;
const roomRev = 100 * 365 * 0.60 * 1000;       // 21,900,000
const fbRev = roomRev * 0.30;                   // 6,570,000
const otherRev = roomRev * 0.10;                // 2,190,000
const totalRev = roomRev + fbRev + otherRev;    // 30,660,000

function makeRev(streamFn: (t: number) => { r: number; f: number; o: number; tr: number; l: number }): OpexRevenueContext {
  const room = zeros(N);
  const fb = zeros(N);
  const other = zeros(N);
  const tr = zeros(N);
  const lease = zeros(N);
  for (let t = 0; t < N; t++) {
    const v = streamFn(t);
    room[t] = v.r;
    fb[t] = v.f;
    other[t] = v.o;
    tr[t] = v.tr;
    lease[t] = v.l;
  }
  return { roomRevenuePerPeriod: room, fbRevenuePerPeriod: fb, otherRevenuePerPeriod: other, totalRevenuePerPeriod: tr, leaseRevenuePerPeriod: lease };
}

const hospRev = makeRev((t) => (t >= opsStart && t <= opsEnd)
  ? { r: roomRev, f: fbRev, o: otherRev, tr: totalRev, l: 0 }
  : { r: 0, f: 0, o: 0, tr: 0, l: 0 });

const hospLines = defaultHospitalityOpexLines();
const hospResult = computeAssetOpex({
  assetId: 'h1',
  strategy: 'Hospitality',
  lines: hospLines,
  defaultIndexation: defaultOpexIndexation(),
  keys: 100,
  leasableSqm: 0,
  opsStartIdx: opsStart,
  opsEndIdx: opsEnd,
  axisLength: N,
  revenue: hospRev,
});

// Index lines by category for direct assertion
const lineIdxByCat: Record<string, number> = {};
hospLines.forEach((l, i) => { lineIdxByCat[l.category] = i; });

// A1: Rooms direct = 25% of room rev
assertNear('A1: Rooms direct = 25% × 21,900,000 = 5,475,000',
  hospResult.perLinePerPeriod[lineIdxByCat.direct_rooms][opsStart], 0.25 * roomRev, 1);

// A2: F&B direct = 65% of F&B rev
assertNear('A2: F&B direct = 65% × 6,570,000 = 4,270,500',
  hospResult.perLinePerPeriod[lineIdxByCat.direct_fb][opsStart], 0.65 * fbRev, 1);

// A3: Other direct = 50% of other rev
assertNear('A3: Other direct = 50% × 2,190,000 = 1,095,000',
  hospResult.perLinePerPeriod[lineIdxByCat.direct_other][opsStart], 0.50 * otherRev, 1);

// A4: G&A = 8% of TR
assertNear('A4: G&A = 8% × 30,660,000 = 2,452,800',
  hospResult.perLinePerPeriod[lineIdxByCat.indirect_ga][opsStart], 0.08 * totalRev, 1);

// A5: Tech fee = 1200 × 100 keys × (1.03 ^ opsStart) (yoy_compound 3% from startYear 0)
const a5Factor = Math.pow(1.03, opsStart);
assertNear(`A5: Tech fee at opsStart = 1200 × 100 × 1.03^${opsStart}`,
  hospResult.perLinePerPeriod[lineIdxByCat.mgmt_tech][opsStart], 1200 * 100 * a5Factor, 1);

// A6: Direct costs aggregate
assertNear('A6: Direct costs = rooms + F&B + other',
  hospResult.directCostsPerPeriod[opsStart],
  0.25 * roomRev + 0.65 * fbRev + 0.50 * otherRev,
  1);

// A7: Indirect costs aggregate = 8% + 2% + 6% + 4% + 4% + 1% = 25% of TR
assertNear('A7: Indirect costs = 25% × 30,660,000 = 7,665,000',
  hospResult.indirectCostsPerPeriod[opsStart], 0.25 * totalRev, 1);

// A8: GOP = TR - Direct - Indirect
const expDirect = 0.25 * roomRev + 0.65 * fbRev + 0.50 * otherRev;
const expIndirect = 0.25 * totalRev;
const expGOP = totalRev - expDirect - expIndirect;
assertNear('A8: GOP = TR - Direct - Indirect', hospResult.gopPerPeriod[opsStart], expGOP, 1);

// A9: Mgmt incentive = 8% of GOP (resolved Pass B)
assertNear('A9: Mgmt incentive = 8% × GOP',
  hospResult.perLinePerPeriod[lineIdxByCat.mgmt_incentive][opsStart], 0.08 * expGOP, 1);

// A10: Outside ops window = 0
assertNear('A10: Before ops window, rooms direct = 0',
  hospResult.perLinePerPeriod[lineIdxByCat.direct_rooms][0], 0, 0.001);
assertNear('A10b: Before ops window (index opsStart-1), rooms direct = 0',
  hospResult.perLinePerPeriod[lineIdxByCat.direct_rooms][opsStart - 1], 0, 0.001);

// A11: NOI = TR - Total Opex
const expTotalOpex = hospResult.totalOpexPerPeriod[opsStart];
assertNear('A11: NOI = TR - Total Opex',
  hospResult.noiPerPeriod[opsStart], totalRev - expTotalOpex, 1);

// A12: GOP margin in [0, 1] when revenue is positive
const margin = hospResult.gopMarginPerPeriod[opsStart];
if (margin >= 0 && margin <= 1) { pass++; console.log(`  [PASS] A12: GOP margin in [0,1]: ${(margin*100).toFixed(1)}%`); }
else { fail++; failures.push('A12: GOP margin out of range'); console.log(`  [FAIL] A12: ${margin}`); }

// ─────────────────────────────────────────────────────────────────────
// B-series: Lease engine
// ─────────────────────────────────────────────────────────────────────
const leaseRev = 5_000_000;
const leasableSqm = 5000;
const leaseCtx = makeRev((t) => (t >= opsStart && t <= opsEnd)
  ? { r: 0, f: 0, o: 0, tr: leaseRev, l: leaseRev }
  : { r: 0, f: 0, o: 0, tr: 0, l: 0 });

const leaseLines = defaultLeaseOpexLines();
const leaseResult = computeAssetOpex({
  assetId: 'r1',
  strategy: 'Lease',
  lines: leaseLines,
  defaultIndexation: defaultOpexIndexation(),
  keys: 0,
  leasableSqm,
  opsStartIdx: opsStart,
  opsEndIdx: opsEnd,
  axisLength: N,
  revenue: leaseCtx,
});

const leaseIdx: Record<string, number> = {};
leaseLines.forEach((l, i) => { leaseIdx[l.category] = i; });

// B1: Property mgmt fee = 3% of lease rev
assertNear('B1: Property mgmt fee = 3% × 5,000,000 = 150,000',
  leaseResult.perLinePerPeriod[leaseIdx.mgmt_base][opsStart], 0.03 * leaseRev, 1);

// B2: CAM = 50 × 5000 sqm × inflation factor at opsStart
const bFactor = Math.pow(1.03, opsStart);
assertNear(`B2: CAM at opsStart = 50 × 5000 × 1.03^${opsStart}`,
  leaseResult.perLinePerPeriod[leaseIdx.cam][opsStart], 50 * leasableSqm * bFactor, 1);

// B3: Property tax = 1.5% of lease rev (no indexation)
assertNear('B3: Property tax = 1.5% × 5,000,000 = 75,000',
  leaseResult.perLinePerPeriod[leaseIdx.property_tax][opsStart], 0.015 * leaseRev, 1);

// B4: Insurance per sqm = 10 × 5000 × inflation factor at opsStart
assertNear(`B4: Insurance at opsStart = 10 × 5000 × 1.03^${opsStart}`,
  leaseResult.perLinePerPeriod[leaseIdx.rent_insurance][opsStart], 10 * leasableSqm * bFactor, 1);

// B5: Total opex (mix of indexed + non-indexed)
const expLeaseTotal = 0.03 * leaseRev + 50 * leasableSqm * bFactor + 0.02 * leaseRev + 10 * leasableSqm * bFactor + 0.015 * leaseRev;
assertNear('B5: Lease total opex at opsStart',
  leaseResult.totalOpexPerPeriod[opsStart], expLeaseTotal, 1);

// B6: No lease keys means per_room_year lines stay 0, sanity check
const stray = leaseLines.findIndex((l) => l.mode === 'per_room_year');
if (stray < 0) { pass++; console.log('  [PASS] B6: Lease defaults contain no per_room_year lines'); }
else { fail++; failures.push('B6: stray per_room_year in lease defaults'); console.log('  [FAIL] B6'); }

// ─────────────────────────────────────────────────────────────────────
// C-series: Indexation compounding
// ─────────────────────────────────────────────────────────────────────
// Use the tech fee (per_room_year + yoy_compound 3%). Year-over-year:
// year 0 (project axis) = 1200 * 100 = 120,000; year 1 = 120,000 * 1.03
const techIdx = lineIdxByCat.mgmt_tech;
// Compare opsStart+1 vs opsStart. Inflation startYear default = 0 so
// (opsStart - 0) is the exponent. Year opsStart+1 / Year opsStart =
// 1.03 regardless of where opsStart sits on the axis.
const ratio = hospResult.perLinePerPeriod[techIdx][opsStart + 1]
  / hospResult.perLinePerPeriod[techIdx][opsStart];
assertNear('C1: Tech fee year-over-year ratio = 1.03 (yoy_compound 3%)',
  ratio, 1.03, 0.001);

// ─────────────────────────────────────────────────────────────────────
// D-series: Disabled line stays zero, doesn't impact GOP
// ─────────────────────────────────────────────────────────────────────
const disabledLines = defaultHospitalityOpexLines();
const itLineIdx = disabledLines.findIndex((l) => l.category === 'indirect_it');
disabledLines[itLineIdx] = { ...disabledLines[itLineIdx], disabled: true };
const disabledResult = computeAssetOpex({
  assetId: 'h2',
  strategy: 'Hospitality',
  lines: disabledLines,
  defaultIndexation: defaultOpexIndexation(),
  keys: 100,
  leasableSqm: 0,
  opsStartIdx: opsStart,
  opsEndIdx: opsEnd,
  axisLength: N,
  revenue: hospRev,
});
assertNear('D1: Disabled line = 0',
  disabledResult.perLinePerPeriod[itLineIdx][opsStart], 0, 0.001);
// Indirect drops by IT contribution (2% of TR)
const drop = hospResult.indirectCostsPerPeriod[opsStart] - disabledResult.indirectCostsPerPeriod[opsStart];
assertNear('D2: Disabled IT drops indirect by 2% × TR',
  drop, 0.02 * totalRev, 1);

// ─────────────────────────────────────────────────────────────────────
// E-series: HQ engine
// ─────────────────────────────────────────────────────────────────────
const hqLines = defaultHQOpexLines();
const projectTR = new Array<number>(N).fill(0);
for (let t = opsStart; t <= opsEnd; t++) projectTR[t] = totalRev;
const hqResult = computeHQOpex({
  lines: hqLines,
  defaultIndexation: defaultOpexIndexation(),
  axisLength: N,
  projectTotalRevenuePerPeriod: projectTR,
});
const hqIdx: Record<string, number> = {};
hqLines.forEach((l, i) => { hqIdx[l.category] = i; });

// E1: Payroll baseline (year 0 inflation factor = 1)
assertNear('E1: HQ payroll (year 0) = 5,000,000',
  hqResult.perLinePerPeriod[hqIdx.hq_payroll][0], 5_000_000, 1);
// E2: pct_of_total_rev on the other line
assertNear('E2: HQ Other = 0.5% of TR inside ops window',
  hqResult.perLinePerPeriod[hqIdx.hq_other][opsStart], 0.005 * totalRev, 1);
// E3: pct_of_total_rev = 0 outside revenue years
assertNear('E3: HQ Other = 0 outside revenue years',
  hqResult.perLinePerPeriod[hqIdx.hq_other][0], 0, 0.001);
// E4: HQ total at ops year = sum of all 4 lines
const e4 = 5_000_000 + 1_500_000 + 800_000 + 0.005 * totalRev;
assertNear('E4: HQ total opex (year 0 of axis, ops year)',
  hqResult.totalOpexPerPeriod[opsStart],
  // Index 0 of axis is t=0 (factor=1); ops start is at opsStart so the
  // fixed lines compound from year 0 forward. Use the inflation factor.
  (5_000_000 + 1_500_000 + 800_000) * Math.pow(1.03, opsStart) + 0.005 * totalRev,
  1);

// ─────────────────────────────────────────────────────────────────────
// F-series: Pass 3 (2026-05-19) inflation rules
//   F1: %-of-revenue line ignores any line.indexation it carries
//   F2: pct_of_gop line ignores any line.indexation it carries
//   F3: fixed-cost line with useAssetDefault !== false uses asset
//       default (even when line.indexation is 'none')
//   F4: fixed-cost line with useAssetDefault === false uses its own
//       indexation, ignoring the asset default
//   F5: HQ fixed_baseline line inherits HQ defaultIndexation
//   F6: HQ pct_of_total_rev line ignores any per-line indexation
// ─────────────────────────────────────────────────────────────────────

// F1: %-of-rev line carries a 99% YoY indexation but engine MUST ignore it.
const f1Rev = makeRev((t) => (t >= opsStart && t <= opsEnd)
  ? { r: 0, f: 0, o: 0, tr: 1_000_000, l: 0 }
  : { r: 0, f: 0, o: 0, tr: 0, l: 0 });
const f1Result = computeAssetOpex({
  assetId: 'f1',
  strategy: 'Hospitality',
  lines: [{
    id: 'L1', name: 'noisy %', category: 'indirect_ga', mode: 'pct_of_total_rev',
    value: 0.1, indexation: { method: 'yoy_compound', rate: 0.99, startYear: 0 },
  }],
  keys: 0,
  leasableSqm: 0,
  opsStartIdx: opsStart,
  opsEndIdx: opsEnd,
  axisLength: N,
  revenue: f1Rev,
});
assertNear('F1: %-of-rev ignores line.indexation (no compounding)',
  f1Result.perLinePerPeriod[0][opsEnd], 0.1 * 1_000_000, 1);

// F2: pct_of_gop ignores any per-line indexation.
const f2Rev = makeRev((t) => (t >= opsStart && t <= opsEnd)
  ? { r: 0, f: 0, o: 0, tr: 1_000_000, l: 0 }
  : { r: 0, f: 0, o: 0, tr: 0, l: 0 });
const f2Result = computeAssetOpex({
  assetId: 'f2',
  strategy: 'Hospitality',
  lines: [{
    id: 'L1', name: 'mgmt inc', category: 'mgmt_incentive', mode: 'pct_of_gop',
    value: 0.1, indexation: { method: 'yoy_compound', rate: 0.5, startYear: 0 },
  }],
  keys: 0,
  leasableSqm: 0,
  opsStartIdx: opsStart,
  opsEndIdx: opsEnd,
  axisLength: N,
  revenue: f2Rev,
});
// GOP = 1,000,000 (no direct/indirect lines), mgmt incentive = 10% of GOP
// each year, with NO compounding.
assertNear('F2: pct_of_gop ignores line.indexation',
  f2Result.perLinePerPeriod[0][opsEnd], 0.1 * 1_000_000, 1);

// F3: fixed-cost line inherits asset default.
const f3Result = computeAssetOpex({
  assetId: 'f3',
  strategy: 'Hospitality',
  lines: [{
    id: 'L1', name: 'baseline', category: 'other', mode: 'fixed_baseline',
    value: 100_000, indexation: { method: 'none' }, useAssetDefault: true,
  }],
  defaultIndexation: { method: 'yoy_compound', rate: 0.05, startYear: 0 },
  keys: 0,
  leasableSqm: 0,
  opsStartIdx: opsStart,
  opsEndIdx: opsEnd,
  axisLength: N,
  revenue: makeRev(() => ({ r: 0, f: 0, o: 0, tr: 0, l: 0 })),
});
assertNear('F3: fixed_baseline inherits asset default (5% compound)',
  f3Result.perLinePerPeriod[0][opsStart + 2],
  100_000 * Math.pow(1.05, opsStart + 2),
  1);

// F4: per-line override beats asset default.
const f4Result = computeAssetOpex({
  assetId: 'f4',
  strategy: 'Hospitality',
  lines: [{
    id: 'L1', name: 'baseline', category: 'other', mode: 'fixed_baseline',
    value: 100_000,
    indexation: { method: 'yoy_compound', rate: 0.10, startYear: 0 },
    useAssetDefault: false,
  }],
  defaultIndexation: { method: 'yoy_compound', rate: 0.05, startYear: 0 },
  keys: 0,
  leasableSqm: 0,
  opsStartIdx: opsStart,
  opsEndIdx: opsEnd,
  axisLength: N,
  revenue: makeRev(() => ({ r: 0, f: 0, o: 0, tr: 0, l: 0 })),
});
assertNear('F4: override beats default (10% compound, not 5%)',
  f4Result.perLinePerPeriod[0][opsStart + 2],
  100_000 * Math.pow(1.10, opsStart + 2),
  1);

// F5: HQ fixed_baseline inherits HQ defaultIndexation.
const f5HQResult = computeHQOpex({
  lines: [{
    id: 'L1', name: 'payroll', category: 'hq_payroll', mode: 'fixed_baseline',
    value: 1_000_000, indexation: { method: 'none' }, useAssetDefault: true,
  }],
  defaultIndexation: { method: 'yoy_compound', rate: 0.04, startYear: 0 },
  axisLength: N,
  projectTotalRevenuePerPeriod: zeros(N),
});
assertNear('F5: HQ fixed_baseline inherits HQ default (4% compound)',
  f5HQResult.perLinePerPeriod[0][3],
  1_000_000 * Math.pow(1.04, 3),
  1);

// F6: HQ pct_of_total_rev never indexes.
const f6TR = zeros(N);
for (let t = opsStart; t <= opsEnd; t++) f6TR[t] = 2_000_000;
const f6HQResult = computeHQOpex({
  lines: [{
    id: 'L1', name: 'other', category: 'hq_other', mode: 'pct_of_total_rev',
    value: 0.10, indexation: { method: 'yoy_compound', rate: 0.99, startYear: 0 },
  }],
  defaultIndexation: { method: 'yoy_compound', rate: 0.04, startYear: 0 },
  axisLength: N,
  projectTotalRevenuePerPeriod: f6TR,
});
assertNear('F6: HQ pct_of_total_rev ignores line + HQ indexation',
  f6HQResult.perLinePerPeriod[0][opsEnd], 0.10 * 2_000_000, 1);

// ─────────────────────────────────────────────────────────────────────
// Done
// ─────────────────────────────────────────────────────────────────────
console.log(`\n--- Opex verifier: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
