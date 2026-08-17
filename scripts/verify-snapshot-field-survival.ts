/**
 * verify-snapshot-field-survival.ts (2026-08-17)
 *
 * A SAVED FIELD MUST SURVIVE BEING LOADED.
 *
 * `migrateLegacyToV8` runs on every snapshot without a version wrapper, which
 * is every project this app has saved. It used to rebuild each phase, parcel,
 * asset and cost line from an object literal naming a FIXED set of fields, so
 * anything the literal did not name was destroyed on load. Three real fields
 * have been lost that way:
 *
 *   windowFollowsConstruction   (cost line, 2026-08-17)
 *   phasingSource               (cost line, 2026-08-17)
 *   capexPhasing                (asset, 2026-08-17b)
 *
 * The last one is what a user hit: tick "one phasing curve for this asset", set
 * the weights, save. The version row in the database really does carry
 * `capexPhasing`. Reopen the project and the box is unchecked, with nothing
 * said. Verified in a real browser before the fix.
 *
 * The fix is structural: every record spreads first and normalises on top, so
 * there is no list to keep up to date. This file proves the class is closed
 * rather than proving three names are present:
 *
 *   A. a field NOBODY here has heard of survives on every collection
 *   B. the reported field survives, end to end, including through the engine
 *   C. the loose path and the v8 path produce the SAME snapshot
 *   D. normalisation still happens (defaults, id renames): the spread must not
 *      have turned the migration into a pass-through
 *
 * Run: npx tsx scripts/verify-snapshot-field-survival.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  hydrationFromAnySnapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeAssetCost } from '../src/core/calculations';
import {
  makeBlankCostLines, makeDefaultProject, isStandardCostLineBaseId,
  type Asset, type CostLine, type Phase, type Project,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { BUILT_IN_COST_CATALOG } from '../src/hubs/modeling/platforms/refm/lib/state/costCatalog';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);
const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// ── A loose snapshot in exactly the shape the app saves ────────────────────
// No `version` key, because `extractPersistSnapshot` does not write one. That
// is why every project takes the legacy path on every open.
function looseSnapshot(): Record<string, unknown> {
  const phase: Phase = {
    id: 'phase_1', name: 'Phase 1', constructionStart: 1, constructionPeriods: 4,
    operationsPeriods: 6, overlapPeriods: 0, startDate: '2026-01-01',
  };
  const asset: Asset = {
    id: 'a1', phaseId: 'phase_1', name: 'Tower', type: 'Residential', strategy: 'Sell',
    visible: true, gfaSqm: 1000, buaSqm: 1000, sellableBuaSqm: 1000, parkingBaysRequired: 0,
    // THE REPORTED FIELD.
    capexPhasing: { phasing: 'manual', distribution: [0, 10, 60, 30, 0] },
  } as Asset;
  return {
    project: { ...makeDefaultProject(), startDate: '2026-01-01', country: 'SA' } as Project,
    phases: [phase],
    parcels: [{ id: 'p1', phaseId: 'phase_1', name: 'Land 1', area: 1000, rate: 100, cashPct: 100, inKindPct: 0 }],
    landAllocationMode: 'autoByBua',
    assets: [asset],
    subUnits: [{ id: 's1', assetId: 'a1', name: 'Apartments', category: 'Sellable', metric: 'area', metricValue: 1000, unitPrice: 5000 }],
    // A real rate on the build line, so the phasing has something to move and
    // the engine checks below are not vacuous (the seed is deliberately zero).
    costLines: makeBlankCostLines('phase_1', 4).map((l) => (
      l.id.startsWith('construction-bua') ? { ...l, value: 4500 } : l
    )),
    costOverrides: [],
    // A real tranche, because an EMPTY list is the one place the two paths
    // deliberately differ (see the check in section C).
    financingTranches: [{
      id: 'tranche_1', phaseId: 'phase_1', name: 'Senior debt', ltvPct: 60,
      interestRatePct: 7.5, drawdownMethod: 'capex_basis', repaymentMethod: 'straight_line',
      repaymentPeriods: 60, idcCapitalize: true,
    }],
    equityContributions: [],
  };
}

const hydrate = (s: unknown): ReturnType<typeof hydrationFromAnySnapshot> => hydrationFromAnySnapshot(JSON.parse(JSON.stringify(s)));

// ════════════════════════════════════════════════════════════════════════════
section('A. A field this file invented survives on every collection');

// The point of the structural fix: it cannot know what it is preserving. A
// check that names the three lost fields would pass while the FOURTH is eaten.
{
  const snap = looseSnapshot();
  const MARK = '__survives_2026_08_17__';
  (snap.phases as Array<Record<string, unknown>>)[0][MARK] = 'phase';
  (snap.parcels as Array<Record<string, unknown>>)[0][MARK] = 'parcel';
  (snap.assets as Array<Record<string, unknown>>)[0][MARK] = 'asset';
  (snap.costLines as Array<Record<string, unknown>>)[0][MARK] = 'costLine';
  (snap.subUnits as Array<Record<string, unknown>>)[0][MARK] = 'subUnit';

  const out = hydrate(snap) as unknown as Record<string, Array<Record<string, unknown>>>;
  for (const coll of ['phases', 'parcels', 'assets', 'costLines', 'subUnits']) {
    const first = out[coll]?.[0];
    check(`an unknown field survives on ${coll}`,
      first?.[MARK] !== undefined,
      `${coll}[0] keys: ${Object.keys(first ?? {}).join(',').slice(0, 120)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('B. The reported field, end to end');

{
  const out = hydrate(looseSnapshot());
  const curve = out.assets[0]?.capexPhasing;
  check('asset.capexPhasing survives the hydrate',
    !!curve && curve.phasing === 'manual', JSON.stringify(curve));
  check('...with its weights intact',
    JSON.stringify(curve?.distribution) === JSON.stringify([0, 10, 60, 30, 0]));

  // And it reaches the engine, which is the only reason it matters.
  const bd = computeAssetCost({
    asset: out.assets[0], project: out.project, phase: out.phases[0],
    parcels: out.parcels, assets: out.assets, subUnits: out.subUnits,
    costLines: out.costLines, costOverrides: [], landAllocationMode: 'autoByBua',
  });
  const construction = bd.perLinePerPeriod['construction-bua__phase_1'] ?? [];
  const flat = { ...looseSnapshot() };
  (flat.assets as Array<Record<string, unknown>>)[0].capexPhasing = undefined;
  const out2 = hydrate(flat);
  const bd2 = computeAssetCost({
    asset: out2.assets[0], project: out2.project, phase: out2.phases[0],
    parcels: out2.parcels, assets: out2.assets, subUnits: out2.subUnits,
    costLines: out2.costLines, costOverrides: [], landAllocationMode: 'autoByBua',
  });
  const construction2 = bd2.perLinePerPeriod['construction-bua__phase_1'] ?? [];
  check('the curve reaches the engine (the phasing differs from no curve)',
    JSON.stringify(construction) !== JSON.stringify(construction2),
    `${JSON.stringify(construction)} vs ${JSON.stringify(construction2)}`);
  check('and the totals are untouched by phasing, as they must be',
    Math.abs((bd.byLineId['construction-bua__phase_1'] ?? 0) - (bd2.byLineId['construction-bua__phase_1'] ?? 0)) < 1e-6);
}

{
  // The two cost-line fields lost earlier, kept under test here as well, since
  // this is now the file that owns the class.
  const snap = looseSnapshot();
  const lines = snap.costLines as CostLine[];
  const idx = lines.findIndex((l) => l.id.startsWith('marketing'));
  lines[idx] = { ...lines[idx], windowFollowsConstruction: true, phasingSource: 'collections', catalogId: 'marketing', stageOverride: 'soft' };
  const out = hydrate(snap);
  const line = out.costLines.find((l) => l.id === lines[idx].id);
  check('windowFollowsConstruction survives', line?.windowFollowsConstruction === true);
  check('phasingSource survives', line?.phasingSource === 'collections');
  check('catalogId survives', line?.catalogId === 'marketing');
  check('stageOverride survives', line?.stageOverride === 'soft');
}

// ════════════════════════════════════════════════════════════════════════════
section('C. The loose path and the v8 path answer the same');

// They run the identical migration chain; the only difference WAS the rebuild.
// If these ever diverge again, one entry point is dropping something.
{
  const loose = looseSnapshot();
  const wrapped = { ...loose, version: 8 };
  const a = hydrate(loose);
  const b = hydrate(wrapped);
  check('a snapshot hydrates identically with and without a version wrapper',
    JSON.stringify(a) === JSON.stringify(b),
    (() => {
      const ka = JSON.stringify(a); const kb = JSON.stringify(b);
      for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
        if (ka[i] !== kb[i]) return `first difference at ${i}: ...${ka.slice(Math.max(0, i - 60), i + 60)} vs ...${kb.slice(Math.max(0, i - 60), i + 60)}`;
      }
      return '';
    })());

  // The ONE difference that remains, stated rather than hidden by the fixture:
  // an EMPTY tranche list is backfilled with a default on the legacy path and
  // left empty on the v8 path. That is a deliberate legacy backfill, not field
  // loss, and it is pinned here so a future change to it is visible.
  const noTranches = { ...looseSnapshot(), financingTranches: [] };
  const looseOut = hydrate(noTranches);
  const v8Out = hydrate({ ...noTranches, version: 8 });
  check('a legacy snapshot with NO tranches is given one, and a v8 one is not',
    looseOut.financingTranches.length === 1 && v8Out.financingTranches.length === 0,
    `${looseOut.financingTranches.length} vs ${v8Out.financingTranches.length}`);
}

// ════════════════════════════════════════════════════════════════════════════
section('D. Normalisation still happens (the spread is not a pass-through)');

{
  // A phase missing every optional field still gets its defaults.
  const snap = looseSnapshot();
  snap.phases = [{ id: 'phase_1', name: 'Phase 1', startDate: '2026-01-01' }];
  const out = hydrate(snap);
  check('a phase missing its periods is backfilled',
    typeof out.phases[0].constructionPeriods === 'number' && out.phases[0].constructionPeriods > 0);

  // A legacy v6 line id is still renamed.
  const snap2 = looseSnapshot();
  snap2.costLines = [{
    id: 'structural', phaseId: 'phase_1', name: 'Structural', method: 'rate_per_bua', value: 1000,
    stage: 'hard', scope: 'direct', allocationBasis: 'per_asset', startPeriod: 0, endPeriod: 1,
    phasing: 'even',
  }];
  const out2 = hydrate(snap2);
  check('a legacy v6 line id is still renamed',
    out2.costLines.some((l) => l.id.startsWith('construction-bua')),
    out2.costLines.map((l) => l.id).join(','));

  // A cost line missing a required field still gets its default.
  const snap3 = looseSnapshot();
  snap3.costLines = [{ id: 'mystery__phase_1', phaseId: 'phase_1', name: 'Mystery' }];
  const out3 = hydrate(snap3);
  const m = out3.costLines.find((l) => l.id === 'mystery__phase_1');
  check('a cost line missing its method gets the default',
    m?.method === 'fixed' && typeof m?.value === 'number' && m?.phasing === 'even');

  // An empty snapshot still produces a usable model.
  const empty = hydrate({});
  check('an empty snapshot still yields at least one phase and a seeded catalog',
    empty.phases.length >= 1 && empty.costLines.length > 0);
}

// ════════════════════════════════════════════════════════════════════════════
section('E. The shape of the code, so the class stays closed');

{
  const src = read('src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts');
  const body = src.slice(src.indexOf('function migrateLegacyToV8'), src.indexOf('function snapshotNeedsPass4Migration'));
  for (const [label, marker] of [
    ['phases', 'const phases: Phase[]'],
    ['parcels', '? rawParcels.map('],
    ['assets', 'const assets: Asset[] = rawAssets.map('],
  ] as const) {
    const at = body.indexOf(marker);
    const window = body.slice(at, at + 260);
    check(`the ${label} map spreads the raw record`, at >= 0 && /\.\.\.[a-z]\b/.test(window), window.slice(0, 90));
  }
  const clAt = body.indexOf('let costLines: CostLine[] = rawCostLines.map(');
  check('the cost line map spreads the raw record',
    clAt >= 0 && /\.\.\.c,/.test(body.slice(clAt, clAt + 400)));
}

// ════════════════════════════════════════════════════════════════════════════
section('F. A legacy rename must never target a line that exists today');

// Found by section C: the v6 map renamed `marketing` to `commission`, and
// `marketing` has been a real catalog id since 2026-08-15. Every app-saved
// snapshot takes this path, so a marketing line the user has TODAY was renamed
// on the next open and then deduped away. `project-management` (a catalog entry
// added 2026-08-17) was the same shape of bug, one week newer. The invariant,
// rather than the two names, is what is checked: the next catalog entry that
// reuses an old id would otherwise repeat this in silence.
{
  const src = read('src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts');
  const at = src.indexOf('const V6_TO_V7_LINE_ID');
  const map = src.slice(at, src.indexOf('}', at));
  const keys = [...map.matchAll(/'([a-z0-9-]+)':/g)].map((m) => m[1]);
  check('the rename map was found and is not empty', keys.length > 0, keys.join(','));
  const current = keys.filter((k) => isStandardCostLineBaseId(k) || BUILT_IN_COST_CATALOG.some((e) => e.id === k));
  check('no rename key is a CURRENT catalog id',
    current.length === 0,
    current.length > 0 ? `${current.join(', ')} would be renamed away on every open` : '');

  // Behavioural, so the check is not only a source read.
  for (const id of ['marketing', 'project-management']) {
    const snap = looseSnapshot();
    (snap.costLines as CostLine[]).push({
      id: `${id}__phase_1`, phaseId: 'phase_1', name: id, method: 'fixed', value: 1000,
      stage: 'soft', scope: 'direct', allocationBasis: 'per_asset',
      startPeriod: 1, endPeriod: 2, phasing: 'even',
    } as CostLine);
    const out = hydrate(snap);
    check(`a ${id} line survives a hydrate`,
      out.costLines.some((l) => l.id === `${id}__phase_1`),
      out.costLines.map((l) => l.id).join(','));
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-snapshot-field-survival: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
