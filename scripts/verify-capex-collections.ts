/**
 * verify-capex-collections.ts (2026-08-16)
 *
 * A cost line that follows collections must phase THE SAME WAY everywhere.
 *
 * Before this pass, exactly ONE of the reachable `computeAssetCost` call sites
 * passed a collections series: the financials resolver. Every other path (the
 * financing capex aggregate, the capex and CoS report builders, fixed assets,
 * and three module screens) left such a line on its own curve. Totals agreed,
 * because phasing cannot move a total, so nothing looked wrong: the screen and
 * the export simply disagreed about WHEN the money moved.
 *
 * Section A is a source scan, because that is the only thing that catches a
 * NEW call site added later without the input. Section B proves the phasing
 * actually differs when collections are supplied, so the scan is guarding
 * something real rather than a no-op.
 *
 * Run: npx tsx scripts/verify-capex-collections.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { computeAssetCost } from '../src/core/calculations';
import { collectionsForAsset, collectionsForAssetAtOffset } from '../src/core/calculations/capexPhasing';
import {
  makeDefaultPhase, makeDefaultProject, makeBlankCostLines,
  type Asset, type CostLine, type SubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// ── A. EVERY REACHABLE CALL SITE PASSES COLLECTIONS ────────────────────────
//
// Each entry is a file that calls computeAssetCost, with why it does or does
// not need the series. A new call site that does neither fails A1.
const SITES: Array<{ file: string; wired: boolean; why: string }> = [
  { file: 'src/core/calculations/index.ts', wired: false,
    why: 'computePhaseCost: an internal rollup whose caller already resolved phasing' },
  { file: 'src/core/calculations/financing/capex.ts', wired: true, why: 'financing capex schedule' },
  { file: 'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts', wired: true, why: 'the model' },
  { file: 'src/hubs/modeling/platforms/refm/lib/reports/capexReports.ts', wired: true, why: 'capex report + exports' },
  { file: 'src/hubs/modeling/platforms/refm/lib/reports/cosReports.ts', wired: true, why: 'cost of sales report' },
  { file: 'src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts', wired: true, why: 'capitalised capex drives depreciation' },
  { file: 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', wired: true, why: 'the Capex screen' },
  { file: 'src/hubs/modeling/platforms/refm/components/modules/Module2CostOfSales.tsx', wired: true, why: 'CoS screen' },
  { file: 'src/hubs/modeling/platforms/refm/components/modules/Module2Schedules.tsx', wired: true, why: 'schedules screen' },
  { file: 'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts', wired: false,
    why: 'computeAssetCapex reads .total only, and phasing cannot move a total' },
  { file: 'src/hubs/modeling/platforms/refm/lib/financing-hooks.ts', wired: false,
    why: 'DEAD CODE: createFinancingHooks is imported nowhere' },
];

/**
 * Does any `computeAssetCost({...})` CALL in this text pass collections?
 *
 * Scoped to the call's own argument block on purpose: a first draft searched
 * the whole file and reported index.ts as wired, because that file DECLARES
 * the `collectionsPerPeriod` field on the input interface. Searching the file
 * answers "is the word present", which is not the question.
 */
function anyCallPassesCollections(text: string): boolean {
  let i = 0;
  for (;;) {
    const at = text.indexOf('computeAssetCost({', i);
    if (at < 0) return false;
    let depth = 0;
    let j = at + 'computeAssetCost('.length;
    const start = j;
    do {
      const c = text[j];
      if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') depth -= 1;
      j += 1;
    } while (j < text.length && depth > 0);
    if (/collectionsPerPeriod\s*:/.test(text.slice(start, j))) return true;
    i = j;
  }
}

