/**
 * verify-no-hidden-cost-lines.ts (2026-08-17c)
 *
 * NO COST LINE IS EVER PRESENT BUT INVISIBLE.
 *
 * This replaces `verify-country-gate.ts`, which pinned a mechanism that has
 * been deliberately removed. `CostLine.requiresCountry` let a line exist in the
 * model while being absent from the screen, and that single property produced
 * two silent money defects in one week:
 *
 *   2026-08-17   the engine CHARGED a gated row that could not be seen, edited
 *                or deleted. Measured on a live project: a Phase 2 hotel was
 *                charged 937,500 for a transfer tax row it did not show, on top
 *                of the user's own transfer tax at the same rate.
 *
 *   2026-08-17b  with the gate honoured, SELECTING A COUNTRY made the hidden
 *                row appear and charge, doubling a cost the user had already
 *                entered by hand.
 *
 * The fix for a defect on both sides of a gate is to remove the gate. A
 * transfer tax is a cost like any other: it lives in the catalog, the user adds
 * it when the project needs it, and it follows the land cash because its
 * catalog entry says so.
 *
 * What is checked here:
 *   A. the seed no longer contains a transfer tax, and no seeded line is gated
 *   B. the catalog still OFFERS it, with the behaviour that made it useful
 *   C. visibility depends on nothing but phase and target asset, and the
 *      charged set equals the shown set for any project attribute
 *   D. saved gated rows are retired on load, and no number moves
 *   E. the country remains a real project attribute (statement terminology),
 *      and is still a selected value rather than free text
 *
 * Run: npx tsx scripts/verify-no-hidden-cost-lines.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { computeAssetCost } from '../src/core/calculations';
import { assetVisibleLines } from '../src/core/calculations/selectedBase';
import {
  COUNTRIES, resolveCountryCode, countryMatches, guessCountryFromLocation,
} from '../src/core/countries';
import { defaultTerminologyForCountry } from '../src/core/calculations/financials/labels';
import {
  retireCountryGatedLines, hydrationFromAnySnapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { BUILT_IN_COST_CATALOG, stampFromEntry, findCatalogEntry } from '../src/hubs/modeling/platforms/refm/lib/state/costCatalog';
import {
  makeBlankCostLines, makeDefaultCostLines, makeDefaultPhase, makeDefaultProject,
  SEEDED_COST_LINE_IDS, STANDARD_COST_LINE_IDS,
  type Asset, type CostLine, type Parcel, type Phase, type Project, type SubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);
const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const base = (id: string): string => id.split('__')[0];

// ── Fixture ────────────────────────────────────────────────────────────────
const PHASE: Phase = { ...makeDefaultPhase('phase_1'), constructionPeriods: 4, operationsPeriods: 6 };
const PARCELS: Parcel[] = [
  { id: 'p1', phaseId: 'phase_1', name: 'Land 1', area: 10000, rate: 5000, cashPct: 60, inKindPct: 40 },
];
const ASSET: Asset = {
  id: 'a1', phaseId: 'phase_1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
  landAllocation: { parcelId: 'p1', sqm: 10000 }, landAreaSqm: 10000,
} as unknown as Asset;
const CASH_LAND = 10000 * 5000 * 0.6;   // 30,000,000
const RETT_AT_5 = CASH_LAND * 0.05;     // 1,500,000

const run = (lines: CostLine[], country?: string) => computeAssetCost({
  asset: ASSET,
  project: { ...makeDefaultProject(), startDate: '2026-01-01', country } as Project,
  phase: PHASE, parcels: PARCELS, assets: [ASSET], subUnits: [] as SubUnit[],
  costLines: lines, costOverrides: [], landAllocationMode: 'sqm',
});

// ════════════════════════════════════════════════════════════════════════════
section('A. The seed has no transfer tax, and nothing seeded is gated');

{
  for (const [label, lines] of [
    ['blank (a real project)', makeBlankCostLines('phase_1', 4)],
    ['reference rates (fixtures)', makeDefaultCostLines('phase_1', 4)],
  ] as const) {
    check(`${label}: no transfer tax row is seeded`,
      !lines.some((l) => base(l.id) === 'rett'),
      lines.map((l) => base(l.id)).join(','));
    check(`${label}: NO seeded line carries a country gate`,
      lines.every((l) => l.requiresCountry === undefined));
    check(`${label}: the rest of the catalog is intact`, lines.length >= 12, `${lines.length} lines`);
  }
  // The two seeds must stay the same SET, or a fixture and a real project
  // diverge in shape rather than in rates.
  check('both seeds carry the same line set',
    JSON.stringify(makeBlankCostLines('phase_1', 4).map((l) => base(l.id)))
    === JSON.stringify(makeDefaultCostLines('phase_1', 4).map((l) => base(l.id))));

  // SEEDED_COST_LINE_IDS is what the verifiers count against, so it has to BE
  // the seed rather than a hand-maintained list beside it. Added after a
  // sabotage put `rett` back into that constant and nothing failed.
  check('the seed-set constant matches what the seed actually emits',
    JSON.stringify([...SEEDED_COST_LINE_IDS])
    === JSON.stringify(makeBlankCostLines('phase_1', 4).map((l) => base(l.id))),
    `${SEEDED_COST_LINE_IDS.join(',')} vs ${makeBlankCostLines('phase_1', 4).map((l) => base(l.id)).join(',')}`);
  check('and every seeded id is a registered id',
    makeBlankCostLines('phase_1', 4).every((l) => (STANDARD_COST_LINE_IDS as readonly string[]).includes(base(l.id))));
}

// ════════════════════════════════════════════════════════════════════════════
section('B. The catalog still offers it, with the behaviour that matters');

{
  const entry = findCatalogEntry('rett');
  check('the transfer tax is still a catalog entry', !!entry, String(entry?.label));
  check('it still follows the land cash outflow', entry?.phasingSource === 'land_cash');
  check('it is still charged on the cash land value', entry?.method === 'percent_of_cash_land');
  check('it is a land-stage cost', entry?.stage === 'land');
  check('NO catalog entry carries a country gate',
    BUILT_IN_COST_CATALOG.every((e) => !(e as unknown as { requiresCountry?: string }).requiresCountry));

  // Adding it from the catalog produces a line that behaves: the stamp is what
  // carries the behaviour onto the row.
  const blank: CostLine = {
    id: 'custom-1__phase_1', phaseId: 'phase_1', name: 'New line', method: 'fixed', value: 0,
    stage: 'hard', scope: 'direct', allocationBasis: 'per_asset',
    startPeriod: 1, endPeriod: 4, phasing: 'even',
  };
  const stamped = { ...blank, ...stampFromEntry(findCatalogEntry('rett')!), value: 5 } as CostLine;
  check('selecting it stamps the land cash source onto the line',
    stamped.phasingSource === 'land_cash');
  check('and the percent-of-cash-land method', stamped.method === 'percent_of_cash_land');
  const bd = run([
    ...makeBlankCostLines('phase_1', 4),
    stamped,
  ]);
  check('a user-added transfer tax charges what it should',
    Math.abs((bd.byLineId[stamped.id] ?? 0) - RETT_AT_5) < 1,
    `${Math.round(bd.byLineId[stamped.id] ?? 0)} vs ${RETT_AT_5}`);
  check('and it is charged ONCE, whatever the country says',
    Math.abs((run([...makeBlankCostLines('phase_1', 4), stamped], 'SA').byLineId[stamped.id] ?? 0)
      - (bd.byLineId[stamped.id] ?? 0)) < 1e-9);
}

// ════════════════════════════════════════════════════════════════════════════
section('C. Shown == charged, for every project attribute');

{
  const lines = [
    ...makeBlankCostLines('phase_1', 4),
    {
      id: 'custom-rett__phase_1', phaseId: 'phase_1', name: 'Real Estate Transfer Tax (RETT)',
      method: 'percent_of_cash_land', value: 5, stage: 'land', scope: 'direct',
      allocationBasis: 'land_share', startPeriod: 0, endPeriod: 0, phasing: 'even',
      catalogId: 'rett', phasingSource: 'land_cash',
    } as CostLine,
  ];
  for (const country of ['', 'SA', 'Saudi Arabia', 'AE', undefined]) {
    const bd = run(lines, country);
    const shownIds = new Set(assetVisibleLines(lines, 'phase_1', ASSET.id).map((c) => c.id));
    const charged = Object.entries(bd.byLineId).filter(([, v]) => Math.abs(v) > 0.5).map(([id]) => id);
    check(`country=${JSON.stringify(country)}: nothing charged is hidden`,
      charged.every((id) => shownIds.has(id)), charged.filter((id) => !shownIds.has(id)).join(','));
    check(`country=${JSON.stringify(country)}: the transfer tax charges the same either way`,
      Math.abs((bd.byLineId['custom-rett__phase_1'] ?? 0) - RETT_AT_5) < 1,
      `${Math.round(bd.byLineId['custom-rett__phase_1'] ?? 0)}`);
  }

  // The rule itself no longer knows what a country is.
  const sel = stripComments(read('src/core/calculations/selectedBase.ts'));
  check('assetVisibleLines takes no country parameter', !/country/i.test(sel));
  // The rule gained a fourth argument on 2026-08-19, the asset's STRATEGY, so a
  // selling cost is not charged to an asset that is held and operated. The
  // engine must PASS it: reading the rule without the strategy would charge a
  // marketing line the Costs tab does not show, which is the same
  // shown-versus-charged divergence this whole verifier exists to prevent, in
  // the opposite direction.
  check('and the engine calls it with the asset STRATEGY, so the charge matches the screen',
    /assetVisibleLines\(costLines, phase\.id, asset\.id, asset\.strategy\)/.test(stripComments(read('src/core/calculations/index.ts'))));
  const costsUi = stripComments(read('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx'));
  check('the Capex tab filters no line on country', !/requiresCountry/.test(costsUi));
  check('and its gated-line notice is gone', !costsUi.includes('costs-country-gated-notice'));
  const tab1 = stripComments(read('src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx'));
  check('the country field claims nothing about cost lines', !/requiresCountry/.test(tab1));
}

// ════════════════════════════════════════════════════════════════════════════
section('D. Saved gated rows are retired on load, and no number moves');

const snapWith = (lines: CostLine[], country: string): HydrateSnapshot => ({
  project: { ...makeDefaultProject(), startDate: '2026-01-01', country } as Project,
  phases: [PHASE], parcels: PARCELS, landAllocationMode: 'sqm',
  assets: [ASSET], subUnits: [], costLines: lines, costOverrides: [],
  financingTranches: [], equityContributions: [],
} as unknown as HydrateSnapshot);

{
  // The live shape: a seeded gated row carrying a rate, invisible and charging
  // nothing, beside the user's own line.
  const gated: CostLine = {
    id: 'rett__phase_1', phaseId: 'phase_1', name: 'Real Estate Transfer Tax',
    method: 'percent_of_cash_land', value: 5, stage: 'land', scope: 'direct',
    allocationBasis: 'land_share', startPeriod: 0, endPeriod: 0, phasing: 'even',
    phasingSource: 'land_cash', requiresCountry: 'Saudi Arabia',
  };
  const own: CostLine = { ...gated, id: 'custom-rett__phase_1', name: 'Real Estate Transfer Tax (RETT)', requiresCountry: undefined, catalogId: 'rett' };
  const lines = [...makeBlankCostLines('phase_1', 4), gated, own];

  const before = run(lines.filter((l) => countryMatches(l.requiresCountry, '')), '');
  const retired = retireCountryGatedLines(snapWith(lines, ''));
  check('a gated row the country did not match is REMOVED',
    !retired.costLines.some((l) => l.id === 'rett__phase_1'),
    retired.costLines.map((l) => l.id).join(','));
  check('the user\'s own line is untouched',
    retired.costLines.some((l) => l.id === 'custom-rett__phase_1'));
  const after = run(retired.costLines, '');
  check('and EVERY number is identical',
    JSON.stringify(before.byLineId) === JSON.stringify(after.byLineId)
    && Math.abs(before.total - after.total) < 1e-9,
    `${Math.round(before.total)} vs ${Math.round(after.total)}`);

  // The other case: a gated row the country DID match is charged today, so it
  // must survive, with the dead flag stripped.
  const beforeSA = run(lines, 'SA');
  const retiredSA = retireCountryGatedLines(snapWith(lines, 'SA'));
  check('a gated row the country matched is KEPT',
    retiredSA.costLines.some((l) => l.id === 'rett__phase_1'));
  check('with the dead flag stripped',
    retiredSA.costLines.every((l) => l.requiresCountry === undefined));
  const afterSA = run(retiredSA.costLines, 'SA');
  check('and its charge is unchanged',
    Math.abs((beforeSA.byLineId['rett__phase_1'] ?? 0) - (afterSA.byLineId['rett__phase_1'] ?? 0)) < 1e-9
    && Math.abs(beforeSA.total - afterSA.total) < 1e-9);

  // Overrides on a removed row go with it, or they outlive their line.
  const withOverride = {
    ...snapWith(lines, ''),
    costOverrides: [
      { assetId: 'a1', lineId: 'rett__phase_1', method: 'fixed', value: 1, phasing: 'even', overridden: true },
      { assetId: 'a1', lineId: 'custom-rett__phase_1', method: 'fixed', value: 1, phasing: 'even', overridden: true },
    ],
  } as unknown as HydrateSnapshot;
  const cleaned = retireCountryGatedLines(withOverride);
  check('an override on a removed line is removed too',
    !cleaned.costOverrides.some((o) => o.lineId === 'rett__phase_1'));
  check('and an override on a surviving line is kept',
    cleaned.costOverrides.some((o) => o.lineId === 'custom-rett__phase_1'));

  check('it is idempotent', JSON.stringify(retireCountryGatedLines(retired)) === JSON.stringify(retired));
  const clean = snapWith(makeBlankCostLines('phase_1', 4), '');
  check('and a no-op on a project that never had a gated line',
    retireCountryGatedLines(clean) === clean);

  // It runs on load, not only when called by hand.
  const hydrated = hydrationFromAnySnapshot(JSON.parse(JSON.stringify(snapWith(lines, ''))));
  check('a hydrate retires the row',
    !hydrated.costLines.some((l) => l.id === 'rett__phase_1'));
  check('and leaves no gated line anywhere',
    hydrated.costLines.every((l) => l.requiresCountry === undefined));
}

// ════════════════════════════════════════════════════════════════════════════
section('E. The country is still a real, selected project attribute');

{
  check('it resolves codes, names and aliases',
    resolveCountryCode('SA') === 'SA' && resolveCountryCode('Saudi Arabia') === 'SA'
    && resolveCountryCode('KSA') === 'SA' && resolveCountryCode('') === undefined);
  check('the list is complete enough to be usable', COUNTRIES.length > 190);
  check('it still drives statement terminology',
    defaultTerminologyForCountry('SA') === 'saudi'
    && defaultTerminologyForCountry('Saudi Arabia') === 'saudi'
    && defaultTerminologyForCountry('AE') === 'standard');
  check('a city plus country is still readable as a suggestion',
    guessCountryFromLocation('Jeddah, Saudi Arabia') === 'SA');

  const tab1 = read('src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx');
  check('the field is a select', /<select[\s\S]{0,400}data-testid="project-country"/.test(tab1));
  check('with a not-set option', /<option value="">Not set<\/option>/.test(tab1));
  check('the suggestion is still a button the user presses',
    tab1.includes('project-country-suggestion'));
  check('and the help text no longer promises a cost line',
    /does NOT add or remove any cost line/.test(tab1));
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-no-hidden-cost-lines: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
