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
  COUNTRIES, resolveCountryCode, countryMatches, guessCountryFromLocation,
} from '../src/core/countries';
import { defaultTerminologyForCountry } from '../src/core/calculations/financials/labels';
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

// ════════════════════════════════════════════════════════════════════════════
section('E. A COUNTRY IS A SELECTED VALUE (2026-08-17b)');

// The gate was never reachable: `project.country` had no editor on any screen.
// Project & Phases offered `location` ("display only"), which is where the user
// had typed "Jeddah, Saudi Arabia" while `country` stayed ''. So the fix is a
// select writing a code, and one comparison that resolves BOTH sides.
{
  check('a code resolves', resolveCountryCode('SA') === 'SA');
  check('the canonical name resolves to the code', resolveCountryCode('Saudi Arabia') === 'SA');
  check('case and spacing do not matter', resolveCountryCode('  saudi   arabia ') === 'SA');
  check('a common alias resolves', resolveCountryCode('KSA') === 'SA' && resolveCountryCode('UAE') === 'AE');
  check('an empty value is NOT a country', resolveCountryCode('') === undefined && resolveCountryCode(undefined) === undefined);
  check('an unknown value is not silently mapped', resolveCountryCode('Atlantis') === undefined);
  check('the list is complete enough to be usable', COUNTRIES.length > 190);
  check('every entry has a two letter code and a name',
    COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.code) && c.name.length > 1));
  check('codes are unique', new Set(COUNTRIES.map((c) => c.code)).size === COUNTRIES.length);

  // The point of the resolution: a saved line and a newly stored code match
  // without either side being migrated.
  check('a line saved as a NAME matches a project storing a CODE',
    countryMatches('Saudi Arabia', 'SA'));
  check('and the reverse', countryMatches('SA', 'Saudi Arabia'));
  check('an ungated line matches anything', countryMatches(undefined, '') && countryMatches('', 'SA'));
  check('a different country does not match', !countryMatches('Saudi Arabia', 'AE'));
  check('an unset country never matches a gated line', !countryMatches('Saudi Arabia', ''));
  check('two unknown strings still compare as text (nothing that matched stops matching)',
    countryMatches('Atlantis', 'atlantis') && !countryMatches('Atlantis', 'Narnia'));
}

{
  // The engine, through the real function, with the code form.
  const bd = run('SA', 5);
  check('the ENGINE charges the gated line when the project stores the CODE',
    Math.abs((bd.byLineId['rett__phase_1'] ?? 0) - RETT_AT_5) < 1,
    `${Math.round(bd.byLineId['rett__phase_1'] ?? 0)}`);
  const ae = run('AE', 5);
  check('and not when the code is another country', (ae.byLineId['rett__phase_1'] ?? 0) === 0);

  // Terminology reads the same field, so it must accept the same values.
  check('Zakat terminology follows the code', defaultTerminologyForCountry('SA') === 'saudi');
  check('and still follows every spelling it used to accept',
    defaultTerminologyForCountry('Saudi Arabia') === 'saudi'
    && defaultTerminologyForCountry('ksa') === 'saudi'
    && defaultTerminologyForCountry('saudi') === 'saudi');
  check('and nothing else', defaultTerminologyForCountry('AE') === 'standard'
    && defaultTerminologyForCountry('') === 'standard'
    && defaultTerminologyForCountry(undefined) === 'standard');
}

{
  const ui = read('src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx');
  check('Project & Phases has a country control at all',
    ui.includes('data-testid="project-country"'));
  check('and it is a SELECT, not free text',
    /<select[\s\S]{0,400}data-testid="project-country"/.test(ui));
  check('it offers a not-set option so a country is never assumed',
    /<option value="">Not set<\/option>/.test(ui));
  check('the location field no longer claims to be a country',
    !/Free-text city \/ country \/ region\. Display only\./.test(ui));
  // The suggestion is a SUGGESTION.
  check('the location suggestion is a button the user presses',
    ui.includes('project-country-suggestion') && /onClick=\{\(\) => setProject\(\{ country: locationCountry \}\)\}/.test(ui));
  check('and it only appears when no country is set',
    /!resolveCountryCode\(project\.country\) && locationCountry/.test(ui));
  check('guessing is never called by anything but the screen',
    !stripComments(read('src/core/calculations/index.ts')).includes('guessCountryFromLocation')
    && !stripComments(read('src/core/calculations/selectedBase.ts')).includes('guessCountryFromLocation'));

  check('a city plus country resolves to the country',
    guessCountryFromLocation('Jeddah, Saudi Arabia') === 'SA');
  check('a bare city does not', guessCountryFromLocation('Jeddah') === undefined);
  check('and a substring cannot be mistaken for a country',
    guessCountryFromLocation('Nigerien Street, France') === 'FR');
}

// ════════════════════════════════════════════════════════════════════════════
section('F. Setting a country cannot silently double a cost');

// Closing the gate opened the mirror: a user who could not see the seeded
// transfer tax added their own. Both carry a rate, so the moment a country is
// selected the cost is charged twice. That is stated, not repaired: which row
// to drop is the user's call.
{
  const bd = run('SA', 5);
  const charged = Object.entries(bd.byLineId).filter(([, v]) => Math.abs(v) > 0.5).map(([id]) => id);
  check('the fixture really does charge two transfer taxes once the country is set',
    charged.includes('rett__phase_1') && charged.includes(OWN_RETT.id));

  const costsUi = read('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
  check('the Capex tab states a doubled cost',
    costsUi.includes('costs-duplicate-charge-notice'));
  check('it groups by CATALOG IDENTITY, not by label (the two rows are named differently)',
    /const identity = resolveCatalogId\(c\)/.test(costsUi));
  check('it only counts lines that are actually charged',
    /if \(!countryMatches\(c\.requiresCountry, project\.country\)\) continue;/.test(costsUi)
    && /Math\.abs\(c\.value\) === 0\) continue;/.test(costsUi));
  check('and it does not delete anything for the user',
    !/removeCostLine\([\s\S]{0,80}duplicate/i.test(costsUi));

  const tab1 = read('src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx');
  check('the country field itself names what it switched on',
    tab1.includes('project-country-activates'));
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-country-gate: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
