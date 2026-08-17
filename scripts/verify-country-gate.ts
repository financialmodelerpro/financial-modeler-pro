/**
 * verify-country-gate.ts (2026-08-17)
 *
 * A GATE THAT HIDES A ROW MUST ALSO STOP ITS MONEY.
 *
 * `CostLine.requiresCountry` exists so a country-specific line (the standard
 * catalog's Real Estate Transfer Tax) only appears where it applies. Three
 * input-side filters in the Costs tab honoured it. `computeAssetCost` did not:
 * it built its own line list filtering on phase and target asset only, so a
 * gated line was CHARGED while being invisible, uneditable and undeletable.
 *
 * Measured on a live project: `rett__phase_2` carried 5% with the project
 * country empty, so the Phase 2 hotel was charged 937,500 for a row it did not
 * show, ON TOP of the user's own RETT line at the same rate. RETT was double
 * charged, and the doubled figure reached the financing schedule, the
 * statements, the returns and both exports, because every one of them reads
 * this function.
 *
 * The same asymmetry sat inside ONE function: the set of lines it charged
 * ignored the gate while the set a percentage may charge ON (assetVisibleLines,
 * thirty lines below) respected it.
 *
 * Run: npx tsx scripts/verify-country-gate.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { computeAssetCost } from '../src/core/calculations';
import { assetVisibleLines } from '../src/core/calculations/selectedBase';
import {
  makeBlankCostLines, makeDefaultPhase, makeDefaultProject,
  type Asset, type CostLine, type Parcel, type Phase, type Project, type SubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

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

// ── Fixture: the live project's shape ──────────────────────────────────────
// One parcel, one asset, the seeded catalog, plus the user's OWN transfer tax
// line beside the country-gated standard one. Both at 5%.
const PHASE: Phase = { ...makeDefaultPhase('phase_1'), constructionPeriods: 4, operationsPeriods: 6 };
const PARCELS: Parcel[] = [
  { id: 'p1', phaseId: 'phase_1', name: 'Land 1', area: 10000, rate: 5000, cashPct: 60, inKindPct: 40 },
];
const ASSET: Asset = {
  id: 'a1', phaseId: 'phase_1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
  landAllocation: { parcelId: 'p1', sqm: 10000 }, landAreaSqm: 10000,
} as unknown as Asset;
const SUBS: SubUnit[] = [];
const OWN_RETT: CostLine = {
  id: 'custom-1__phase_1', phaseId: 'phase_1', name: 'Real Estate Transfer Tax (RETT)',
  method: 'percent_of_cash_land', value: 5, stage: 'land', scope: 'direct',
  allocationBasis: 'land_share', startPeriod: 0, endPeriod: 0, phasing: 'even',
  catalogId: 'rett',
};
const linesWithGated = (gatedRate: number): CostLine[] => [
  ...makeBlankCostLines('phase_1', 4).map((l) => (
    l.id === 'rett__phase_1' ? { ...l, value: gatedRate } : l
  )),
  OWN_RETT,
];
const run = (country: string | undefined, gatedRate: number) => computeAssetCost({
  asset: ASSET,
  project: { ...makeDefaultProject(), startDate: '2026-01-01', country } as Project,
  phase: PHASE, parcels: PARCELS, assets: [ASSET], subUnits: SUBS,
  costLines: linesWithGated(gatedRate), costOverrides: [], landAllocationMode: 'sqm',
});

// The asset's cash land share: 10,000 sqm x 5,000 x 60% = 30,000,000, so a 5%
// transfer tax is 1,500,000. Stated here so the numbers below are readable.
const CASH_LAND = 10000 * 5000 * 0.6;
const RETT_AT_5 = CASH_LAND * 0.05;

// ════════════════════════════════════════════════════════════════════════════
section('A. The gated line is not charged when the country does not match');

{
  const bd = run('', 5);
  check('the fixture is non-vacuous: the user\'s own RETT does charge',
    Math.abs((bd.byLineId[OWN_RETT.id] ?? 0) - RETT_AT_5) < 1,
    `${Math.round(bd.byLineId[OWN_RETT.id] ?? 0)} vs ${RETT_AT_5}`);
  check('the country-gated line charges NOTHING with an empty country',
    (bd.byLineId['rett__phase_1'] ?? 0) === 0,
    `charged ${Math.round(bd.byLineId['rett__phase_1'] ?? 0)}`);
  check('so the transfer tax is counted ONCE',
    Math.abs(bd.byStage.land - (CASH_LAND + 10000 * 5000 * 0.4 + RETT_AT_5)) < 1,
    `land stage = ${Math.round(bd.byStage.land)}`);

  const other = run('United Arab Emirates', 5);
  check('a non-matching country is the same as none',
    (other.byLineId['rett__phase_1'] ?? 0) === 0);
}

// ════════════════════════════════════════════════════════════════════════════
section('B. It IS charged where it applies');

{
  const bd = run('Saudi Arabia', 5);
  check('the gated line charges when the country matches',
    Math.abs((bd.byLineId['rett__phase_1'] ?? 0) - RETT_AT_5) < 1,
    `${Math.round(bd.byLineId['rett__phase_1'] ?? 0)}`);
  check('and both transfer tax lines are then charged (the user has two)',
    Math.abs((bd.byLineId[OWN_RETT.id] ?? 0) - RETT_AT_5) < 1);
  // The gate is a gate, not a rate: a zero-rate gated line is inert either way.
  const zero = run('Saudi Arabia', 0);
  check('a zero rate charges nothing even where it applies',
    (zero.byLineId['rett__phase_1'] ?? 0) === 0);
}

// ════════════════════════════════════════════════════════════════════════════
section('C. Charged set == shown set, by construction');

{
  for (const country of ['', 'Saudi Arabia', undefined]) {
    const bd = run(country, 5);
    const shown = assetVisibleLines(linesWithGated(5), 'phase_1', ASSET.id, country);
    const shownIds = new Set(shown.map((c) => c.id));
    const chargedIds = Object.entries(bd.byLineId)
      .filter(([, v]) => Math.abs(v) > 0.5)
      .map(([id]) => id);
    const hidden = chargedIds.filter((id) => !shownIds.has(id));
    check(`country=${JSON.stringify(country)}: nothing is charged that is not shown`,
      hidden.length === 0, hidden.join(', '));
  }

  const engine = stripComments(read('src/core/calculations/index.ts'));
  check('the engine builds its line list from the shared filter',
    /const phaseLines = assetVisibleLines\(costLines, phase\.id, asset\.id, project\.country\)/.test(engine));
  check('and no longer filters phase + target by hand',
    !/const phaseLines = costLines\.filter\(/.test(engine));
}

// ════════════════════════════════════════════════════════════════════════════
section('D. The mirror image is not silent either');

{
  const ui = read('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
  check('the tab says when a gated line carries a rate it cannot use',
    ui.includes('costs-country-gated-notice'));
  check('the notice names the country the line needs',
    /c\.requiresCountry/.test(ui) && ui.includes('not set'));
  check('and it only fires when there is a rate to lose',
    /Math\.abs\(c\.value\) > 0/.test(ui));
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-country-gate: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
