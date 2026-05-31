/**
 * Phase M-Versioning: snapshot-diff lib verifier (2026-05-31).
 *
 * Pure unit tests for src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff.ts
 * Covers the diff cases the session-based versioning system depends on:
 *
 *   A: identity (a === b)
 *   B: project meta (scalar key change)
 *   C: nested project field (recurse into project sub-object)
 *   D: id-keyed array add / remove / update
 *   E: scalar change on a nested asset / sub-unit / cost line
 *   F: costOverrides compound-key matching
 *   G: snapshot-with-array-of-numbers (preSalesVelocity) reports as
 *      a single update entry, not per-index entries
 *   H: snapshotsEqual mirrors deepEqual on JSON-serializable input
 *   I: null/undefined safety
 */

import { diffSnapshots, snapshotsEqual } from '@/src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff';
import { DEFAULT_MODULE1_STATE, type HydrateSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-store';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    failures.push(`${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    console.log(`  [FAIL] ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function assertCount(name: string, actual: number, expected: number): void {
  if (actual === expected) {
    pass++;
    console.log(`  [PASS] ${name} (count=${actual})`);
  } else {
    fail++;
    failures.push(`${name}: actual=${actual} expected=${expected}`);
    console.log(`  [FAIL] ${name}: actual=${actual} expected=${expected}`);
  }
}

function assertContains(name: string, actual: string, needle: string): void {
  if (actual.includes(needle)) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    failures.push(`${name}: "${needle}" not in "${actual}"`);
    console.log(`  [FAIL] ${name}: "${needle}" not in "${actual}"`);
  }
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

console.log('=== Phase M-Versioning: snapshot-diff verifier ===');

// ─────────────────────────────────────────────────────────────────────
// A: Identity — same snapshot diffed against itself is empty.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[A] Identity');
{
  const snap = deepClone(DEFAULT_MODULE1_STATE);
  const diff = diffSnapshots(snap, snap);
  assertCount('A1: self-diff is empty', diff.length, 0);
  const eq = snapshotsEqual(snap, snap);
  assertEq('A2: snapshotsEqual on same reference', eq, true);
}

// ─────────────────────────────────────────────────────────────────────
// B: Project meta scalar change.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[B] Project meta scalar change');
{
  const before = deepClone(DEFAULT_MODULE1_STATE);
  const after = deepClone(DEFAULT_MODULE1_STATE);
  after.project.name = 'Renamed Project';

  const diff = diffSnapshots(before, after);
  assertCount('B1: one entry for one field change', diff.length, 1);
  assertEq('B2: path is project.name', diff[0]?.path, 'project.name');
  assertEq('B3: before value', diff[0]?.before, before.project.name);
  assertEq('B4: after value', diff[0]?.after, 'Renamed Project');
  assertEq('B5: kind is update', diff[0]?.kind, 'update');
}

// ─────────────────────────────────────────────────────────────────────
// C: Nested project field recurse (e.g. project.startDate).
// ─────────────────────────────────────────────────────────────────────
console.log('\n[C] Project nested scalar change');
{
  const before = deepClone(DEFAULT_MODULE1_STATE);
  const after = deepClone(DEFAULT_MODULE1_STATE);
  after.project.startDate = '2030-01-01';
  const diff = diffSnapshots(before, after);
  assertCount('C1: one entry', diff.length, 1);
  assertEq('C2: path', diff[0]?.path, 'project.startDate');
  assertEq('C3: kind', diff[0]?.kind, 'update');
}

// ─────────────────────────────────────────────────────────────────────
// D: id-keyed array add / remove / update.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[D] id-keyed array operations');
{
  const before = deepClone(DEFAULT_MODULE1_STATE);
  // Add a new phase to "after".
  const after = deepClone(DEFAULT_MODULE1_STATE);
  after.phases = [...after.phases, {
    ...after.phases[0],
    id: 'phase_2',
    name: 'Phase 2',
    startDate: '2030-01-01',
  }];
  const diffAdd = diffSnapshots(before, after);
  assertCount('D1: one entry for add', diffAdd.length, 1);
  assertEq('D2: kind=add', diffAdd[0]?.kind, 'add');
  assertContains('D3: path includes phase_2 id', diffAdd[0]?.path ?? '', 'phase_2');
  assertContains('D4: label refers to phase', (diffAdd[0]?.label ?? '').toLowerCase(), 'phase 2');

  // Remove the original phase.
  const removed = deepClone(DEFAULT_MODULE1_STATE);
  const afterRemove = deepClone(removed);
  afterRemove.phases = [];
  const diffRemove = diffSnapshots(removed, afterRemove);
  assertCount('D5: one entry for remove', diffRemove.length, 1);
  assertEq('D6: kind=remove', diffRemove[0]?.kind, 'remove');

  // Update an existing phase scalar. Use constructionPeriods which
  // is present on the default phase (startDate is optional, so first
  // assignment would correctly classify as kind='add').
  const beforeUpd = deepClone(DEFAULT_MODULE1_STATE);
  const afterUpd = deepClone(DEFAULT_MODULE1_STATE);
  afterUpd.phases[0]!.constructionPeriods = 36;
  const diffUpd = diffSnapshots(beforeUpd, afterUpd);
  assertCount('D7: one entry for scalar update on existing element', diffUpd.length, 1);
  assertEq('D8: kind=update', diffUpd[0]?.kind, 'update');
  assertContains('D9: path includes phase id', diffUpd[0]?.path ?? '', beforeUpd.phases[0]!.id);
  assertContains('D10: path includes field name', diffUpd[0]?.path ?? '', 'constructionPeriods');

  // First-assignment of an OPTIONAL scalar correctly classifies as 'add'.
  const beforeOpt = deepClone(DEFAULT_MODULE1_STATE);
  const afterOpt = deepClone(DEFAULT_MODULE1_STATE);
  afterOpt.phases[0]!.startDate = '2031-01-01';
  const diffOpt = diffSnapshots(beforeOpt, afterOpt);
  assertEq('D11: optional first-assignment kind=add', diffOpt[0]?.kind, 'add');
}