for (const s of SITES) {
  const text = read(s.file);
  const hasCall = /computeAssetCost\(/.test(text);
  check(`A1 ${path.basename(s.file)} still calls computeAssetCost`, hasCall);
  if (!hasCall) continue;
  check(`A2 ${path.basename(s.file)} ${s.wired ? 'passes' : 'does NOT pass'} collections (${s.why})`,
    anyCallPassesCollections(text) === s.wired);
}

// A NEW call site must be added to SITES above, or this fails.
{
  const roots = ['src'];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  const callers = files.filter((f) => {
    const t = fs.readFileSync(f, 'utf8');
    return /computeAssetCost\(/.test(t) && !/export function computeAssetCost/.test(t.slice(0, 200));
  }).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
  const known = new Set(SITES.map((s) => s.file));
  const unknown = callers.filter((c) => !known.has(c));
  check('A3 no UNREGISTERED computeAssetCost call site', unknown.length === 0,
    `add to SITES with a wired flag and a reason: ${unknown.join(', ')}`);
}

check('A4 the offset variant exists so a caller holding an offset does not re-derive one',
  /export function collectionsForAssetAtOffset/.test(read('src/core/calculations/capexPhasing.ts')));
check('A5 the financing path uses the AXIS offset, not a date-derived one',
  /collectionsForAssetAtOffset\(inputs\.revenue, asset\.id, offset, phase\)/
    .test(read('src/core/calculations/financing/capex.ts')));

// ── B. IT ACTUALLY MATTERS ─────────────────────────────────────────────────
{
  const project = makeDefaultProject();
  const phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 3, operationsPeriods: 3 };
  const asset = {
    id: 'a1', phaseId: 'p1', name: 'A', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 1000, buaSqm: 1000, sellableBuaSqm: 1000, parkingBaysRequired: 0, status: 'planned',
  } as Asset;
  const subUnits: SubUnit[] = [{
    id: 'su1', assetId: 'a1', name: 'U', category: 'Sellable',
    metric: 'units', metricValue: 10, unitArea: 100, unitPrice: 100_000,
  } as SubUnit];
  const lines = makeBlankCostLines('p1', 3)
    .map((c) => (c.id.split('__')[0] === 'marketing' ? { ...c, value: 4 } as CostLine : c));
  const run = (collections?: number[]): number[] => computeAssetCost({
    asset, project: project as never, phase: phase as never, parcels: [] as never,
    assets: [asset], subUnits, costLines: lines, costOverrides: [],
    landAllocationMode: 'autoByBua', collectionsPerPeriod: collections,
  }).perLinePerPeriod[lines.find((c) => c.id.startsWith('marketing'))!.id] ?? [];

  const early = run([0, 100, 0, 0, 0]);
  const late = run([0, 0, 0, 0, 100]);
  const none = run(undefined);
  check('B1 collections CHANGE the curve of a following line',
    JSON.stringify(early) !== JSON.stringify(late));
  check('B2 the cost lands where the cash arrives (early)', (early[1] ?? 0) > 0 && (early[4] ?? 0) === 0);
  check('B3 ...and where it arrives late', (late[4] ?? 0) > 0 && (late[1] ?? 0) === 0);
  check('B4 with none supplied it degrades to its own curve, not to nothing',
    none.reduce((s, v) => s + v, 0) > 0);
  const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
  check('B5 the TOTAL is identical whichever curve applies',
    Math.abs(sum(early) - sum(late)) < 1e-9 && Math.abs(sum(early) - sum(none)) < 1e-9,
    `${sum(early)} / ${sum(late)} / ${sum(none)}`);
}

// ── C. The shared helper is the only mapping ───────────────────────────────
{
  const revenue = { bySellAsset: new Map([['a1', { cashCollectedPerPeriod: [5, 6, 7, 8] }]]) };
  const phase = { startDate: '2027-01-01', constructionPeriods: 2, operationsPeriods: 2 };
  const byDate = collectionsForAsset(revenue, 'a1', phase, 2026);
  const byOffset = collectionsForAssetAtOffset(revenue, 'a1', 1, phase);
  check('C1 the date and offset variants agree', JSON.stringify(byDate) === JSON.stringify(byOffset));
  check('C2 an asset with no sell result yields nothing to follow',
    collectionsForAsset(revenue, 'nope', phase, 2026) === undefined);
  check('C3 an absent revenue snapshot yields nothing',
    collectionsForAsset(undefined, 'a1', phase, 2026) === undefined);
}

console.log('');
if (failures.length === 0) {
  console.log(`verify-capex-collections: ${passed} passed, 0 failures`);
  process.exit(0);
}
console.log(`verify-capex-collections: ${passed} passed, ${failures.length} FAILURES`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(1);
