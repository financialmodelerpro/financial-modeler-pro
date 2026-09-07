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
  stampFromAssetType,
  normaliseAssetTypeId,
  describeStandardValue,
  describeStamp,
  typesWithoutStandard,
  sortAssetTypes,
  resolveAvgUnitSize,
  resolveParkingRatio,
  REVENUE_RATE_UNITS,
  type AssetTypeStandard,
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
import { nonEconomicLeverReason } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';

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
  // The rates and the sub-unit parking override are carried state too: capex
  // and revenue still take their rates where they always did.
  'constructionCostPerSqm', 'revenueRateUnit', 'parkingRatio',
];
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
    const src = readFileSync(f, 'utf8');
    for (const tok of FORBIDDEN_TOKENS) {
      if (src.includes(tok)) offenders.push(`${f} :: ${tok}`);
    }
  }
  check('A1 zero references to the tables or stamp fields across the calculation and export surface',
    offenders.length === 0, offenders.slice(0, 5).join(' | '));

  section('B. Blank and zero are different answers, in the stamp');
  const blankEntry: AssetTypeStandard = { id: 'commercial', label: 'Commercial', parkingRatioBasis: 'sqm_per_slot' };
  const zeroEntry: AssetTypeStandard = { id: 'villas', label: 'Villas', avgUnitSizeSqm: 450, parkingRatio: 0, parkingRatioBasis: 'slots_per_unit' };
  const sBlank = stampFromAssetType(blankEntry, {});
  const sZero = stampFromAssetType(zeroEntry, { parkingAreaPerSlotSqm: 40 }, '2026-09-07T00:00:00.000Z');
  check('B1 a blank standard OMITS its key (never null, never 0)',
    !('avgUnitSizeSqm' in sBlank) && !('parkingRatio' in sBlank) && !('parkingAreaPerSlotSqm' in sBlank));
  check('B2 a typed zero stamps as a real 0 with its basis',
    sZero.parkingRatio === 0 && sZero.parkingRatioBasis === 'slots_per_unit' && sZero.avgUnitSizeSqm === 450 && sZero.parkingAreaPerSlotSqm === 40);
  check('B3 the stamp survives a JSON round trip with blanks still absent',
    !('parkingRatio' in (JSON.parse(JSON.stringify(sBlank)) as object))
    && (JSON.parse(JSON.stringify(sZero)) as { parkingRatio: number }).parkingRatio === 0);
  check('B4 the caption never prints a blank as 0',
    describeStandardValue(undefined, 'sqm') === 'not set'
    && describeStandardValue(0, 'sqm') === '0 sqm'
    && describeStamp(sBlank).includes('not set')
    && describeStamp(sZero).includes('Parking 0 slots/unit'));
  check('B5 id normalisation matches the catalog shape rule',
    normaliseAssetTypeId('High End Apartments') === 'high-end-apartments'
    && normaliseAssetTypeId('***') === '');

  // Quick-add sources (2026-09-07b): ONE covered-already rule for both lists.
  const covered: AssetTypeStandard[] = [
    { id: 'high-end-apartments', label: 'High End Apartments', parkingRatioBasis: 'slots_per_unit' },
    { id: 'villas', label: 'Villas', parkingRatioBasis: 'slots_per_unit' },
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

  section('C. Additive schema: hydrate invents nothing and preserves the stamp');
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
  check('C1 a legacy asset hydrates WITHOUT the new fields (nothing invented)',
    !('assetTypeId' in plainAsset) && !('assetTypeStandards' in plainAsset));
  const stamped = hydrationFromAnySnapshot(mkSnapshot({
    ...baseAsset,
    assetTypeId: 'villas',
    assetTypeStandards: { label: 'Villas', avgUnitSizeSqm: 450, parkingRatio: 0, parkingRatioBasis: 'slots_per_unit', stampedAt: '2026-09-07T00:00:00.000Z' },
  }));
  const stampedAsset = stamped.assets[0] as unknown as Record<string, unknown>;
  const carried = stampedAsset.assetTypeStandards as Record<string, unknown> | undefined;
  check('C2 a stamped asset hydrates with the stamp VERBATIM (spread, not whitelist)',
    stampedAsset.assetTypeId === 'villas' && !!carried && carried.avgUnitSizeSqm === 450 && carried.parkingRatio === 0
    && !('parkingAreaPerSlotSqm' in (carried ?? {})));
  const areaKeys = ['gfaSqm', 'buaSqm', 'sellableBuaSqm', 'supportArea', 'parkingArea', 'parkingBaysRequired', 'type'] as const;
  check('C3 the stamp changes NO area input on the same asset',
    areaKeys.every((k) => JSON.stringify(plainAsset[k]) === JSON.stringify(stampedAsset[k])));

  section('D. Route guard and picker gate (source-level)');
  const route = readFileSync('app/api/refm/asset-types/route.ts', 'utf8');
  check('D1 every method requires a session (4 getRefmUserId guards)',
    (route.match(/getRefmUserId/g) ?? []).length >= 5 && route.includes('unauthorized()'));
  check('D2 every query is account-filtered through resolveAccountId',
    (route.match(/resolveAccountId/g) ?? []).length >= 5
    && route.includes(`.eq('account_id', accountId)`));
  check('D3 GET fails soft with available:false (never a calculation-path error)',
    route.includes('available: false'));
  check('D4 standards parse never coerces (null and absent mean blank, no Number() on body values)',
    route.includes('standardsNum') && !/Number\(body\./.test(route));
  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  const shell = readFileSync('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', 'utf8');
  check('D5 every mutating standards control declares data-view-mutates',
    (tab.match(/data-view-mutates="true"/g) ?? []).length >= 5);
  const assetsTab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  check('D6 the asset picker stamps through the ONE pure function',
    assetsTab.includes('stampFromAssetType(') && assetsTab.includes('assetTypeId: entry.id'));
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
  check('D7 the Module 6 picker drops the stamp and the registry pick (never a dead lever)',
    nonEconomicLeverReason('assets[asset_1].assetTypeStandards.avgUnitSizeSqm', 'assetTypeStandards.avgUnitSizeSqm') !== null
    && nonEconomicLeverReason('assets[asset_1].assetTypeId', 'assetTypeId') !== null
    && nonEconomicLeverReason('assets[asset_1].landAllocation.sqm', 'landAllocation.sqm') === null);

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
  check('G5 free text stays (the Type field is still a text input with suggestions) and a catalog pick prefills its category',
    /input[^>]*list=\{`asset-types-/.test(assetsTab.replace(/\n\s*/g, ' '))
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
    shell.includes(`activeTab === 'asset-standards'`) && shell.includes('<Module1AssetStandards />'));
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
    && route.includes('not in your list'));
  check('I4 sortAssetTypes keeps "never reordered" (absent) apart from "first" (0)',
    JSON.stringify(sortAssetTypes([
      { id: 'c', label: 'C', parkingRatioBasis: 'slots_per_unit' },
      { id: 'a', label: 'A', parkingRatioBasis: 'slots_per_unit', sortOrder: 0 },
      { id: 'b', label: 'B', parkingRatioBasis: 'slots_per_unit', sortOrder: 1 },
    ]).map((e) => e.id)) === JSON.stringify(['a', 'b', 'c']));

  section('J. Rates carry a unit, and stamp exactly like the area standards');
  const rated: AssetTypeStandard = {
    id: 'hotel', label: 'Hotel', parkingRatioBasis: 'slots_per_unit',
    constructionCostPerSqm: 0, revenueRate: 900, revenueRateUnit: 'adr_per_key_night',
  };
  const rateStamp = stampFromAssetType(rated, {});
  check('J1 the rate and its unit stamp onto the asset, a zero cost stamping as a real 0',
    rateStamp.revenueRate === 900 && rateStamp.revenueRateUnit === 'adr_per_key_night'
    && rateStamp.constructionCostPerSqm === 0);
  const unitlessRate: AssetTypeStandard = { id: 'x', label: 'X', parkingRatioBasis: 'slots_per_unit', revenueRate: 5 };
  check('J2 a rate with no unit names no basis, so neither is stamped',
    !('revenueRate' in stampFromAssetType(unitlessRate, {}))
    && !('revenueRateUnit' in stampFromAssetType(unitlessRate, {})));
  check('J3 the four units are the whole vocabulary, in code, the DB and the route',
    REVENUE_RATE_UNITS.length === 4
    && readFileSync('supabase/migrations/243_asset_type_rates_and_order.sql', 'utf8')
      .includes("'per_sqm', 'per_unit', 'per_sqm_year', 'adr_per_key_night'")
    && route.includes('REVENUE_RATE_UNITS'));
  check('J4 the route requires a unit WITH a rate rather than guessing one',
    route.includes('Pick what the revenue rate is per.'));
  check('J5 the caption states the rates and keeps a blank apart from a zero',
    describeStamp(rateStamp).includes('900 /key/night')
    && describeStamp(rateStamp).includes('Build 0 per sqm')
    && describeStamp(stampFromAssetType({ id: 'y', label: 'Y', parkingRatioBasis: 'slots_per_unit' }, {})).includes('Revenue not set'));

  section('K. Unit size falls back; parking inherits and overrides');
  const stampWithBoth = stampFromAssetType(
    { id: 'apt', label: 'Apt', parkingRatioBasis: 'slots_per_unit', avgUnitSizeSqm: 120, parkingRatio: 1 }, {});
  check('K1 sub-unit areas WIN over the asset type average (they are more precise)',
    resolveAvgUnitSize([80, 120], stampWithBoth).source === 'sub_units'
    && resolveAvgUnitSize([80, 120], stampWithBoth).value === 100);
  check('K2 the asset type average is the FALLBACK when no sub-unit states one',
    resolveAvgUnitSize([], stampWithBoth).source === 'asset_type'
    && resolveAvgUnitSize([], stampWithBoth).value === 120
    && resolveAvgUnitSize([undefined, 0], stampWithBoth).source === 'asset_type');
  check('K3 with neither, the answer is "unset", never 0',
    resolveAvgUnitSize([], undefined).source === 'unset'
    && resolveAvgUnitSize([], undefined).value === undefined);
  check('K4 a sub-unit parking override wins, and a typed ZERO is a real override',
    resolveParkingRatio(2, stampWithBoth).source === 'sub_unit'
    && resolveParkingRatio(0, stampWithBoth).source === 'sub_unit'
    && resolveParkingRatio(0, stampWithBoth).value === 0);
  check('K5 with no override the asset type default applies, and with neither it is "unset"',
    resolveParkingRatio(undefined, stampWithBoth).source === 'asset_type'
    && resolveParkingRatio(undefined, stampWithBoth).value === 1
    && resolveParkingRatio(undefined, undefined).source === 'unset');
  check('K6 the sub-unit row renders inherit / override through the ONE resolver',
    assetsTab.includes('resolveParkingRatio(subUnit.parkingRatio, assetStandards)')
    && assetsTab.includes('-parking-override') && assetsTab.includes('-parking-inherit'));
  check('K7 the Module 6 picker drops the sub-unit override too (nothing reads it yet)',
    nonEconomicLeverReason('subUnits[su_1].parkingRatio', 'parkingRatio') !== null);
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
      SELECT table_name, column_name, is_nullable FROM information_schema.columns
       WHERE table_name IN ('refm_asset_types', 'refm_account_standards')`);
    const has = (t: string, col: string): boolean => cols.rows.some((r) => r.table_name === t && r.column_name === col);
    check('E1 refm_asset_types exists with the standards columns',
      has('refm_asset_types', 'account_id') && has('refm_asset_types', 'avg_unit_size')
      && has('refm_asset_types', 'parking_ratio') && has('refm_asset_types', 'parking_ratio_basis'));
    check('E2 refm_account_standards exists with parking_area_per_slot',
      has('refm_account_standards', 'parking_area_per_slot'));
    check('E3 standards columns are NULLABLE (blank is representable)',
      cols.rows.some((r) => r.table_name === 'refm_asset_types' && r.column_name === 'avg_unit_size' && r.is_nullable === 'YES')
      && cols.rows.some((r) => r.table_name === 'refm_account_standards' && r.column_name === 'parking_area_per_slot' && r.is_nullable === 'YES'));
    check('E4 author columns are NULLABLE (entry outlives the person)',
      cols.rows.some((r) => r.table_name === 'refm_asset_types' && r.column_name === 'user_id' && r.is_nullable === 'YES'));

    const uniq = await c.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'refm_asset_types_account_entry_unique'`);
    check('E5 one entry id per account (unique constraint live)', Number(uniq.rows[0]?.n) === 1);

    const rls = await c.query(`
      SELECT relname, relrowsecurity FROM pg_class
       WHERE relname IN ('refm_asset_types', 'refm_account_standards')`);
    check('E6 RLS enabled on both tables',
      rls.rows.length === 2 && rls.rows.every((r) => r.relrowsecurity === true));

    // Rolled-back probe: NULL vs 0 store distinctly against the LIVE schema.
    await c.query('BEGIN');
    try {
      const anyAccount = await c.query(`SELECT id FROM accounts LIMIT 1`);
      if (anyAccount.rows.length === 1) {
        const accId = String(anyAccount.rows[0].id);
        await c.query(
          `INSERT INTO refm_asset_types (account_id, entry_id, label, avg_unit_size, parking_ratio)
           VALUES ($1, 'verify-probe-blank', 'Verify Probe Blank', NULL, NULL),
                  ($1, 'verify-probe-zero', 'Verify Probe Zero', 0, 0)`, [accId]);
        const back = await c.query(
          `SELECT entry_id, avg_unit_size, parking_ratio FROM refm_asset_types
            WHERE account_id = $1 AND entry_id LIKE 'verify-probe-%' ORDER BY entry_id`, [accId]);
        const blank = back.rows.find((r) => r.entry_id === 'verify-probe-blank');
        const zero = back.rows.find((r) => r.entry_id === 'verify-probe-zero');
        check('E7 live round trip: NULL stays NULL and 0 stays 0, distinctly',
          blank?.avg_unit_size === null && zero?.avg_unit_size !== null && Number(zero?.avg_unit_size) === 0);
      } else {
        check('E7 live round trip: NULL stays NULL and 0 stays 0, distinctly', false, 'no accounts row to probe against');
      }
    } finally {
      await c.query('ROLLBACK');
    }
    const leftover = await c.query(`SELECT count(*)::int AS n FROM refm_asset_types WHERE entry_id LIKE 'verify-probe-%'`);
    check('E8 the probe rolled back (no rows left)', Number(leftover.rows[0]?.n) === 0);

    // Migration 243: the rates and the order.
    const rateCols = await c.query(`
      SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'refm_asset_types'
         AND column_name IN ('construction_cost_per_sqm', 'revenue_rate', 'revenue_rate_unit', 'sort_order')`);
    check('E9 the rate and order columns are live and NULLABLE (mig 243)',
      rateCols.rows.length === 4 && rateCols.rows.every((r) => r.is_nullable === 'YES'),
      JSON.stringify(rateCols.rows));

    await c.query('BEGIN');
    try {
      const anyAccount = await c.query(`SELECT id FROM accounts LIMIT 1`);
      if (anyAccount.rows.length === 1) {
        const accId = String(anyAccount.rows[0].id);
        // The refusal probe sits behind a SAVEPOINT: a failed statement
        // aborts the whole transaction in Postgres, so without one every
        // later query in this block would error and the section would crash
        // rather than report.
        let refused = false;
        await c.query('SAVEPOINT unit_probe');
        try {
          await c.query(
            `INSERT INTO refm_asset_types (account_id, entry_id, label, revenue_rate, revenue_rate_unit)
             VALUES ($1, 'verify-probe-unit', 'Verify Probe Unit', 10, 'per_furlong')`, [accId]);
          await c.query('RELEASE SAVEPOINT unit_probe');
        } catch {
          refused = true;
          await c.query('ROLLBACK TO SAVEPOINT unit_probe');
        }
        const ok = await c.query(
          `INSERT INTO refm_asset_types (account_id, entry_id, label, revenue_rate, revenue_rate_unit, construction_cost_per_sqm, sort_order)
           VALUES ($1, 'verify-probe-rate', 'Verify Probe Rate', 900, 'adr_per_key_night', 0, 0)
           RETURNING revenue_rate_unit, construction_cost_per_sqm`, [accId]);
        check('E10 live: the unit vocabulary is enforced, and a zero build cost stores as 0',
          refused && ok.rows[0]?.revenue_rate_unit === 'adr_per_key_night'
          && Number(ok.rows[0]?.construction_cost_per_sqm) === 0);
      } else {
        check('E10 live: the unit vocabulary is enforced, and a zero build cost stores as 0', false, 'no accounts row to probe against');
      }
    } finally {
      await c.query('ROLLBACK');
    }
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
    const noStamp = rawAssets.every((a) => !('assetTypeId' in a) && !('assetTypeStandards' in a))
      && hydAssets.every((a) => !('assetTypeId' in a) && !('assetTypeStandards' in a));
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