// ─────────────────────────────────────────────────────────────────────
// E: Nested update on a synthetic asset.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[E] Nested asset update');
{
  const baseAsset = {
    id: 'asset_1',
    name: 'Test Tower',
    phaseId: 'phase_1',
    strategy: 'Sell',
    type: 'Residential',
    visible: true,
    revenue: { sell: { saleVelocityPct: 10 } },
  } as unknown as HydrateSnapshot['assets'][number];

  const before: HydrateSnapshot = deepClone(DEFAULT_MODULE1_STATE);
  before.assets = [baseAsset];
  const after: HydrateSnapshot = deepClone(before);
  (after.assets[0] as unknown as { revenue: { sell: { saleVelocityPct: number } } })
    .revenue.sell.saleVelocityPct = 15;

  const diff = diffSnapshots(before, after);
  assertCount('E1: one entry', diff.length, 1);
  assertContains('E2: path includes asset id', diff[0]?.path ?? '', 'asset_1');
  assertContains('E3: path drills into sell', diff[0]?.path ?? '', 'sell');
  assertContains('E4: path leaf is saleVelocityPct', diff[0]?.path ?? '', 'saleVelocityPct');
}

// ─────────────────────────────────────────────────────────────────────
// F: costOverrides compound-key matching.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[F] costOverrides compound key');
{
  const before = deepClone(DEFAULT_MODULE1_STATE);
  const after = deepClone(DEFAULT_MODULE1_STATE);
  after.costOverrides = [
    { assetId: 'asset_1', lineId: 'land_cash', overridden: true, value: 1000 } as unknown as HydrateSnapshot['costOverrides'][number],
  ];
  const diffAdd = diffSnapshots(before, after);
  assertCount('F1: one entry for add', diffAdd.length, 1);
  assertEq('F2: kind=add', diffAdd[0]?.kind, 'add');
  assertContains('F3: path uses compound key', diffAdd[0]?.path ?? '', 'asset_1::land_cash');

  // Update one field on an existing override.
  const beforeUpd = deepClone(after);
  const afterUpd = deepClone(after);
  (afterUpd.costOverrides[0] as unknown as { value: number }).value = 1500;
  const diffUpd = diffSnapshots(beforeUpd, afterUpd);
  assertCount('F4: one entry for scalar update', diffUpd.length, 1);
  assertEq('F5: kind=update', diffUpd[0]?.kind, 'update');
  assertContains('F6: path leaf is value', diffUpd[0]?.path ?? '', 'value');
}

// ─────────────────────────────────────────────────────────────────────
// G: array-of-numbers (e.g. preSalesVelocity) is one entry, not many.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[G] number[] leaf is one entry');
{
  const before = deepClone(DEFAULT_MODULE1_STATE);
  before.assets = [{
    id: 'asset_1',
    name: 'Tower',
    phaseId: 'phase_1',
    strategy: 'Sell',
    visible: true,
    revenue: { sell: { preSalesVelocityPctPerPeriod: [0, 10, 10, 10, 10] } },
  } as unknown as HydrateSnapshot['assets'][number]];
  const after = deepClone(before);
  (after.assets[0] as unknown as { revenue: { sell: { preSalesVelocityPctPerPeriod: number[] } } })
    .revenue.sell.preSalesVelocityPctPerPeriod = [0, 5, 15, 15, 15];

  const diff = diffSnapshots(before, after);
  assertCount('G1: array-leaf change is single entry', diff.length, 1);
  assertContains('G2: path leaf is the array field', diff[0]?.path ?? '', 'preSalesVelocityPctPerPeriod');
}

// ─────────────────────────────────────────────────────────────────────
// H: snapshotsEqual.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[H] snapshotsEqual');
{
  const a = deepClone(DEFAULT_MODULE1_STATE);
  const b = deepClone(DEFAULT_MODULE1_STATE);
  assertEq('H1: two structurally equal snapshots are equal', snapshotsEqual(a, b), true);
  b.project.name = 'differs';
  assertEq('H2: scalar change makes them unequal', snapshotsEqual(a, b), false);
}

// ─────────────────────────────────────────────────────────────────────
// I: null/undefined safety.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[I] null / undefined safety');
{
  const snap = deepClone(DEFAULT_MODULE1_STATE);
  const diffNullBefore = diffSnapshots(null, snap);
  assertCount('I1: null -> snap yields one root add entry', diffNullBefore.length, 1);
  assertEq('I2: kind=add', diffNullBefore[0]?.kind, 'add');

  const diffNullAfter = diffSnapshots(snap, null);
  assertCount('I3: snap -> null yields one root remove entry', diffNullAfter.length, 1);
  assertEq('I4: kind=remove', diffNullAfter[0]?.kind, 'remove');

  const bothNull = diffSnapshots(null, null);
  assertCount('I5: null -> null is empty', bothNull.length, 0);
}

// ─────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────
console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
