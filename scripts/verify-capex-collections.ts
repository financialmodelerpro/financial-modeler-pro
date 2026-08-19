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
import type { RevenueSource } from '../src/core/calculations/revenue/sellingCosts';
import { buildRevenueBasisAdvisories, revenueBasisAdvisoryText } from '../src/hubs/modeling/platforms/refm/lib/reports/checksReport';
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

// ── A. EVERY REACHABLE CALL SITE PASSES COLLECTIONS, AND THE REVENUE SNAPSHOT ──
//
// Each entry is a file that calls computeAssetCost, with why it does or does
// not need each input. A new call site that is not registered fails A3.
//
// TWO SEPARATE DIMENSIONS, and the difference is what a 2026-08-19 defect was
// made of. `collections` drives PHASING (when a line's money lands) and
// `revenue` drives the AMOUNT of a percent-of-revenue line. A site can
// legitimately need one and not the other: `computeAssetCapex` reads `.total`
// only, so phasing cannot move its answer, but a revenue base certainly can.
// Registering one flag for both hid exactly that: the site's recorded reason,
// "phasing cannot move a total", was true and was quietly taken as permission to
// omit everything (TRAPS 7.26).
//
// Pass C then replaced three separate basis figures with ONE `revenue` input, so
// the `bases` flag now asks a single question: does this call pass the snapshot.
const SITES: Array<{ file: string; wired: boolean; bases: boolean; why: string }> = [
  { file: 'src/core/calculations/index.ts', wired: false, bases: false,
    why: 'computePhaseCost: an internal rollup whose caller already resolved both' },
  { file: 'src/core/calculations/financing/capex.ts', wired: true, bases: true, why: 'financing capex schedule' },
  { file: 'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts', wired: true, bases: true, why: 'the model' },
  { file: 'src/hubs/modeling/platforms/refm/lib/reports/capexReports.ts', wired: true, bases: true, why: 'capex report + exports' },
  { file: 'src/hubs/modeling/platforms/refm/lib/reports/cosReports.ts', wired: true, bases: true, why: 'cost of sales report' },
  { file: 'src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts', wired: true, bases: true, why: 'capitalised capex drives depreciation' },
  { file: 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', wired: true, bases: true, why: 'the Capex screen' },
  { file: 'src/hubs/modeling/platforms/refm/components/modules/Module2CostOfSales.tsx', wired: true, bases: true, why: 'CoS screen' },
  { file: 'src/hubs/modeling/platforms/refm/components/modules/Module2Schedules.tsx', wired: true, bases: true, why: 'schedules screen' },
  { file: 'src/hubs/modeling/platforms/refm/components/modules/Module2RevenueOutput.tsx', wired: false, bases: true,
    why: 'the Module 2 Selling Costs year-on-year schedule reads perLinePerPeriod, which the engine has already phased, so it needs the revenue BASES but not the collections curve' },
  { file: 'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts', wired: false, bases: true,
    why: 'computeAssetCapex reads .total only, so phasing cannot move it, but a revenue BASE can' },
  { file: 'src/hubs/modeling/platforms/refm/lib/financing-hooks.ts', wired: false, bases: false,
    why: 'DEAD CODE: createFinancingHooks is imported nowhere in src, app or scripts' },
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
  check(`A2b ${path.basename(s.file)} ${s.bases ? 'passes' : 'does NOT pass'} the revenue bases (${s.why})`,
    anyCallPassesBases(text) === s.bases);
}

/**
 * Does any `computeAssetCost({...})` CALL in this text pass the revenue snapshot?
 *
 * Same per-call scoping as the collections scanner above, for the same reason:
 * searching the whole file answers "is the word present", and several files
 * mention `revenue` without passing it to this call. Matches the shorthand
 * `revenue,` as well as `revenue: x`, since both are how a caller passes it.
 */
function anyCallPassesBases(text: string): boolean {
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
    if (/\brevenue\s*[:,]/.test(text.slice(start, j))) return true;
    i = j;
  }
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
    `add to SITES with a wired flag, a bases flag and a reason: ${unknown.join(', ')}`);
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


