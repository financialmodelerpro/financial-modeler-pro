/**
 * verify-asset-type-standards.ts (2026-09-07, land planning step 1, mig 242)
 *
 * The firm's asset type registry and company standards: account-scoped tables
 * (refm_asset_types + refm_account_standards), the pure stamping lib
 * (lib/state/assetTypeStandards.ts), the /api/refm/asset-types route and the
 * Assets tab picker.
 *
 * What it proves, and why each check exists:
 *   A. THE ENGINE NEVER READS THE TABLES OR THE STAMP. The whole design rests
 *      on this: standards stamp onto the asset at selection time so an old
 *      version recomputes identically after the firm edits its standards.
 *   B. A BLANK AND A TYPED ZERO ARE DIFFERENT ANSWERS, through the stamp
 *      (absent key vs 0) and through the database (NULL vs 0).
 *   C. NO EXISTING PROJECT CHANGES: the new Asset fields are additive, the
 *      hydrate path invents nothing, and every LIVE project's latest snapshot
 *      hydrates to identical area inputs with no asset type stamp appearing.
 *   D. The route is guarded (session + account filter) and fails soft on GET.
 *   E. The live schema matches the migration (shape, uniques, RLS, cascades
 *      proven by the applier; re-probed read-only here).
 *
 * Live checks REQUIRE credentials (.env.local via the suite runner). This
 * verifier does not skip silently: missing credentials FAIL the live section.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-asset-type-standards.ts
 *
 * No em dashes in this file.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  normaliseAssetTypeId,
  describeStandardValue,
  describeValues,
  typesWithoutStandard,
  sortAssetTypes,
  resolveAvgUnitSize,
  resolveParkingRatio,
  assetTypeValuesAreEmpty,
  orphanedValueTypeIds,
  REVENUE_RATE_UNITS,
  type AssetTypeStandard,
  type AssetTypeValues,
} from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { m1Tabs } from '../src/hubs/modeling/platforms/refm/lib/moduleTabs';
import { TAB_CONTENT } from '../src/hubs/modeling/platforms/refm/lib/guide/guideContent';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  ASSET_TYPES_BY_CATEGORY,
  ASSET_TYPE_CATALOG,
  assetTypeCategory,
  assetTypeCatalogForProjectType,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { inactiveLeverReason, nonEconomicLeverReason } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

// ── A. Engine and export isolation ──────────────────────────────────────────
// These paths hold everything that computes or renders a number. None of them
// may mention the registry tables or the stamp fields. The Module 6 picker
// gate (assumptionGrid) and the Assets tab UI are the DELIBERATE readers and
// are excluded.
const FORBIDDEN_TOKENS = [
  'refm_asset_types', 'refm_account_standards', 'assetTypeStandards', 'assetTypeId',
  // The project's asset type values and the sub-unit parking override are
  // model inputs that NOTHING calculates from yet: capex and revenue still
  // take their rates where they always did.
  'assetTypeValues', 'constructionCostPerSqm', 'revenueRateUnit', 'parkingRatio',
  'parkingAreaPerSlotSqm',
];

/**
 * ONE exclusion, and it is not a hole.
 *
 * `landChain.ts` (land planning step 2) DECLARES a parameter shape that names
 * `parkingRatio` and `parkingAreaPerSlotSqm`: the caller passes the resolved
 * standards in, and the file itself reads no project, no asset and no table.
 * Excluding it keeps the check aimed at what it means, which is "no engine
 * file READS the standards", rather than at the spelling of a parameter.
 *
 * The exclusion is safe only while nothing in the engine calls that file, so
 * A2 asserts exactly that here rather than relying on another verifier to.
 */
const CHAIN_DEFINITION = 'src/core/calculations/landChain.ts';

/**
 * A minimal stand-in for the module 1 store's project slice, carrying the ONE
 * merge rule `setAssetTypeValue` implements. Mirrored deliberately rather than
 * imported: the store pulls in zustand and the whole snapshot type graph, and
 * this verifier must stay loadable under tsx. Check S1 asserts the real store
 * still implements the same three behaviours, so a drift here is caught.
 */
