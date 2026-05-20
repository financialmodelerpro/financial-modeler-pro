/**
 * M2 Pass 9h — Pre-Sales Escrow engine verifier.
 *
 * Methodology mirrors the reference Cashflow v1.16 Escrow tab:
 *   - Held[t]    = preSalesCash[t] x heldPct
 *   - Release[t] = sum(held[0..releaseYearIdx]) lump on releaseYearIdx
 *   - Balance[t] = cumulative (held - release), clamped >= 0
 *   - CF adj[t]  = release[t] - held[t]
 *
 * Sections:
 *   A — engine zeros when heldPct = 0 (escrow disabled)
 *   B — held = preSalesCash x heldPct per period
 *   C — release lumps on the configured release year
 *   D — cumulative balance falls to zero after release
 *   E — totals: totalHeld = totalReleased (escrow is a wash)
 *   F — CF adjustment sign (negative during hold, positive on release)
 *   G — releaseYearIdx beyond the held window still releases the
 *       cumulative-to-that-period balance
 *   H — heldUntilIdx: pre-sales cash arriving AFTER heldUntilIdx is
 *       not withheld; release lump = sum of held through heldUntilIdx
 */

import { computeEscrow } from '@/src/core/calculations/revenue';

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

console.log('=== M2 Pass 9h Escrow verifier ===');

// ─────────────────────────────────────────────────────────────────────
// A — heldPct = 0 → all zeros
// ─────────────────────────────────────────────────────────────────────
console.log('\n[A] Disabled escrow (heldPct = 0)');
{
  const r = computeEscrow({
    axisLength: 10,
    heldPct: 0,
    releaseYearIdx: 5,
    preSalesCashPerPeriod: [0, 100, 200, 300, 400, 500, 0, 0, 0, 0],
  });
  assertNear('A1: total held = 0', r.totalHeld, 0);
  assertNear('A2: total released = 0', r.totalReleased, 0);
  assertNear('A3: any balance non-zero',
    r.cumulativeBalancePerPeriod.reduce((s, v) => s + v, 0), 0);
}

// ─────────────────────────────────────────────────────────────────────
// B — Held math: 4% of pre-sales cash per period
// ─────────────────────────────────────────────────────────────────────
console.log('\n[B] Held = pre-sales cash × heldPct');
{
  const cash = [0, 100_000, 200_000, 300_000, 400_000, 500_000, 0, 0];
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.04,
    releaseYearIdx: 6,
    preSalesCashPerPeriod: cash,
  });
  // Held per period checks
  assertNear('B1: held[0] = 0 × 4% = 0', r.heldPerPeriod[0], 0);
  assertNear('B2: held[1] = 100k × 4% = 4k', r.heldPerPeriod[1], 4_000);
  assertNear('B3: held[2] = 200k × 4% = 8k', r.heldPerPeriod[2], 8_000);
  assertNear('B4: held[3] = 300k × 4% = 12k', r.heldPerPeriod[3], 12_000);
  assertNear('B5: held[4] = 400k × 4% = 16k', r.heldPerPeriod[4], 16_000);
  assertNear('B6: held[5] = 500k × 4% = 20k', r.heldPerPeriod[5], 20_000);
  // Cumulative held through release year (incl) = 60k
  assertNear('B7: total held = 60k', r.totalHeld, 60_000);
}

// ─────────────────────────────────────────────────────────────────────
// C — Release lump on the configured release year
// ─────────────────────────────────────────────────────────────────────
console.log('\n[C] Release lump on releaseYearIdx');
{
  const cash = [0, 100_000, 200_000, 300_000, 400_000, 500_000, 0, 0];
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.04,
    releaseYearIdx: 6,
    preSalesCashPerPeriod: cash,
  });
  assertNear('C1: release[5] (pre-release) = 0', r.releasePerPeriod[5], 0);
  assertNear('C2: release[6] = cum held through 6 = 60k', r.releasePerPeriod[6], 60_000);
  assertNear('C3: release[7] (post-release) = 0', r.releasePerPeriod[7], 0);
  // Total released = total held (wash)
  assertNear('C4: total released = total held', r.totalReleased, r.totalHeld);
}

