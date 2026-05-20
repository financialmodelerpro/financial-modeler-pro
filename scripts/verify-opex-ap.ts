/**
 * M4 Pass 2a — Accounts Payable (Opex) engine verifier.
 *
 * Methodology mirrors the DSO-driven AR builder in revenue:
 *   AP_closing[y] = OpexIncurred[y] × (dpo / 365)
 *   AP_opening[y] = AP_closing[y-1]    (opening[0] = 0)
 *   ΔAP[y]        = closing - opening
 *   CashPaid[y]   = OpexIncurred[y] - ΔAP[y]
 *
 * Sections:
 *   A — DPO = 0: cash paid = opex incurred (no AP carry)
 *   B — DPO = 365: full year's opex unpaid at year-end
 *   C — Mid-range DPO (60 days)
 *   D — Wash identity: sum(opex incurred) = sum(cash paid) + closing AP at end
 *   E — Roll-forward identity: opening[y] = closing[y-1]
 *   F — Custom daysPerYear basis
 *   G — Zero opex period — AP rolls down from prior carry
 */

import { buildAccountsPayable } from '@/src/core/calculations/opex';

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

console.log('=== M4 Pass 2a Accounts Payable verifier ===');

// ─────────────────────────────────────────────────────────────────────
// A — DPO = 0 → cash basis (no AP)
// ─────────────────────────────────────────────────────────────────────
console.log('\n[A] DPO = 0 (cash basis)');
{
  const opex = [0, 1_000_000, 1_200_000, 1_500_000, 0];
  const r = buildAccountsPayable({
    opexIncurredPerPeriod: opex,
    dpoDays: 0,
    axisLength: opex.length,
  });
  assertNear('A1: closing[0] = 0', r.perPeriod[0], 0);
  assertNear('A2: closing[2] = 0', r.perPeriod[2], 0);
  assertNear('A3: cash paid[1] = opex incurred[1] (1M)', r.cashPaidPerPeriod[1], 1_000_000);
  assertNear('A4: cash paid[3] = opex incurred[3] (1.5M)', r.cashPaidPerPeriod[3], 1_500_000);
}

// ─────────────────────────────────────────────────────────────────────
// B — DPO = 365 → all unpaid at year-end
// ─────────────────────────────────────────────────────────────────────
console.log('\n[B] DPO = 365 (entire year on the books)');
{
  const opex = [0, 1_000_000, 0, 0];
  const r = buildAccountsPayable({
    opexIncurredPerPeriod: opex,
    dpoDays: 365,
    axisLength: opex.length,
  });
  // closing[1] = 1,000,000 × 1.0 = 1,000,000
  assertNear('B1: closing[1] = 1M', r.perPeriod[1], 1_000_000);
  // cash paid[1] = 1M - (1M - 0) = 0 (full deferral)
  assertNear('B2: cash paid[1] = 0', r.cashPaidPerPeriod[1], 0);
  // Year 2: opex=0, opening AP = 1M, closing AP = 0 → cash paid = 1M
  assertNear('B3: closing[2] = 0 (opex drops to 0)', r.perPeriod[2], 0);
  assertNear('B4: cash paid[2] = 1M (clears opening AP)', r.cashPaidPerPeriod[2], 1_000_000);
}

// ─────────────────────────────────────────────────────────────────────
// C — Mid-range DPO (60 days)
// ─────────────────────────────────────────────────────────────────────
console.log('\n[C] DPO = 60 days');
{
  const opex = [0, 365_000, 730_000, 0];
  const r = buildAccountsPayable({
    opexIncurredPerPeriod: opex,
    dpoDays: 60,
    axisLength: opex.length,
  });
  // ratio = 60/365
  // closing[1] = 365k × 60/365 = 60k
  assertNear('C1: closing[1] = 60k', r.perPeriod[1], 60_000);
  // opening[1] = 0; change = 60k; paid = 365k - 60k = 305k
  assertNear('C2: cash paid[1] = 305k', r.cashPaidPerPeriod[1], 305_000);
  // closing[2] = 730k × 60/365 = 120k
  assertNear('C3: closing[2] = 120k', r.perPeriod[2], 120_000);
  // opening[2] = 60k; change = 60k; paid = 730k - 60k = 670k
  assertNear('C4: cash paid[2] = 670k', r.cashPaidPerPeriod[2], 670_000);
  // Year 3: opex=0, opening AP = 120k, closing AP = 0 → cash paid = 120k
  assertNear('C5: closing[3] = 0', r.perPeriod[3], 0);
  assertNear('C6: cash paid[3] = 120k (drains AP)', r.cashPaidPerPeriod[3], 120_000);
}