function makeStoreLike(initial: Record<string, AssetTypeValues>): {
  project: { assetTypeValues?: Record<string, AssetTypeValues> };
  setAssetTypeValue: (id: string, patch: Partial<AssetTypeValues>) => void;
} {
  const state = { project: { assetTypeValues: { ...initial } } as { assetTypeValues?: Record<string, AssetTypeValues> } };
  return {
    get project() { return state.project; },
    setAssetTypeValue(id, patch) {
      const all = { ...(state.project.assetTypeValues ?? {}) };
      const next = { ...(all[id] ?? {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      if (Object.keys(next).length === 0) delete all[id];
      else all[id] = next as AssetTypeValues;
      state.project = { ...state.project, assetTypeValues: all };
    },
  };
}
const ENGINE_ROOTS = [
  'src/core/calculations',
  'src/hubs/modeling/platforms/refm/lib/excel',
  'src/hubs/modeling/platforms/refm/lib/pdf',
  'src/hubs/modeling/platforms/refm/lib/reports',
  'src/hubs/modeling/platforms/refm/lib/pptx',
  'src/hubs/modeling/platforms/refm/lib/ai',
  'src/hubs/modeling/platforms/refm/lib/portfolio',
];
const ENGINE_FILES = [
  'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
  'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts',
  'src/hubs/modeling/platforms/refm/lib/opex-resolvers.ts',
  'src/hubs/modeling/platforms/refm/lib/costOfSales.ts',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function offlineChecks(): void {
  section('A. The engine, exports and reports never read the registry or the stamp');
  const files: string[] = [];
  for (const root of ENGINE_ROOTS) {
    try { files.push(...walk(root)); } catch { /* root may not exist */ }
  }
  for (const f of ENGINE_FILES) {
    try { statSync(f); files.push(f); } catch { /* optional */ }
  }
  check('A0 the scan actually covers files (engine roots resolved)', files.length > 50, `only ${files.length} files`);
  const offenders: string[] = [];
  for (const f of files) {
    if (f.replace(/\\/g, '/') === CHAIN_DEFINITION) continue;
    const src = readFileSync(f, 'utf8');
    for (const tok of FORBIDDEN_TOKENS) {
      if (src.includes(tok)) offenders.push(`${f} :: ${tok}`);
    }
  }
  check('A1 zero references to the tables or stamp fields across the calculation and export surface',
    offenders.length === 0, offenders.slice(0, 5).join(' | '));
  // The exclusion above is only safe while the excluded file is unreachable
  // from the engine. Proven here, not assumed.
  const chainCallers = files
    .filter((f) => f.replace(/\\/g, '/') !== CHAIN_DEFINITION)
    .filter((f) => readFileSync(f, 'utf8').includes('landChain'));
  check('A2 the excluded chain file is called by NOTHING in the calculation or export surface',
    chainCallers.length === 0, chainCallers.slice(0, 3).join(' | '));

  section('B. Blank and zero are different answers, in the PROJECT values');
  const blankValues: AssetTypeValues = {};
  const zeroValues: AssetTypeValues = { avgUnitSizeSqm: 450, parkingRatio: 0, parkingRatioBasis: 'slots_per_unit', constructionCostPerSqm: 0 };
  check('B1 a blank value is an ABSENT key (never null, never 0)',
    !('avgUnitSizeSqm' in blankValues) && !('parkingRatio' in blankValues)
    && assetTypeValuesAreEmpty(blankValues) && !assetTypeValuesAreEmpty(zeroValues));
  check('B2 a typed zero is a real 0 that survives a JSON round trip',
    zeroValues.parkingRatio === 0 && zeroValues.constructionCostPerSqm === 0
    && (JSON.parse(JSON.stringify(zeroValues)) as AssetTypeValues).parkingRatio === 0
    && !('parkingRatio' in (JSON.parse(JSON.stringify(blankValues)) as object)));
  check('B3 the store CLEARS a field with undefined rather than keeping the key',
    (() => {
      const st = makeStoreLike({ villas: { avgUnitSizeSqm: 200, parkingRatio: 0 } });
      st.setAssetTypeValue('villas', { avgUnitSizeSqm: undefined });
      const v = st.project.assetTypeValues?.villas ?? {};
      return !('avgUnitSizeSqm' in v) && v.parkingRatio === 0;
    })());
  check('B4 the caption never prints a blank as 0',
    describeStandardValue(undefined, 'sqm') === 'not set'
    && describeStandardValue(0, 'sqm') === '0 sqm'
    && describeValues(blankValues).includes('not set')
    // The build cost line left the caption with its column (2026-09-08); the
    // blank-versus-zero rule is asserted on a standard the caption still
    // states, so this keeps testing the rule rather than a removed line.
    && describeValues(zeroValues).includes('Parking 0 slots/unit'));
  check('B5 id normalisation matches the catalog shape rule',
    normaliseAssetTypeId('High End Apartments') === 'high-end-apartments'
    && normaliseAssetTypeId('***') === '');

  // Quick-add sources: ONE covered-already rule for both lists.
  const covered: AssetTypeStandard[] = [
    { id: 'high-end-apartments', label: 'High End Apartments' },
    { id: 'villas', label: 'Villas' },
  ];
  const offered = typesWithoutStandard(
    ['  ', 'Retail Mall', 'retail mall', 'Villas', 'High-End  Apartments', 'Hotel 4-star', 'Retail Mall'],
    covered,
  );
  check('B6 typesWithoutStandard drops blanks, dedupes case-insensitively (first spelling wins), keeps order',
    JSON.stringify(offered) === JSON.stringify(['Retail Mall', 'Hotel 4-star']), JSON.stringify(offered));
  check('B7 covered detection matches by normalised id AND case-insensitive label (a differently-spelled duplicate is never re-offered)',
    !offered.includes('High-End  Apartments') && !offered.includes('Villas')
    && typesWithoutStandard(['Brand New Type'], covered).length === 1);

  section('C. Additive schema: hydrate invents nothing and carries the project values');
  const baseAsset = {
    id: 'asset_1', phaseId: 'phase_1', name: 'Tower', type: 'High-end Apartments',
    strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0,
    parkingBaysRequired: 0, supportArea: 1400, parkingArea: 2800,
  };
  const mkSnapshot = (asset: Record<string, unknown>): Record<string, unknown> => ({
    version: 8,
    project: { projectName: 'Probe', modelType: 'annual', currency: 'USD' },
    phases: [{ id: 'phase_1', name: 'Phase 1', constructionPeriods: 2, operationsPeriods: 3, constructionStart: 0 }],
    parcels: [{ id: 'parcel_1', phaseId: 'phase_1', name: 'Land 1', area: 1000, rate: 100, cashPct: 100, inKindPct: 0 }],
    assets: [asset], subUnits: [], costLines: [], costOverrides: [], financingTranches: [],
    landAllocationMode: 'sqm',
  });
  const plain = hydrationFromAnySnapshot(mkSnapshot({ ...baseAsset }));
  const plainAsset = plain.assets[0] as unknown as Record<string, unknown>;
  check('C1 a legacy asset hydrates WITHOUT the type reference (nothing invented)',
    !('assetTypeId' in plainAsset) && !('assetTypeStandards' in plainAsset));

  // THE VALUES RIDE IN THE SNAPSHOT, which is the whole point of the split:
  // that is what makes them version, diff and change-log like any other input.
  const withValues = hydrationFromAnySnapshot({
    ...mkSnapshot({ ...baseAsset, assetTypeId: 'villas' }),
    project: {
      projectName: 'Probe', modelType: 'annual', currency: 'USD',
      parkingAreaPerSlotSqm: 40,
      assetTypeValues: { villas: { avgUnitSizeSqm: 450, parkingRatio: 0, parkingRatioBasis: 'slots_per_unit' } },
    },
  });
  const carriedValues = (withValues.project as unknown as { assetTypeValues?: Record<string, AssetTypeValues> })
    .assetTypeValues?.villas;
  check('C2 project values survive hydrate VERBATIM (the project normaliser spreads, it does not whitelist)',
    carriedValues?.avgUnitSizeSqm === 450 && carriedValues?.parkingRatio === 0
    && (withValues.project as unknown as { parkingAreaPerSlotSqm?: number }).parkingAreaPerSlotSqm === 40
    && (withValues.assets[0] as unknown as Record<string, unknown>).assetTypeId === 'villas');
  check('C2b NOTHING is stamped onto the asset any more',
    !('assetTypeStandards' in (withValues.assets[0] as unknown as Record<string, unknown>)));
  // A snapshot written by the PREVIOUS build carries a stamp. Hydrate must
  // STRIP it, or the spread would carry a dead second home for these values
  // forever and re-save it on every write. One live asset had one.
  const legacy = hydrationFromAnySnapshot(mkSnapshot({
    ...baseAsset,
    assetTypeId: 'branded-apartments-high',
    assetTypeStandards: { label: 'Branded Apartments High', category: 'Residential', stampedAt: '2026-09-07T11:14:31.688Z' },
  }));
  const legacyAsset = legacy.assets[0] as unknown as Record<string, unknown>;
  check('C2c a LEGACY stamp is stripped on hydrate, and the type reference survives',
    !('assetTypeStandards' in legacyAsset) && legacyAsset.assetTypeId === 'branded-apartments-high');
  const areaKeys = ['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'supportArea', 'parkingArea', 'parkingBaysRequired', 'type'] as const;
  const valuedAsset = withValues.assets[0] as unknown as Record<string, unknown>;
  check('C3 carrying values changes NO area input on the asset',
    areaKeys.every((k) => JSON.stringify(plainAsset[k]) === JSON.stringify(valuedAsset[k])));
  check('C4 values for a type the firm removed are KEPT and reported, not deleted',
    JSON.stringify(orphanedValueTypeIds(
      { villas: { avgUnitSizeSqm: 450 }, gone: { parkingRatio: 2 }, empty: {} },
      [{ id: 'villas', label: 'Villas' }],
    )) === JSON.stringify(['gone']));

  section('D. Route guard and picker gate (source-level)');
  const route = readFileSync('app/api/refm/asset-types/route.ts', 'utf8');
  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  const shell = readFileSync('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', 'utf8');
  const assetsTab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  const storeSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  const lib = readFileSync('src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards.ts', 'utf8');
  check('D1 every method requires a session (4 getRefmUserId guards)',
    (route.match(/getRefmUserId/g) ?? []).length >= 5 && route.includes('unauthorized()'));
  check('D2 every query is account-filtered through resolveAccountId',
    (route.match(/resolveAccountId/g) ?? []).length >= 5
    && route.includes(`.eq('account_id', accountId)`));
  check('D3 GET fails soft with available:false (never a calculation-path error)',
    route.includes('available: false'));
  check('D4 the tab parses values without coercing (blank stays blank, no Number(null))',
    tab.includes('parseValue') && !/Number\(\s*null\s*\)/.test(tab));
  // D5 IS THE REVERSE OF WHAT IT USED TO ASSERT, and deliberately so. It
  // required the firm's controls to opt INTO the project view lock, which
  // greyed out an account-scoped shared vocabulary because some project
  // happened to be open read-only. The lock belongs to model data. The firm's
  // half is not model data, so it declares neither the button opt-in nor the
  // input default, and D5b holds the other side: the project values must STILL
  // lock, or this would have swapped one wrong answer for another.
  const valueCell = tab.slice(tab.indexOf('function ValueCell('), tab.indexOf('export default function'));
  check('D5 the FIRM half is free of the project view lock (buttons opt out, inputs opt out)',
    // The ATTRIBUTE, not the word: the file's own docblock explains why the
    // opt-in is absent, and a bare substring match reads that sentence as the
    // very thing it says is gone.
    !/data-view-mutates=/.test(tab)
    && ['std-row-${d.entryId}-label', 'std-row-${d.entryId}-category', 'std-add-label', 'std-add-category']
      .every((t) => {
        const at = tab.indexOf(t);
        return at > 0 && tab.lastIndexOf('data-view-editable="true"', at) > tab.lastIndexOf('<input', at);
      }));
  check('D5b the PROJECT values still lock with the project (no opt-out on any value control)',
    valueCell.length > 200
    && !valueCell.includes('data-view-editable')
    && !tab.slice(tab.indexOf('std-row-${id}-basis') - 400, tab.indexOf('std-row-${id}-basis'))
      .includes('data-view-editable'));
  check('D5c busy is KEYED per row, so one in-flight request cannot disable another row',
    tab.includes('const [busyKey')
    && tab.includes('const rowBusy =')
    && !/\bbusy\b/.test(tab)
    && tab.includes('rowBusy(d.entryId ?? ADD_KEY)')
    && tab.includes('rowBusy(d.entryId!)')
    // The reorder is the ONE list-wide operation, and says so with its own key.
    && (tab.match(/rowBusy\(ORDER_KEY\)/g) ?? []).length === 2);
  check('D6 the asset picker records the REFERENCE and stamps nothing',
    assetsTab.includes('assetTypeId: entry.id')
    && !assetsTab.includes('stampFromAssetType')
    // The FIELD, not the module path: the lib file is still imported by name.
    && !/\.assetTypeStandards|assetTypeStandards\s*[:=]/.test(assetsTab));
  check('D6b the asset card reads its values LIVE from the project',
    assetsTab.includes('project.assetTypeValues?.[asset.assetTypeId]')
    && assetsTab.includes('describeValues(typeValues, project.parkingAreaPerSlotSqm)'));
  check('D8 the tab offers BOTH quick-add sources through the one helper (platform catalog picker + project types missing a standard)',
    (tab.match(/typesWithoutStandard\(/g) ?? []).length >= 3
    && tab.includes('asset-type-catalog-picker')
    && tab.includes('asset-type-project-missing')
    && tab.includes('assetTypeCatalogForProjectType') && tab.includes('projectTypesInUse'));
  check('D9 quick-add only PREFILLS the add row (free text stays; no write fires on pick)',
    tab.includes('prefillLabel')
    && !/prefillLabel[\s\S]{0,200}?fetch\(/.test(tab.slice(tab.indexOf('const prefillLabel'), tab.indexOf('const prefillLabel') + 400)));
  check('D11 the tab reads the catalog for the PROJECT TYPE and the distinct used types',
    tab.includes('assetTypeCatalogForProjectType(project.projectType)') && tab.includes('projectTypesInUse'));
  // (The old D7 asserted the STAMP was dropped from the Module 6 picker. The
  // stamp no longer exists, so that check could only ever pass by accident;
  // S4 and S5 state the live rule instead: the values are gated as INACTIVE
  // and the type reference stays non-economic.)
  check('D7 a real lever is still offered (the gate has not swallowed everything)',
    nonEconomicLeverReason('assets[asset_1].landAllocation.sqm', 'landAllocation.sqm') === null);

  section('G. The asset type catalog IS the reference list (2026-09-07c)');
  check('G1 the catalog holds exactly the reference list, in category order',
    JSON.stringify(ASSET_TYPES_BY_CATEGORY.Residential)
      === JSON.stringify(['Branded Villas', 'High End Apartments', 'Branded Apartments High', 'Branded Apartments Mid', 'Apartments', 'Residential'])
    && JSON.stringify(ASSET_TYPES_BY_CATEGORY.Hospitality) === JSON.stringify(['Resort 5 Star', '4 Star Hotel'])
    && JSON.stringify(ASSET_TYPES_BY_CATEGORY.Retail) === JSON.stringify(['Standalone Commercial', 'Retail combined'])
    && ASSET_TYPE_CATALOG.length === 10);
  check('G2 assetTypeCategory resolves catalog labels (trimmed, case-insensitive) and nothing else',
    assetTypeCategory('High End Apartments') === 'Residential'
    && assetTypeCategory(' resort 5 star ') === 'Hospitality'
    && assetTypeCategory('Retail combined') === 'Retail'
    && assetTypeCategory('Hotel 4-star') === undefined
    && assetTypeCategory('') === undefined);
  check('G3 category-named project types narrow to their category; everything else gets the full catalog, as STABLE references',
    assetTypeCatalogForProjectType('Residential') === ASSET_TYPES_BY_CATEGORY.Residential
    && assetTypeCatalogForProjectType('Retail') === ASSET_TYPES_BY_CATEGORY.Retail
    && assetTypeCatalogForProjectType('Mixed-Use') === ASSET_TYPE_CATALOG
    && assetTypeCatalogForProjectType(undefined) === ASSET_TYPE_CATALOG
    && assetTypeCatalogForProjectType('Office') === ASSET_TYPE_CATALOG);
  const typesSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-types.ts', 'utf8');
  check('G4 the old per-project-type and per-strategy banks are REMOVED (no declaration, no consumer)',
    !typesSrc.includes('export const ASSET_TYPES_BY_PROJECT_TYPE')
    && !typesSrc.includes('export const ASSET_TYPES_BY_STRATEGY')
    && !assetsTab.includes('ASSET_TYPES_BY_PROJECT_TYPE')
    && !assetsTab.includes('ASSET_TYPES_BY_STRATEGY'));
  // RE-AIMED 2026-09-07 (step 3 commit 2): the Type field moved out of the
  // asset card and into the assets TABLE, so this now pins the row's input
  // and its datalist. The invariant is unchanged (the type stays FREE TEXT
  // with suggestions, rather than becoming a closed dropdown); only the
  // element's home moved, and pinning the old home would have asserted the
  // layout rather than the rule.
  check('G5 free text stays (the Type cell is still a text input with suggestions) and a catalog pick prefills its category',
    /input[^>]*list=\{`asset-row-types-/.test(assetsTab.replace(/\n\s*/g, ' '))
    && assetsTab.includes('<datalist id={`asset-row-types-')
    && tab.includes('assetTypeCategory('));

  section('H. The standards live on their OWN TAB, not in a dialog (2026-09-07d)');
  const tabIdx = m1Tabs.findIndex((t) => t.key === 'asset-standards');
  const assetsIdx = m1Tabs.findIndex((t) => t.key === 'assets');
  check('H1 the tab is registered in m1Tabs, immediately BEFORE Assets (source before consumer)',
    tabIdx >= 0 && assetsIdx === tabIdx + 1, `standards at ${tabIdx}, assets at ${assetsIdx}`);
  check('H2 every Module 1 tab label is numbered by its own position, so the insert renumbered the rest',
    m1Tabs.every((t, i) => t.label.startsWith(`${i + 1}. `) && t.step === i + 1),
    m1Tabs.map((t) => t.label).join(' | '));
  check('H3 the guide carries the new tab (verify-platform-guide fails without it)',
    !!TAB_CONTENT['module1/asset-standards']
    && TAB_CONTENT['module1/asset-standards'].intro.length > 40
    && (TAB_CONTENT['module1/asset-standards'].steps ?? []).length >= 3);
  check('H4 the shell renders it on its key',
    shell.includes(`activeTab === 'asset-standards'`) && shell.includes('<Module1AssetStandards projectId='));
  check('H5 the DIALOG is gone: no modal file, no importer, no opener',
    !existsSync('src/hubs/modeling/platforms/refm/components/modals/AssetTypeStandardsModal.tsx')
    && !assetsTab.includes('AssetTypeStandardsModal')
    && !assetsTab.includes('open-asset-type-standards'));
  check('H6 the tab follows the OpEx table pattern (navy header row, one editable row per type, an add row)',
    tab.includes("background: 'var(--color-navy)'") && tab.includes('<thead>')
    && tab.includes('std-add-save') && tab.includes('data-testid="asset-standards-table"'));

  section('I. The list is the firm\'s: editable, extensible, orderable');
  check('I1 a row can be renamed, re-categorised, removed and reordered from the tab',
    tab.includes('-label') && tab.includes('-category') && tab.includes('-delete')
    && tab.includes('-up') && tab.includes('-down') && tab.includes("method: 'PUT'"));
  check('I2 the reference list is a STARTING SET offered by a button, never auto-written',
    tab.includes('asset-type-seed-standard-list') && tab.includes('seedStandardList')
    && !/useEffect\([^)]*seedStandardList/.test(tab));
  check('I3 the route reorders with a whole-list dense write and refuses a stranger id',
    route.includes('export async function PUT')
    && route.includes('sort_order: i')
    // ONE batched write, not a loop of one-per-row: a loop was ten sequential
    // round trips and left a half-applied order when one failed midway.
    && !route.includes('for (let i = 0; i < order.length')
    && route.includes('not in your list'));
  check('I4 sortAssetTypes keeps "never reordered" (absent) apart from "first" (0)',
    JSON.stringify(sortAssetTypes([
      { id: 'c', label: 'C' },
      { id: 'a', label: 'A', sortOrder: 0 },
      { id: 'b', label: 'B', sortOrder: 1 },
    ]).map((e) => e.id)) === JSON.stringify(['a', 'b', 'c']));

  section('J. Rates carry a unit, and live on the PROJECT');
  check('J1 the values type holds the rate with its unit and the build cost',
    (() => {
      const st = makeStoreLike({});
      st.setAssetTypeValue('hotel', { revenueRate: 900, revenueRateUnit: 'adr_per_key_night', constructionCostPerSqm: 0 });
      const v = st.project.assetTypeValues?.hotel;
      return v?.revenueRate === 900 && v?.revenueRateUnit === 'adr_per_key_night' && v?.constructionCostPerSqm === 0;
    })());
  // ── HIDDEN, NOT DROPPED (2026-09-08) ────────────────────────────────────
  //
  // The construction cost, the revenue rate and its unit are no longer shown:
  // nothing reads them, so a rate on screen invites the question of where it
  // applies, and today the answer is nowhere. J2 and J3 used to assert those
  // surfaces existed; they now assert the STORAGE survives their removal,
  // which is the promise that matters, because the columns come back when
  // Capex and revenue are wired to read from here.
  check('J2 the rate vocabulary and the fields still EXIST in code, ready for the wiring',
    REVENUE_RATE_UNITS.length === 4
    && lib.includes('constructionCostPerSqm?: number;')
    && lib.includes('revenueRate?: number;')
    && lib.includes('revenueRateUnit?: RevenueRateUnit;')
    && storeSrc.includes('setAssetTypeValue:'));
  check('J3 the three hidden values still round-trip through the store untouched',
    (() => {
      const st = makeStoreLike({ villas: { avgUnitSizeSqm: 260 } });
      st.setAssetTypeValue('villas', { constructionCostPerSqm: 11000, revenueRate: 20000, revenueRateUnit: 'per_sqm' });
      const v = st.project.assetTypeValues?.villas;
      return v?.constructionCostPerSqm === 11000 && v?.revenueRate === 20000
        && v?.revenueRateUnit === 'per_sqm' && v?.avgUnitSizeSqm === 260;
    })());
  check('J3b no COLUMN for them survives on the tab, and none is left behind a false condition',
    !tab.includes('-build-cost') && !tab.includes('-revenue-rate') && !tab.includes('-revenue-unit')
    && !tab.includes('Construction cost / sqm') && !tab.includes('Revenue rate') && !tab.includes('Rate unit')
    && !/\{\s*false\s*&&/.test(tab)
    && !describeValues({ revenueRate: 900, revenueRateUnit: 'adr_per_key_night' }).includes('900'));
  check('J4 the ACCOUNT route no longer carries any value: names, categories and order only',
    !route.includes('avg_unit_size') && !route.includes('parking_ratio')
    && !route.includes('construction_cost_per_sqm') && !route.includes('revenue_rate')
    && !route.includes('refm_account_standards')
    && route.includes("'entry_id, label, category, sort_order, created_at'"));
  check('J5 the account-scalar PATCH is gone with the table it wrote to',
    !route.includes('export async function PATCH'));

  section('K. Unit size falls back; parking inherits and overrides');
  const projectValues: AssetTypeValues = { avgUnitSizeSqm: 120, parkingRatio: 1, parkingRatioBasis: 'slots_per_unit' };
  check('K1 sub-unit areas WIN over the asset type average (they are more precise)',
    resolveAvgUnitSize([80, 120], projectValues).source === 'sub_units'
    && resolveAvgUnitSize([80, 120], projectValues).value === 100);
  check('K2 the asset type average is the FALLBACK when no sub-unit states one',
    resolveAvgUnitSize([], projectValues).source === 'asset_type'
    && resolveAvgUnitSize([], projectValues).value === 120
    && resolveAvgUnitSize([undefined, 0], projectValues).source === 'asset_type');
  check('K3 with neither, the answer is "unset", never 0',
    resolveAvgUnitSize([], undefined).source === 'unset'
    && resolveAvgUnitSize([], undefined).value === undefined);
  check('K4 a sub-unit parking override wins, and a typed ZERO is a real override',
    resolveParkingRatio(2, projectValues).source === 'sub_unit'
    && resolveParkingRatio(0, projectValues).source === 'sub_unit'
    && resolveParkingRatio(0, projectValues).value === 0);
  check('K5 with no override the asset type default applies, and with neither it is "unset"',
    resolveParkingRatio(undefined, projectValues).source === 'asset_type'
    && resolveParkingRatio(undefined, projectValues).value === 1
    && resolveParkingRatio(undefined, undefined).source === 'unset');
  check('K6 the sub-unit row renders inherit / override through the ONE resolver, against PROJECT values',
    assetsTab.includes('resolveParkingRatio(subUnit.parkingRatio, assetTypeValues)')
    && assetsTab.includes('-parking-override') && assetsTab.includes('-parking-inherit'));

  section('S. The values are PROJECT INPUTS, gated as inactive until the engine reads them');
  check('S1 the store owns the merge rule, clears with undefined and drops an emptied entry',
    storeSrc.includes('setAssetTypeValue:')
    && storeSrc.includes('if (v === undefined) delete next[k]')
    && storeSrc.includes('if (Object.keys(next).length === 0) delete all[entryId]'));
  check('S2 the tab writes values through that action (no hand-rolled setProject merge)',
    tab.includes('setAssetTypeValue(') && !tab.includes('setProject({ assetTypeValues'));
  check('S3 the values have NO Save button: they behave like every other model input',
    !/std-row-\$\{id\}-values-save/.test(tab) && tab.includes('onCommit'));
  // THE TWO HALVES MUST BE TELLABLE APART (2026-09-08). The Save button used
  // to sit at the END of the row, past the project values, so it read as
  // saving the whole row. Everything it saves now sits beside it, left of a
  // divider, with each half's saving behaviour stated in its own group header.
  check('S3b every control that needs Save is LEFT of the divider, and the project values are right of it',
    tab.includes('const DIVIDER') && tab.includes('TD_PROJECT_FIRST')
    && tab.includes('std-group-firm') && tab.includes('std-group-project')
    && tab.includes('Press Save to apply a change')
    && tab.includes('Saves as you type')
    // THE ORDER IS THE INVARIANT: Save is rendered BEFORE the project values,
    // so it cannot read as saving them. (A first attempt also matched Save to
    // Remove within 400 characters, which failed on the good layout because
    // the tooltips are longer than that: it was asserting the length of a
    // title attribute, not the arrangement of the row.)
    && tab.indexOf('std-row-${d.entryId}-save') < tab.indexOf('{valueCells(d.entryId')
    && tab.includes('the firm\'s half: everything here needs Save'));
  check('S4 the Module 6 picker keeps them out, as INACTIVE (economic but unread), not non-economic',
    inactiveLeverReason('project.assetTypeValues.villas.avgUnitSizeSqm', {} as never) !== null
    && inactiveLeverReason('subUnits[su_1].parkingRatio', {} as never) !== null
    && nonEconomicLeverReason('project.assetTypeValues.villas.avgUnitSizeSqm', 'assetTypeValues.villas.avgUnitSizeSqm') === null
    && nonEconomicLeverReason('subUnits[su_1].parkingRatio', 'parkingRatio') === null);
  check('S5 the type REFERENCE stays non-economic (it is an entity reference, not a dial)',
    nonEconomicLeverReason('assets[asset_1].assetTypeId', 'assetTypeId') !== null);
  check('S6 the tab needs a project for values and says so',
    tab.includes('asset-standards-no-project') && tab.includes('disabled={noProject}'));
  check('S7 a removed type keeps its values, and the tab surfaces them',
    tab.includes('orphanedValueTypeIds') && tab.includes('asset-standards-orphans'));
}

// ── Live half ───────────────────────────────────────────────────────────────
interface PgRow { [k: string]: unknown }
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: PgRow[]; rowCount: number | null }>;
  end(): Promise<void>;
}
type PgClientCtor = new (cfg: Record<string, unknown>) => PgClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: PgClientCtor };

async function liveChecks(): Promise<void> {
  section('E. Live schema (read-only probes + rolled-back write probe)');
  const dbUrl = process.env.DATABASE_URL;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl || !sbUrl || !sbKey) {
    check('E0 credentials loaded (.env.local)', false, 'DATABASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    return;
  }
  check('E0 credentials loaded (.env.local)', true);

  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const cols = await c.query(`
      SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'refm_asset_types'`);
    const names = cols.rows.map((r) => String(r.column_name));
    check('E1 the live table is a VOCABULARY table: names, category, order, author',
      ['account_id', 'user_id', 'entry_id', 'label', 'category', 'sort_order'].every((k) => names.includes(k)),
      names.join(','));
    check('E2 NO value column survives on the account table (mig 244)',
      !['avg_unit_size', 'parking_ratio', 'parking_ratio_basis', 'construction_cost_per_sqm',
        'revenue_rate', 'revenue_rate_unit'].some((k) => names.includes(k)),
      names.join(','));
    const stdsTable = await c.query(`SELECT to_regclass('public.refm_account_standards') AS t`);
    check('E3 refm_account_standards is gone (the scalar moved to the project)',
      stdsTable.rows[0].t === null);
    check('E4 the author column is NULLABLE (the entry outlives the person)',
      cols.rows.some((r) => r.column_name === 'user_id' && r.is_nullable === 'YES'));
    check('E5 sort_order is NULLABLE (never reordered stays apart from first)',
      cols.rows.some((r) => r.column_name === 'sort_order' && r.is_nullable === 'YES'));

    const uniq = await c.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'refm_asset_types_account_entry_unique'`);
    check('E6 one entry id per account (unique constraint live)', Number(uniq.rows[0]?.n) === 1);

    const rls = await c.query(`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'refm_asset_types'`);
    check('E7 RLS enabled on the vocabulary table', rls.rows[0]?.relrowsecurity === true);

    // Rolled-back probe: the vocabulary round-trips against the LIVE schema,
    // and the account unique still refuses a duplicate. The refusal sits
    // behind a SAVEPOINT because a failed statement aborts the whole
    // transaction in Postgres (TRAPS 3.21).
    await c.query('BEGIN');
    try {
      const anyAccount = await c.query(`SELECT id FROM accounts LIMIT 1`);
      if (anyAccount.rows.length === 1) {
        const accId = String(anyAccount.rows[0].id);
        const ins = await c.query(
          `INSERT INTO refm_asset_types (account_id, entry_id, label, category, sort_order)
           VALUES ($1, 'verify-probe-vocab', 'Verify Probe Vocab', 'Residential', 0)
           RETURNING label, category, sort_order`, [accId]);
        let refused = false;
        await c.query('SAVEPOINT dup_probe');
        try {
          await c.query(
            `INSERT INTO refm_asset_types (account_id, entry_id, label)
             VALUES ($1, 'verify-probe-vocab', 'Verify Probe Vocab Again')`, [accId]);
          await c.query('RELEASE SAVEPOINT dup_probe');
        } catch {
          refused = true;
          await c.query('ROLLBACK TO SAVEPOINT dup_probe');
        }
        check('E8 live round trip: a type stores its name, category and position, and a duplicate id is refused',
          ins.rows[0]?.label === 'Verify Probe Vocab' && ins.rows[0]?.category === 'Residential'
          && Number(ins.rows[0]?.sort_order) === 0 && refused);
      } else {
        check('E8 live round trip: a type stores its name, category and position, and a duplicate id is refused',
          false, 'no accounts row to probe against');
      }
    } finally {
      await c.query('ROLLBACK');
    }
    const leftover = await c.query(`SELECT count(*)::int AS n FROM refm_asset_types WHERE entry_id LIKE 'verify-probe-%'`);
    check('E9 the probe rolled back (no rows left)', Number(leftover.rows[0]?.n) === 0);
  } finally {
    await c.end();
  }

  section('F. No existing project changed (every live latest snapshot)');
  const H = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const pr = await fetch(`${sbUrl}/rest/v1/refm_projects?select=id,name&deleted_at=is.null`, { headers: H });
  const projects = await pr.json() as Array<{ id: string; name: string }>;
  check('F0 live projects reachable', Array.isArray(projects) && projects.length > 0, JSON.stringify(projects).slice(0, 120));
  let checkedProjects = 0;
  for (const p of Array.isArray(projects) ? projects : []) {
    const vr = await fetch(
      `${sbUrl}/rest/v1/refm_project_versions?select=version_number,snapshot&project_id=eq.${p.id}&order=version_number.desc&limit=1`,
      { headers: H });
    const arr = await vr.json() as Array<{ version_number: number; snapshot: Record<string, unknown> }>;
    const v = arr[0];
    if (!v) continue;
    checkedProjects += 1;
    const rawAssets = (v.snapshot.assets ?? []) as Array<Record<string, unknown>>;
    const hydrated = hydrationFromAnySnapshot(v.snapshot);
    const hydAssets = hydrated.assets as unknown as Array<Record<string, unknown>>;
    // A type REFERENCE is a legitimate user choice and may be present. What
    // must never survive is a STAMP: hydrate strips it, so no live project
    // carries one after loading, whatever its stored snapshot holds.
    const noStamp = hydAssets.every((a) => !('assetTypeStandards' in a));
    const ZERO_DEFAULTED = new Set(['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'parkingBaysRequired']);
    const keys = ['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'supportArea', 'parkingArea', 'parkingBaysRequired'] as const;
    const areasIntact = rawAssets.every((raw) => {
      const hyd = hydAssets.find((h) => h.id === raw.id);
      if (!hyd) return false;
      return keys.every((k) => {
        const before = typeof raw[k] === 'number' ? raw[k] : (ZERO_DEFAULTED.has(k) ? 0 : raw[k]);
        return JSON.stringify(hyd[k]) === JSON.stringify(before);
      });
    });
    check(`F1 ${p.name}: hydrates with identical area inputs and NO stamp appearing`, noStamp && areasIntact);
  }
  check('F2 every live project was actually checked', checkedProjects >= 4, `${checkedProjects} checked`);
}

async function main(): Promise<void> {
  console.log('=== verify-asset-type-standards ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