// ── D. CASH BASIS vs SALE BASIS (pass three) ───────────────────────────────
//
// percent_of_revenue_cash charges on cash COLLECTED; percent_of_revenue_sale
// and percent_of_total_revenue charge on GROSS LIST VALUE. All three resolved
// to gross until 2026-08-16, so the distinction lived on the schema and nowhere
// else. The audit found ZERO saved lines using the cash method with a non-zero
// rate, so this moves no existing model, but it makes the methods mean what
// they say.
{
  const project = makeDefaultProject();
  const phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 3, operationsPeriods: 3 };
  const asset = {
    id: 'a1', phaseId: 'p1', name: 'A', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 1000, buaSqm: 1000, sellableBuaSqm: 1000, parkingBaysRequired: 0, status: 'planned',
  } as Asset;
  // Gross list value = 10 units x 100,000 = 1,000,000.
  const subUnits: SubUnit[] = [{
    id: 'su1', assetId: 'a1', name: 'U', category: 'Sellable',
    metric: 'units', metricValue: 10, unitArea: 100, unitPrice: 100_000,
  } as SubUnit];
  const line = (method: string): CostLine => ({
    id: 'fee__p1', phaseId: 'p1', name: 'Fee', method, value: 10,
    stage: 'soft', scope: 'direct', allocationBasis: 'per_asset',
    startPeriod: 1, endPeriod: 2, phasing: 'even',
  } as unknown as CostLine);
  /**
   * A revenue snapshot shaped like the real one. Since Pass C the bases come
   * from ONE input, so the fixture supplies a snapshot rather than a loose
   * figure per method. Sale value stays at the 1,000,000 list value and the
   * collections vary, which is what separates the cash basis from the sale
   * basis.
   */
  const revenueWith = (collected?: number): RevenueSource | undefined => {
    if (collected === undefined) return undefined;
    return {
      bySellAsset: new Map([['a1', {
        presalesRevenuePerPeriod: [1_000_000],
        postSalesRevenuePerPeriod: [0],
        cashCollectedPerPeriod: [collected],
      }]]),
      byHospitalityAsset: new Map(),
      byLeaseAsset: new Map(),
    };
  };
  const amount = (method: string, collected?: number): number => computeAssetCost({
    asset, project: project as never, phase: phase as never, parcels: [] as never,
    assets: [asset], subUnits, costLines: [line(method)], costOverrides: [],
    landAllocationMode: 'autoByBua', revenue: revenueWith(collected),
  }).byLineId['fee__p1'] ?? 0;

  check('D1 sale basis charges on GROSS list value',
    Math.abs(amount('percent_of_revenue_sale', 600_000) - 100_000) < 1e-9,
    String(amount('percent_of_revenue_sale', 600_000)));
  check('D2 cash basis charges on COLLECTIONS, not gross',
    Math.abs(amount('percent_of_revenue_cash', 600_000) - 60_000) < 1e-9,
    String(amount('percent_of_revenue_cash', 600_000)));
  check('D3 the two methods now DIFFER when cash falls short of list value',
    amount('percent_of_revenue_cash', 600_000) !== amount('percent_of_revenue_sale', 600_000));
  check('D4 ...and agree when every sale is collected (the ordinary case)',
    Math.abs(amount('percent_of_revenue_cash', 1_000_000) - amount('percent_of_revenue_sale', 1_000_000)) < 1e-9);
  check('D5 with NO revenue snapshot the cash basis falls back to gross (unchanged behaviour)',
    Math.abs(amount('percent_of_revenue_cash') - 100_000) < 1e-9, String(amount('percent_of_revenue_cash')));
  check('D6 percent_of_total_revenue stays on gross',
    Math.abs(amount('percent_of_total_revenue', 600_000) - 100_000) < 1e-9);

  // The advisory: an ADVISORY, never an integrity check, because a gap here is
  // legitimate model state and a failed check would cry wolf on a good model.
  const adv = buildRevenueBasisAdvisories(
    [{ id: 'a1', name: 'A' }, { id: 'a2', name: 'B' }],
    (id) => (id === 'a1' ? 1_000_000 : 500_000),
    (id) => (id === 'a1' ? 600_000 : 500_000),
  );
  check('D7 a material divergence is reported', adv.length === 1 && adv[0].assetId === 'a1');
  check('D8 an asset whose cash equals its list value is NOT reported',
    !adv.some((a) => a.assetId === 'a2'));
  check('D9 the advisory says which way and by how much',
    /40.0% below/.test(revenueBasisAdvisoryText(adv[0], (v) => String(v))),
    revenueBasisAdvisoryText(adv[0], (v) => String(v)));
  check('D10 an asset with no revenue at all is not a divergence',
    buildRevenueBasisAdvisories([{ id: 'x', name: 'X' }], () => 0, () => undefined).length === 0);
  check('D11 the divergence is USER-VISIBLE on the cost row, not only in verifiers',
    /basis-note/.test(read('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx')));
  check('D12 the advisory is NOT folded into the integrity checks',
    !/buildRevenueBasisAdvisories/.test(
      read('src/hubs/modeling/platforms/refm/lib/reports/checksReport.ts')
        .split('export function buildIntegrityChecks')[1] ?? ''));
}


// ── E. THE ADVISORY REACHES THE EXPORTS, not only the screen ───────────────
//
// It was screen-only when first built, which is exactly the failure mode this
// whole block has been about: a figure that exists on one surface and not the
// others. Both PDFs and the workbook Checks tab now carry it.
{
  const pdf = read('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts');
  const xlsx = read('src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts');
  const checks = read('src/hubs/modeling/platforms/refm/lib/reports/checksReport.ts');
  check('E1 the PDF renders the advisory', /buildRevenueBasisAdvisoriesFor/.test(pdf));
  check('E2 the workbook renders it', /buildRevenueBasisAdvisoriesFor/.test(xlsx));
  check('E3 both use the SHARED sentence, not their own wording',
    /revenueBasisAdvisoryText/.test(pdf) && /revenueBasisAdvisoryText/.test(xlsx));
  // It must read as a NOTE on every surface. Colouring it as a pass or a
  // failure would make a legitimate model state look like a verdict.
  check('E4 the PDF marks it NOTE, not OK or CHECK', /'NOTE'/.test(pdf));
  check('E5 the workbook marks it NOTE too', /= 'NOTE'/.test(xlsx));
  check('E6 the shared wrapper filters to sell assets',
    /a.strategy === 'Sell' || a.strategy === 'Sell + Manage'/.test(checks));
  // Empty on a fully-collected project, so most exports are unchanged.
  check('E7 nothing is emitted when every sale is collected',
    buildRevenueBasisAdvisories([{ id: 'a', name: 'A' }], () => 1000, () => 1000).length === 0);
}

console.log('');
if (failures.length === 0) {
  console.log(`verify-capex-collections: ${passed} passed, 0 failures`);
  process.exit(0);
}
console.log(`verify-capex-collections: ${passed} passed, ${failures.length} FAILURES`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(1);