// ─────────────────────────────────────────────────────────────────────
// D — Cumulative balance roll-forward + reset on release
// ─────────────────────────────────────────────────────────────────────
console.log('\n[D] Cumulative locked balance');
{
  const cash = [0, 100_000, 200_000, 300_000, 400_000, 500_000, 0, 0];
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.04,
    releaseYearIdx: 6,
    preSalesCashPerPeriod: cash,
  });
  // Cumulative balance: 0, 4k, 12k, 24k, 40k, 60k, 0 (released), 0
  assertNear('D1: bal[0] = 0', r.cumulativeBalancePerPeriod[0], 0);
  assertNear('D2: bal[1] = 4k', r.cumulativeBalancePerPeriod[1], 4_000);
  assertNear('D3: bal[2] = 12k', r.cumulativeBalancePerPeriod[2], 12_000);
  assertNear('D4: bal[3] = 24k', r.cumulativeBalancePerPeriod[3], 24_000);
  assertNear('D5: bal[4] = 40k', r.cumulativeBalancePerPeriod[4], 40_000);
  assertNear('D6: bal[5] = 60k', r.cumulativeBalancePerPeriod[5], 60_000);
  assertNear('D7: bal[6] (release year) = 0', r.cumulativeBalancePerPeriod[6], 0);
  assertNear('D8: bal[7] (post-release) = 0', r.cumulativeBalancePerPeriod[7], 0);
}

// ─────────────────────────────────────────────────────────────────────
// E — Totals identity: total held = total released
// ─────────────────────────────────────────────────────────────────────
console.log('\n[E] Wash identity (total held = total released)');
{
  // Random schedule
  const cash = [50_000, 100_000, 75_000, 0, 200_000, 150_000, 0, 0, 0];
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.05,
    releaseYearIdx: 8,
    preSalesCashPerPeriod: cash,
  });
  const expectedHeld = cash.reduce((s, v) => s + v * 0.05, 0);
  assertNear('E1: total held = sum(cash × 0.05)', r.totalHeld, expectedHeld);
  assertNear('E2: total released = total held', r.totalReleased, r.totalHeld);
}

// ─────────────────────────────────────────────────────────────────────
// F — Cash flow adjustment sign
// ─────────────────────────────────────────────────────────────────────
console.log('\n[F] CF adjustment = release − held');
{
  const cash = [0, 100_000, 200_000, 300_000, 0, 0];
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.04,
    releaseYearIdx: 4,
    preSalesCashPerPeriod: cash,
  });
  // adj[0] = 0 - 0 = 0
  assertNear('F1: adj[0] = 0', r.cashFlowAdjustmentPerPeriod[0], 0);
  // adj[1] = 0 - 4000 = -4000 (negative; cash deducted)
  assertNear('F2: adj[1] = -4000 (held only)', r.cashFlowAdjustmentPerPeriod[1], -4_000);
  // adj[3] = 0 - 12000 = -12000
  assertNear('F3: adj[3] = -12000 (held only)', r.cashFlowAdjustmentPerPeriod[3], -12_000);
  // adj[4] = 24000 - 0 = 24000 (positive; release lump)
  assertNear('F4: adj[4] = +24000 (release lump)', r.cashFlowAdjustmentPerPeriod[4], 24_000);
  // Sum of adj = 0 (wash)
  const sumAdj = r.cashFlowAdjustmentPerPeriod.reduce((s, v) => s + v, 0);
  assertNear('F5: sum(adj) = 0 (wash over axis)', sumAdj, 0);
}

// ─────────────────────────────────────────────────────────────────────
// G — releaseYearIdx beyond cash window
// ─────────────────────────────────────────────────────────────────────
console.log('\n[G] Release year clamped to axis');
{
  const cash = [0, 100_000, 200_000, 0, 0];
  // Try releaseYearIdx = 100 (way beyond axisLength = 5)
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.04,
    releaseYearIdx: 100,
    preSalesCashPerPeriod: cash,
  });
  // Engine clamps to last axis idx = 4
  assertNear('G1: release lump at last axis idx', r.releasePerPeriod[4], 12_000);
  // Balance returns to 0
  assertNear('G2: final balance = 0', r.cumulativeBalancePerPeriod[4], 0);
}

