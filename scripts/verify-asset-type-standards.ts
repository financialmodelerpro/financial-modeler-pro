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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  stampFromAssetType,
  normaliseAssetTypeId,
  describeStandardValue,
  describeStamp,
  typesWithoutStandard,
  type AssetTypeStandard,
} from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
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
const FORBIDDEN_TOKENS = ['refm_asset_types', 'refm_account_standards', 'assetTypeStandards', 'assetTypeId'];
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
  const modal = readFileSync('src/hubs/modeling/platforms/refm/components/modals/AssetTypeStandardsModal.tsx', 'utf8');
  check('D5 every mutating standards button declares data-view-mutates',
    (modal.match(/data-view-mutates="true"/g) ?? []).length >= 4);
  const assetsTab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  check('D6 the asset picker stamps through the ONE pure function',
    assetsTab.includes('stampFromAssetType(') && assetsTab.includes('assetTypeId: entry.id'));
  check('D8 the modal offers BOTH quick-add sources through the one helper (platform catalog picker + project types missing a standard)',
    (modal.match(/typesWithoutStandard\(/g) ?? []).length >= 2
    && modal.includes('asset-type-catalog-picker')
    && modal.includes('asset-type-project-missing')
    && modal.includes('platformCatalog') && modal.includes('projectTypesInUse'));
  check('D9 quick-add only PREFILLS the add row (free text stays; no write fires on pick)',
    modal.includes('prefillLabel')
    && !/prefillLabel[\s\S]{0,200}?fetch\(/.test(modal.slice(modal.indexOf('const prefillLabel'), modal.indexOf('const prefillLabel') + 400)));
  check('D10 the modal is wide enough for the table (1240px cap, old 880px gone)',
    modal.includes('min(1240px') && !modal.includes('min(880px'));
  check('D11 the parent feeds the catalog for the PROJECT TYPE and the distinct used types',
    assetsTab.includes('platformTypeCatalog') && assetsTab.includes('projectTypesInUse')
    && assetsTab.includes('ASSET_TYPES_BY_PROJECT_TYPE'));
  check('D7 the Module 6 picker drops the stamp and the registry pick (never a dead lever)',
    nonEconomicLeverReason('assets[asset_1].assetTypeStandards.avgUnitSizeSqm', 'assetTypeStandards.avgUnitSizeSqm') !== null
    && nonEconomicLeverReason('assets[asset_1].assetTypeId', 'assetTypeId') !== null
    && nonEconomicLeverReason('assets[asset_1].landAllocation.sqm', 'landAllocation.sqm') === null);
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
