/**
 * verify-new-project-defaults.ts (2026-08-15)
 *
 * Three defects found while creating a new project, one verifier.
 *
 *   A. CAPEX ARRIVES PRE-FILLED. The cost line catalog seeded at create carried
 *      the benchmark rates (4,500 per sqm BUA, 25,000 per bay, 6% professional
 *      fee, 5% contingency and so on). The rows ship switched On, so a user who
 *      did not notice them was costing the scheme at rates they never chose.
 *      Now every product path seeds the SAME catalog with zero rates, while
 *      makeDefaultCostLines keeps the reference figures for the fixtures.
 *
 *   B. THE STRATEGY ALERT FIRED ON ASSET CREATION. A new asset is created as
 *      'Sell', so the user's first pick from the Strategy dropdown was a
 *      "change" and got the full confirm dialog plus a persistent review banner
 *      listing four things to fill in, on an asset with nothing on it. The
 *      report cannot answer this on its own (needsReview is "what is now active
 *      but empty", and on a new asset that is everything), so the gate is a
 *      separate predicate over what the asset actually carries.
 *
 *   C. THE VERSION SELECTOR NEVER NAMED THE VERSION. StorageProject.versions is
 *      written as `{}` by projectsToStorageShape (the project LIST endpoint
 *      returns a version COUNT, not the rows), and four surfaces looked the
 *      active version up in it. The lookup could only ever miss, so the topbar
 *      and sidebar read "Unsaved draft" over a saved version, permanently, and
 *      NameVersionModal computed its X.Y rollover from the same empty list and
 *      therefore auto-named every version v1.0.
 *
 * Run: npx tsx scripts/verify-new-project-defaults.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  makeDefaultCostLines,
  makeBlankCostLines,
  makeDefaultParcel,
  makeDefaultPhase,
  type Asset,
  type CostLine,
  type SubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  useModule1Store,
  DEFAULT_MODULE1_STATE,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  buildWizardSnapshot,
  makeDefaultWizardDraft,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  assetHasStrategyAssumptions,
  applyStrategySwitch,
  type StrategySwitchState,
} from '../src/hubs/modeling/platforms/refm/lib/state/strategySwitch';
import { resolveVersionDisplayName } from '../src/hubs/modeling/platforms/refm/lib/persistence/versionNaming';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { resolveAllocationFactor, resolveDriverFactor } from '../src/core/calculations';

// ── Harness ─────────────────────────────────────────────────────────────────
let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
}
function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

const ROOT = path.resolve(__dirname, '..');
// CRLF is normalised away: these files are checked out with Windows line
// endings, so a multi-line source assertion silently matches nothing otherwise.
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const REFM = 'src/hubs/modeling/platforms/refm';
const SRC_TYPES    = read(`${REFM}/lib/state/module1-types.ts`);
const SRC_STORE    = read(`${REFM}/lib/state/module1-store.ts`);
const SRC_MIGRATE  = read(`${REFM}/lib/state/module1-migrate.ts`);
const SRC_WIZARD   = read(`${REFM}/lib/wizard/buildWizardSnapshot.ts`);
const SRC_ASSETS   = read(`${REFM}/components/modules/Module1Assets.tsx`);
const SRC_SHELL    = read(`${REFM}/components/RealEstatePlatform.tsx`);
const SRC_SYNC     = read(`${REFM}/lib/persistence/module1-sync.ts`);
const SRC_CALC     = read('src/core/calculations/index.ts');
const SRC_WIZARD_UI = read(`${REFM}/components/modals/ProjectWizard.tsx`);

const LOCKED_IDS = ['land-cash', 'land-inkind'];
const baseId = (id: string): string => id.split('__')[0];
const editable = (lines: CostLine[]): CostLine[] => lines.filter((l) => l.isLocked !== true);
const locked   = (lines: CostLine[]): CostLine[] => lines.filter((l) => l.isLocked === true);

// ════════════════════════════════════════════════════════════════════════════
// A. Capex defaults to zero on a new project
// ════════════════════════════════════════════════════════════════════════════
section('A. Capex seeds blank');

const refLines   = makeDefaultCostLines('p1', 24);
const blankLines = makeBlankCostLines('p1', 24);

check('A1 catalog is the standard 10 rows', blankLines.length === 10, `got ${blankLines.length}`);
check('A2 blank and reference are the same catalog size', blankLines.length === refLines.length);

// The core claim: nothing the user can edit, switch off or delete carries a value.
const nonZero = editable(blankLines).filter((l) => l.value !== 0);
check(
  'A3 every editable line has value 0',
  nonZero.length === 0,
  nonZero.map((l) => `${baseId(l.id)}=${l.value}`).join(', '),
);
check('A4 there are 8 editable lines to zero', editable(blankLines).length === 8, `${editable(blankLines).length}`);

// The two locked land rows are derivations of the parcels the user typed, not
// cost assumptions. Zeroing them would drop land out of the model entirely.
const lockedBlank = locked(blankLines);
check('A5 exactly 2 locked rows', lockedBlank.length === 2, `${lockedBlank.length}`);
check('A6 locked rows are the two land rows',
  lockedBlank.every((l) => LOCKED_IDS.includes(baseId(l.id))),
  lockedBlank.map((l) => baseId(l.id)).join(', '));
check('A7 locked land rows keep their 100 percent derivation',
  lockedBlank.every((l) => l.value === 100),
  lockedBlank.map((l) => `${baseId(l.id)}=${l.value}`).join(', '));

// Structure must be untouched: only the rate changes. If a future edit rebuilds
// the blank catalog by hand instead of deriving it, this breaks.
const structureKeys = ['id', 'phaseId', 'name', 'method', 'stage', 'scope',
  'allocationBasis', 'startPeriod', 'endPeriod', 'phasing', 'isLocked'] as const;
let structureDrift = '';
for (let i = 0; i < refLines.length; i += 1) {
  for (const k of structureKeys) {
    if (JSON.stringify(refLines[i][k]) !== JSON.stringify(blankLines[i][k])) {
      structureDrift += `${baseId(refLines[i].id)}.${k}; `;
    }
  }
  if (JSON.stringify(refLines[i].selectedLineIds) !== JSON.stringify(blankLines[i].selectedLineIds)) {
    structureDrift += `${baseId(refLines[i].id)}.selectedLineIds; `;
  }
}
check('A8 blank catalog is structurally identical to the reference', structureDrift === '', structureDrift);

// The reference figures still exist under their own name, so the 16 verifiers
// that build models on them are untouched. If this fails the suite is about to
// compute a zero-cost project everywhere.
const refBua = refLines.find((l) => baseId(l.id) === 'construction-bua');
check('A9 makeDefaultCostLines still returns the reference rates by default',
  refBua?.value === 4500, `construction-bua=${refBua?.value}`);
check('A10 explicit reference mode returns the reference rates',
  makeDefaultCostLines('p1', 24, 'reference').find((l) => baseId(l.id) === 'construction-bua')?.value === 4500);
check('A11 explicit blank mode zeroes the same line',
  makeDefaultCostLines('p1', 24, 'blank').find((l) => baseId(l.id) === 'construction-bua')?.value === 0);

// The four product paths that create lines a user did not author.
const wizardSnap = buildWizardSnapshot(makeDefaultWizardDraft());
const wizardNonZero = editable(wizardSnap.costLines).filter((l) => l.value !== 0);
check('A12 the CREATE PROJECT wizard seeds zero rates',
  wizardNonZero.length === 0,
  wizardNonZero.map((l) => `${baseId(l.id)}=${l.value}`).join(', '));
check('A13 the wizard still seeds the full catalog per phase',
  wizardSnap.costLines.length === wizardSnap.phases.length * 10,
  `${wizardSnap.costLines.length} lines / ${wizardSnap.phases.length} phases`);

const defaultStateNonZero = editable(DEFAULT_MODULE1_STATE.costLines).filter((l) => l.value !== 0);
check('A14 the store default state seeds zero rates',
  defaultStateNonZero.length === 0,
  defaultStateNonZero.map((l) => `${baseId(l.id)}=${l.value}`).join(', '));

// addAsset seeds the catalog when the asset lands in a phase with no lines.
{
  const st = useModule1Store.getState();
  st.hydrate({ ...DEFAULT_MODULE1_STATE, costLines: [] });
  st.addAsset({
    id: 'a_seed', phaseId: DEFAULT_MODULE1_STATE.phases[0].id, name: 'A', type: '',
    strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0,
    parkingBaysRequired: 0, status: 'planned',
  } as Asset);
  const seeded = useModule1Store.getState().costLines;
  const seededNonZero = editable(seeded).filter((l) => l.value !== 0);
  check('A15 addAsset seeds a catalog into an empty phase', seeded.length === 10, `${seeded.length}`);
  check('A16 addAsset seeds zero rates',
    seededNonZero.length === 0,
    seededNonZero.map((l) => `${baseId(l.id)}=${l.value}`).join(', '));
}

// The hydrate-time seed migration: it runs for ANY phase with no lines, so it is
// also the path a phase added after create takes.
{
  const phase = makeDefaultPhase();
  const hydrated = hydrationFromAnySnapshot({
    ...DEFAULT_MODULE1_STATE, phases: [phase], costLines: [],
  } as unknown as Record<string, unknown>);
  const migNonZero = editable(hydrated.costLines).filter((l) => l.value !== 0);
  check('A17 the hydrate seed migration produced a catalog', hydrated.costLines.length >= 10);
  check('A18 the hydrate seed migration seeds zero rates',
    migNonZero.length === 0,
    migNonZero.map((l) => `${baseId(l.id)}=${l.value}`).join(', '));
}

// Source level: no product path may reach for the reference catalog.
check('A19 the wizard imports the blank seed, not the reference one',
  /makeBlankCostLines/.test(SRC_WIZARD) && !/makeDefaultCostLines/.test(SRC_WIZARD));
check('A20 the store imports the blank seed, not the reference one',
  /makeBlankCostLines/.test(SRC_STORE) && !/makeDefaultCostLines/.test(SRC_STORE));
check('A21 the migrator imports the blank seed, not the reference one',
  /makeBlankCostLines/.test(SRC_MIGRATE) && !/makeDefaultCostLines/.test(SRC_MIGRATE));
check('A22 the seed values mode is a named type, not a bare boolean',
  /CostLineSeedValues/.test(SRC_TYPES) && /'reference' \| 'blank'/.test(SRC_TYPES));
// isLocked is the discriminator on purpose: a rule written against the two land
// IDS would silently stop protecting them if a third derived row is ever added.
check('A23 blank derives from isLocked, not from a hardcoded id list',
  /line\.isLocked \? line : \{ \.\.\.line, value: 0 \}/.test(SRC_TYPES));

// ════════════════════════════════════════════════════════════════════════════
// B. The strategy alert fires only on an asset that has assumptions
// ════════════════════════════════════════════════════════════════════════════
section('B. Strategy change alert');

const bareAsset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1', phaseId: 'p1', name: 'Tower', type: '', strategy: 'Sell', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
  ...over,
} as Asset);
const sliceOf = (over: Partial<StrategySwitchState> = {}): StrategySwitchState => ({
  assets: [bareAsset()], subUnits: [], costLines: [], costOverrides: [], ...over,
});
const subUnit = (over: Partial<SubUnit> = {}): SubUnit => ({
  id: 'su1', assetId: 'a1', name: 'Apartments', category: 'Sellable',
  metric: 'units', metricValue: 50, unitPrice: 1_000_000,
  ...over,
} as SubUnit);

// The whole point: a freshly added asset is not worth warning about.
check('B1 a bare new asset has no assumptions',
  assetHasStrategyAssumptions(sliceOf(), 'a1') === false);
check('B2 a sub-unit counts as an assumption',
  assetHasStrategyAssumptions(sliceOf({ subUnits: [subUnit()] }), 'a1') === true);
check('B3 a SUPPORT sub-unit counts too (the user built something)',
  assetHasStrategyAssumptions(sliceOf({ subUnits: [subUnit({ category: 'Support' })] }), 'a1') === true);
check('B4 opex lines count',
  assetHasStrategyAssumptions(
    sliceOf({ assets: [bareAsset({ opex: { lines: [{ id: 'o1' }] } as Asset['opex'] })] }), 'a1') === true);
check('B5 a revenue configuration counts',
  assetHasStrategyAssumptions(
    sliceOf({ assets: [bareAsset({ revenue: { sell: { assetId: 'a1', subUnits: [] } } as unknown as Asset['revenue'] })] }), 'a1') === true);
check('B6 parked assumptions from an earlier switch count',
  assetHasStrategyAssumptions(
    sliceOf({ assets: [bareAsset({ retainedByStrategy: { Operate: { subUnits: [subUnit()] } } })] }), 'a1') === true);
check('B7 a companion asset counts',
  assetHasStrategyAssumptions(
    sliceOf({ assets: [bareAsset(), bareAsset({ id: 'c1', parentAssetId: 'a1', isCompanion: true })] }), 'a1') === true);
check('B8 a cost override counts',
  assetHasStrategyAssumptions(
    sliceOf({ costOverrides: [{ assetId: 'a1', lineId: 'x' } as never] }), 'a1') === true);
check('B9 an asset-targeted cost line counts',
  assetHasStrategyAssumptions(
    sliceOf({ costLines: [{ id: 'cl', phaseId: 'p1', targetAssetId: 'a1' } as never] }), 'a1') === true);
check('B10 an empty retainedByStrategy object does not count',
  assetHasStrategyAssumptions(sliceOf({ assets: [bareAsset({ retainedByStrategy: {} })] }), 'a1') === false);
check('B11 useful life alone does not count (it is not strategy scoped)',
  assetHasStrategyAssumptions(sliceOf({ assets: [bareAsset({ usefulLifeYears: 40 })] }), 'a1') === false);
check('B12 an unknown asset id is not an assumption',
  assetHasStrategyAssumptions(sliceOf(), 'nope') === false);

// The store is the surface that actually raises the banner.
{
  const st = useModule1Store.getState();
  st.hydrate({ ...DEFAULT_MODULE1_STATE, assets: [], subUnits: [] });
  const phaseId = DEFAULT_MODULE1_STATE.phases[0].id;
  st.addAsset(bareAsset({ id: 'newA', phaseId }));
  // This is the reported bug verbatim: add an asset, pick its real strategy.
  useModule1Store.getState().updateAsset('newA', { strategy: 'Operate' });
  const after = useModule1Store.getState().assets.find((a) => a.id === 'newA');
  check('B13 first strategy pick on a new asset raises NO review banner',
    after?.strategyReview === undefined, JSON.stringify(after?.strategyReview?.needsReview));
  check('B14 the strategy still changed', after?.strategy === 'Operate', String(after?.strategy));
}
{
  const st = useModule1Store.getState();
  const phaseId = DEFAULT_MODULE1_STATE.phases[0].id;
  st.hydrate({ ...DEFAULT_MODULE1_STATE, assets: [], subUnits: [] });
  st.addAsset(bareAsset({ id: 'realA', phaseId }));
  useModule1Store.getState().addSubUnit(subUnit({ id: 'su_real', assetId: 'realA' }));
  useModule1Store.getState().updateAsset('realA', { strategy: 'Operate' });
  const after = useModule1Store.getState().assets.find((a) => a.id === 'realA');
  check('B15 a real strategy change on a built asset DOES raise the banner',
    after?.strategyReview !== undefined);
  check('B16 and the banner still lists what to review',
    (after?.strategyReview?.needsReview.length ?? 0) > 0);
}
{
  // Suppressing the banner must not suppress the model operation. Sell + Manage
  // creates a companion asset even on a bare asset, and that must still happen.
  const st = useModule1Store.getState();
  const phaseId = DEFAULT_MODULE1_STATE.phases[0].id;
  st.hydrate({ ...DEFAULT_MODULE1_STATE, assets: [], subUnits: [] });
  st.addAsset(bareAsset({ id: 'smA', phaseId }));
  useModule1Store.getState().updateAsset('smA', { strategy: 'Sell + Manage' });
  const assets = useModule1Store.getState().assets;
  check('B17 the switch still runs: Sell + Manage seeds its companion',
    assets.some((a) => a.parentAssetId === 'smA' && a.isCompanion === true));
  check('B18 and still raises no banner on a bare asset',
    assets.find((a) => a.id === 'smA')?.strategyReview === undefined);
}
{
  // The pure function is unchanged: it still reports on a real switch.
  const slice = sliceOf({ subUnits: [subUnit()] });
  const { report } = applyStrategySwitch(slice, 'a1', 'Operate');
  check('B19 applyStrategySwitch itself still reports needsReview',
    report.needsReview.length > 0);
  check('B20 and still seeds the incoming rows', report.seeded.length > 0);
}

// Source level: the dropdown must consult the SAME predicate, or the dialog and
// the banner can disagree about whether a switch was worth announcing.
check('B21 the Strategy dropdown gates on the shared predicate',
  /assetHasStrategyAssumptions\(slice, asset\.id\)/.test(SRC_ASSETS));
check('B22 an ungated pick writes straight through with no dialog',
  /if \(!assetHasStrategyAssumptions\(slice, asset\.id\)\) \{[\s\S]{0,120}onUpdate\(\{ strategy: to \}\);[\s\S]{0,40}return;/.test(SRC_ASSETS));
check('B23 the store measures assumptions BEFORE the switch is applied',
  SRC_STORE.indexOf('const hadAssumptions = assetHasStrategyAssumptions(slice, id)')
    < SRC_STORE.indexOf('const res = applyStrategySwitch(slice, id, after.strategy)')
  && SRC_STORE.includes('const hadAssumptions = assetHasStrategyAssumptions(slice, id)'));

// ════════════════════════════════════════════════════════════════════════════
// C. The version selector names the version being worked in
// ════════════════════════════════════════════════════════════════════════════
section('C. Version naming');

check('C1 a free-text label wins',
  resolveVersionDisplayName({ label: 'Marina_v1.0_Inputs', version_label: '1.0', version_number: 2 })
    === 'Marina_v1.0_Inputs');
check('C2 an unlabelled row falls back to its X.Y label',
  resolveVersionDisplayName({ label: null, version_label: '1.3', version_number: 5 }) === 'v1.3');
check('C3 a row with neither falls back to its sequence number',
  resolveVersionDisplayName({ label: null, version_label: null, version_number: 3 }) === 'Version 3');
check('C4 a whitespace-only label does not win',
  resolveVersionDisplayName({ label: '   ', version_label: null, version_number: 7 }) === 'Version 7');
check('C5 no row at all is the ONLY draft case',
  resolveVersionDisplayName(null) === null && resolveVersionDisplayName(undefined) === null);
check('C6 a row with no identity at all still returns null rather than a lie',
  resolveVersionDisplayName({ label: null, version_label: null, version_number: null }) === null);

// The shell must not name the active version off StorageProject.versions, which
// projectsToStorageShape writes as `{}`. That dead lookup was the whole defect.
check('C7 projectsToStorageShape still writes an empty versions map',
  /versions: \{\},/.test(SRC_SHELL));
check('C8 the shell no longer names the version from that map',
  !/activeProjectData\.versions\[activeVersionId\]/.test(SRC_SHELL));
check('C9 the shell names it from the loaded version row instead',
  /activeVersion && activeVersionId === activeVersion\.id/.test(SRC_SHELL));
check('C10 the name is guarded on the id so it cannot outlive its version',
  /activeVersionId === activeVersion\.id/.test(SRC_SHELL));

// Every path that opens or creates a version has to name it, or the selector
// reverts to "Unsaved draft" on that path only.
for (const [id, marker] of [
  ['C11 open a project', 'setActiveVersion(res.version ?? null);\n    setEditingVersionLabel(null);'],
  ['C12 create a project', 'setActiveVersion({\n        id:        res.data.version.id,'],
  ['C13 close a project clears it', 'setActiveVersion(null);\n    setProjectVersions([]);'],
  ['C14 auto-started edit session', 'setActiveVersion(startedId'],
  ['C15 explicit save / save as new', 'setActiveVersion({\n          id:        res.versionId,'],
] as const) {
  check(id, SRC_SHELL.includes(marker));
}

// The auto-name rollover read the same dead map, so every version was v1.0.
check('C16 the naming modal reads the real version list',
  /existingVersions=\{projectVersions\.map/.test(SRC_SHELL));
check('C17 and no longer reads the empty map',
  !/existingVersions=\{Object\.values\(activeProjectData\?\.versions/.test(SRC_SHELL));
check('C18 the version list is fetched from the server',
  /const res = await pclient\.listVersions\(projectId\)/.test(SRC_SHELL));
check('C19 and refreshed after a version is created',
  /void refreshProjectVersions\(activeProjectId\)/.test(SRC_SHELL));

// The loaders hand the identity back rather than making the shell find it.
check('C20 attachToProject returns the version identity',
  /export interface ActiveVersionInfo/.test(SRC_SYNC)
  && /return \{ loaded, error, migrationNotice, versionId, version \};/.test(SRC_SYNC));
check('C21 loadVersionInto returns it too',
  /Promise<\{ error: string \| null; version\?: ActiveVersionInfo \| null \}>/.test(SRC_SYNC));
check('C22 both resolve the name through the shared helper',
  (SRC_SYNC.match(/resolveVersionDisplayName\(/g) ?? []).length >= 2);

// End to end through the real sync layer, with the network stubbed. This is the
// check that would have caught the original defect: it asserts the NAME, not the
// wiring that produces it.
async function versionIdentityEndToEnd(): Promise<void> {
  const snapshot = buildWizardSnapshot(makeDefaultWizardDraft());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => (String(url).includes('/versions')
      ? { versions: [] }
      : {
          project: { id: 'proj1', name: 'Case Study', current_version_id: 'ver9' },
          version: {
            id: 'ver9', project_id: 'proj1', version_number: 2, schema_version: 1,
            snapshot, label: 'Case Study_v1.0_08152026_Inputs', base_version_id: null,
            change_log: [], created_at: '2026-08-13T08:24:31.466Z',
            version_label: '1.0', task_name: 'Inputs', comment: 'x',
          },
        }),
  })) as unknown as typeof globalThis.fetch;
  try {
    const sync = await import('../src/hubs/modeling/platforms/refm/lib/persistence/module1-sync');
    const res = await sync.attachToProject('proj1');
    check('C23 attach names the saved version', res.version?.name === 'Case Study_v1.0_08152026_Inputs',
      String(res.version?.name));
    check('C24 attach reports the version id', res.version?.id === 'ver9' && res.versionId === 'ver9');
    check('C25 attach carries the created date', res.version?.createdAt === '2026-08-13T08:24:31.466Z');
    sync.detach();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// D. The rest of the create path pre-fills nothing either
// ════════════════════════════════════════════════════════════════════════════
section('D. Create-path pre-fills');

// D1..D4: the wizard's own land row. Clicking through the wizard untouched used
// to put 100,000 sqm at 500/sqm, so 50m of land cost, into the model.
const draft = makeDefaultWizardDraft();
check('D1 the wizard opens with exactly one land row', draft.parcels.length === 1);
check('D2 the wizard land row has no area', draft.parcels[0].area === 0, String(draft.parcels[0].area));
check('D3 the wizard land row has no rate', draft.parcels[0].rate === 0, String(draft.parcels[0].rate));
// The split ROUTES value rather than creating it, and zeroing both halves would
// make land cost vanish once a rate was typed. Pinned so the intent is explicit
// rather than an oversight.
check('D4 the cash / in-kind split still sums to 100',
  draft.parcels[0].cashPct + draft.parcels[0].inKindPct === 100,
  `${draft.parcels[0].cashPct}/${draft.parcels[0].inKindPct}`);

const wizParcels = wizardSnap.parcels;
check('D5 the built snapshot carries no land value',
  wizParcels.every((p) => p.area === 0 && p.rate === 0),
  wizParcels.map((p) => `${p.area}x${p.rate}`).join(', '));
check('D6 makeDefaultParcel (store default + migrator fallback) is empty too',
  makeDefaultParcel().area === 0 && makeDefaultParcel().rate === 0);
check('D7 the store default state carries no land value',
  DEFAULT_MODULE1_STATE.parcels.every((p) => p.area === 0 && p.rate === 0));

// D8..D11: source level for the two UI factories, which are inside a component
// that cannot be rendered under tsx (CSS module import), so they are asserted
// at source in the same way the strategy dropdown is.
check('D8 handleAddParcel adds an empty land row',
  /addParcel\(\{[\s\S]{0,220}area: 0,\s*\n\s*rate: 0,/.test(SRC_ASSETS));
check('D9 handleAddSubUnit adds no count, area or price',
  /metricValue: 0,/.test(SRC_ASSETS)
  && /unitArea: asset\.strategy === 'Lease' \? undefined : 0,/.test(SRC_ASSETS)
  && /unitPrice: 0,/.test(SRC_ASSETS));
check('D10 handleAddSubUnit no longer seeds occupancy or margin',
  !/occupancyPct: ops\.occupancyPct/.test(SRC_ASSETS)
  && !/operatingMargin: ops\.operatingMargin/.test(SRC_ASSETS));
check('D11 the strategy-derived STRUCTURE is still chosen for the user',
  /category = asset\.strategy === 'Lease' \? 'Leasable'/.test(SRC_ASSETS)
  && /metric: asset\.strategy === 'Lease' \? 'area' : 'units',/.test(SRC_ASSETS));

// D12: the empty land row must not become a WALL. The wizard's step 2 gate read
// `p.area > 0 && p.rate > 0`, which was harmless while the row arrived
// pre-filled and would have blocked Next the moment it did not. The wizard
// already ships no assets and no sub-units and defers them to Tab 2; land is a
// row to fill in on the same terms.
check('D12 the wizard does not require land to proceed',
  /p\.area >= 0 && p\.rate >= 0/.test(SRC_WIZARD_UI)
  && !/p\.area > 0 && p\.rate > 0/.test(SRC_WIZARD_UI));
check('D13 ...but the cash / in-kind split must still sum to 100',
  /Math\.abs\(p\.cashPct \+ p\.inKindPct - 100\) < 0\.1/.test(SRC_WIZARD_UI));

// ════════════════════════════════════════════════════════════════════════════
// E. A share basis with a zero denominator must not DROP the cost
// ════════════════════════════════════════════════════════════════════════════
section('E. Degenerate allocation basis');

// This is the guard that had to exist before the land pre-fill could go: with
// no land in the phase, every asset's land_share was 0, the shares summed to 0
// instead of 1, and a project-level lump sum was allocated to nobody. Measured
// before the fix: a fixed 1,000,000 line moved total capex by 0.
function capexWith(area: number, basis: string, includeLine: boolean): number {
  const snap = buildWizardSnapshot(makeDefaultWizardDraft()) as unknown as Record<string, unknown>;
  const phaseId = (snap.phases as Array<{ id: string }>)[0].id;
  const parcels = (snap.parcels as Array<Record<string, unknown>>).map((p) => ({ ...p, area, rate: 500 }));
  const asset = {
    id: 'a1', phaseId, name: 'Tower', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
  };
  const su = {
    id: 'su1', assetId: 'a1', name: 'Apartments', category: 'Sellable',
    metric: 'units', metricValue: 40, unitArea: 100, unitPrice: 900_000,
  };
  const costLines = [...(snap.costLines as Array<Record<string, unknown>>)];
  if (includeLine) {
    costLines.push({
      id: `probe__${phaseId}`, phaseId, name: 'Probe fixed cost',
      method: 'fixed', value: PROBE_AMOUNT, stage: 'soft', scope: 'indirect',
      allocationBasis: basis, startPeriod: 1, endPeriod: 1, phasing: 'even',
    });
  }
  const state = { ...snap, parcels, assets: [asset], subUnits: [su], costLines };
  const fin = computeFinancialsSnapshot(state as never) as unknown as Record<string, unknown>;
  const dcf = fin.directCF as Record<string, unknown>;
  return ((dcf.capexPerPeriod as number[]) ?? []).reduce((s, v) => s + (v ?? 0), 0);
}
const PROBE_AMOUNT = 1_000_000;
const landed = (area: number, basis: string): number =>
  Math.abs(capexWith(area, basis, true) - capexWith(area, basis, false));

for (const basis of ['land_share', 'bua_share', 'per_asset']) {
  const d = landed(0, basis);
  check(`E1 ${basis}: a fixed cost still lands with a ZERO denominator`,
    Math.abs(d - PROBE_AMOUNT) < 1, `moved ${d}`);
}
for (const basis of ['land_share', 'bua_share', 'per_asset']) {
  const d = landed(100_000, basis);
  check(`E2 ${basis}: unchanged at a real denominator`,
    Math.abs(d - PROBE_AMOUNT) < 1, `moved ${d}`);
}
// The fallback must be a SPLIT, not a duplication: shares still sum to 1.
{
  const phaseAssets = [
    { id: 'a1', visible: true } as never,
    { id: 'a2', visible: true } as never,
    { id: 'c1', visible: true, isCompanion: true } as never,
  ];
  const share = (id: string): number => resolveAllocationFactor(
    'land_share', { id, visible: true } as never, phaseAssets, [], [], 'autoByBua');
  const total = share('a1') + share('a2') + share('c1');
  check('E3 the fallback splits, it does not duplicate', Math.abs(total - 1) < 1e-9, `sum=${total}`);
  check('E4 a companion takes no area-based share', share('c1') === 0);
  check('E5 the two real assets split it evenly',
    Math.abs(share('a1') - 0.5) < 1e-9 && Math.abs(share('a2') - 0.5) < 1e-9);
}
check('E6 no eligible asset means no allocation (nothing to allocate to)',
  resolveAllocationFactor('land_share', { id: 'x', visible: true } as never, [], [], [], 'autoByBua') === 0);
check('E7 the driver path got the same fallback, not just the basis path',
  resolveDriverFactor('land_share', { id: 'a1', visible: true } as never,
    [{ id: 'a1', visible: true } as never], [], [], 'autoByBua') === 1);
// Six call sites: bua / gfa / land on the basis path, and bua / land /
// value_share on the driver path. One definition, so a future basis cannot get
// a subtly different fallback.
check('E8 the fallback is ONE shared helper covering every share path',
  (SRC_CALC.match(/equalPhaseShare\(asset, phaseAssets\)/g) ?? []).length === 6
  && (SRC_CALC.match(/function equalPhaseShare/g) ?? []).length === 1);
check('E9 no share path still returns a bare 0 on a zero denominator',
  !/total(Bua|Gfa|Land) > 0 \? my(Bua|Gfa|Land) \/ total(Bua|Gfa|Land) : 0;/.test(SRC_CALC));

// ── Run ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await versionIdentityEndToEnd();

  console.log('');
  if (failures.length === 0) {
    console.log(`verify-new-project-defaults: ${passed} passed, 0 failures`);
    process.exit(0);
  }
  console.log(`verify-new-project-defaults: ${passed} passed, ${failures.length} FAILURES`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
void main();