// ─────────────────────────────────────────────────────────────────────
// D — Wash identity: sum incurred = sum paid + final closing AP
// ─────────────────────────────────────────────────────────────────────
console.log('\n[D] Wash identity (sum incurred = sum paid + final AP)');
{
  const opex = [50_000, 100_000, 200_000, 150_000, 75_000, 0, 0];
  const r = buildAccountsPayable({
    opexIncurredPerPeriod: opex,
    dpoDays: 45,
    axisLength: opex.length,
  });
  const sumIncurred = opex.reduce((s, v) => s + v, 0);
  const sumPaid = r.cashPaidPerPeriod.reduce((s, v) => s + v, 0);
  const finalAp = r.perPeriod[r.perPeriod.length - 1];
  assertNear('D1: sum(incurred) = sum(paid) + final AP', sumIncurred, sumPaid + finalAp);
  // With opex tapering to 0 at the end, AP should fully drain
  assertNear('D2: final AP = 0 (opex tapered)', finalAp, 0);
}

// ─────────────────────────────────────────────────────────────────────
// E — Roll-forward identity: opening[y] = closing[y-1]
// ─────────────────────────────────────────────────────────────────────
console.log('\n[E] Roll-forward identity (opening = prior closing)');
{
  const opex = [100_000, 200_000, 300_000, 400_000];
  const r = buildAccountsPayable({
    opexIncurredPerPeriod: opex,
    dpoDays: 90,
    axisLength: opex.length,
  });
  assertNear('E1: opening[0] = 0', r.openingPerPeriod[0], 0);
  assertNear('E2: opening[1] = closing[0]', r.openingPerPeriod[1], r.perPeriod[0]);
  assertNear('E3: opening[2] = closing[1]', r.openingPerPeriod[2], r.perPeriod[1]);
  assertNear('E4: opening[3] = closing[2]', r.openingPerPeriod[3], r.perPeriod[2]);
}

// ─────────────────────────────────────────────────────────────────────
// F — Custom daysPerYear basis (e.g. 360-day year)
// ─────────────────────────────────────────────────────────────────────
console.log('\n[F] Custom daysPerYear (360)');
{
  const opex = [0, 360_000];
  const r = buildAccountsPayable({
    opexIncurredPerPeriod: opex,
    dpoDays: 60,
    daysPerYear: 360,
    axisLength: opex.length,
  });
  // closing[1] = 360k × 60/360 = 60k
  assertNear('F1: closing[1] = 60k (60/360 basis)', r.perPeriod[1], 60_000);
}

// ─────────────────────────────────────────────────────────────────────
// G — Zero opex year drains carry
// ─────────────────────────────────────────────────────────────────────
console.log('\n[G] Zero-opex year drains prior AP');
{
  const opex = [365_000, 0, 0];
  const r = buildAccountsPayable({
    opexIncurredPerPeriod: opex,
    dpoDays: 30,
    axisLength: opex.length,
  });
  // closing[0] = 365k × 30/365 = 30k
  assertNear('G1: closing[0] = 30k', r.perPeriod[0], 30_000);
  // closing[1] = 0; cash paid[1] = 0 - (0 - 30k) = 30k
  assertNear('G2: cash paid[1] = 30k (drain)', r.cashPaidPerPeriod[1], 30_000);
  // closing[2] = 0; cash paid[2] = 0
  assertNear('G3: cash paid[2] = 0 (already drained)', r.cashPaidPerPeriod[2], 0);
}

console.log(`\n--- AP verifier: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