// ─────────────────────────────────────────────────────────────────────
// H — heldUntilIdx: hold window stops at construction end by default
// ─────────────────────────────────────────────────────────────────────
console.log('\n[H] heldUntilIdx caps the hold window');
{
  // Cash flows through year 7 (e.g. handover-year pickup + a stray
  // operating-year pre-sale catch-up). With heldUntilIdx = 4 (handover
  // year = end of construction), only [0..4] should be withheld.
  const cash = [0, 100_000, 200_000, 300_000, 400_000, 0, 0, 50_000];
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.04,
    releaseYearIdx: 5,
    heldUntilIdx: 4,
    preSalesCashPerPeriod: cash,
  });
  // Held inside the window
  assertNear('H1: held[1] = 100k × 4% = 4k', r.heldPerPeriod[1], 4_000);
  assertNear('H2: held[4] (handover) = 400k × 4% = 16k', r.heldPerPeriod[4], 16_000);
  // Held outside the window (operating years): zero
  assertNear('H3: held[5] (post-construction) = 0', r.heldPerPeriod[5], 0);
  assertNear('H4: held[7] (operating catch-up) = 0 — NOT 50k × 4%', r.heldPerPeriod[7], 0);
  // Total held = 4k+8k+12k+16k = 40k (NOT 42k that includes the operating cash)
  assertNear('H5: totalHeld = 40k (only construction-window cash)', r.totalHeld, 40_000);
  // Release lump = totalHeld on releaseYearIdx
  assertNear('H6: release[5] = 40k', r.releasePerPeriod[5], 40_000);
  // Wash still holds
  assertNear('H7: totalReleased = totalHeld', r.totalReleased, r.totalHeld);
  // CF adj sum across axis = 0 (wash)
  const sumAdj = r.cashFlowAdjustmentPerPeriod.reduce((s, v) => s + v, 0);
  assertNear('H8: sum(CF adj) = 0', sumAdj, 0);
}

// ─────────────────────────────────────────────────────────────────────
// I — heldUntilIdx omitted: legacy behaviour (withhold over full axis)
// ─────────────────────────────────────────────────────────────────────
console.log('\n[I] heldUntilIdx undefined → full-axis hold (legacy)');
{
  const cash = [0, 100_000, 0, 0, 0, 50_000];  // post-construction inflow
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.10,
    releaseYearIdx: 5,
    preSalesCashPerPeriod: cash,
    // heldUntilIdx intentionally omitted
  });
  assertNear('I1: held[1] = 10k', r.heldPerPeriod[1], 10_000);
  assertNear('I2: held[5] = 5k (legacy, no cap)', r.heldPerPeriod[5], 5_000);
  assertNear('I3: totalHeld = 15k', r.totalHeld, 15_000);
}

// ─────────────────────────────────────────────────────────────────────
// J — heldUntilIdx > releaseYearIdx: release still fires on its year
// ─────────────────────────────────────────────────────────────────────
console.log('\n[J] heldUntilIdx after releaseYearIdx');
{
  // Held window runs through idx 7, but release fires on idx 4. Only the
  // amount held by idx 4 releases (later held amounts continue to sit on
  // the books until exit; the engine does not model a second release).
  const cash = [0, 100_000, 200_000, 300_000, 0, 100_000, 100_000, 0];
  const r = computeEscrow({
    axisLength: cash.length,
    heldPct: 0.10,
    releaseYearIdx: 4,
    heldUntilIdx: 7,
    preSalesCashPerPeriod: cash,
  });
  // Release[4] = cum held through idx 4 = 10k+20k+30k+0 = 60k
  assertNear('J1: release[4] = 60k (cum through release year)', r.releasePerPeriod[4], 60_000);
  // Held after release still accrues
  assertNear('J2: held[5] = 10k (still within hold window)', r.heldPerPeriod[5], 10_000);
  assertNear('J3: held[6] = 10k', r.heldPerPeriod[6], 10_000);
  // Final balance = held[5] + held[6] still on the books (no second release)
  assertNear('J4: final balance = 20k (unreleased late holds)', r.cumulativeBalancePerPeriod[7], 20_000);
}

console.log(`\n--- Escrow verifier: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
