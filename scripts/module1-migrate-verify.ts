/**
 * scripts/module1-migrate-verify.ts
 *
 * Round-trip verifier for the Module 1 migrator. Originally introduced
 * in Phase M1.R for the v2 <-> M1.R-v3 transition; extended in Phase
 * M1.5 to cover the M1.5 hierarchy enrichment and the warn-once-on-
 * lossy-reverse path.
 *
 * Run:
 *   npx tsx scripts/module1-migrate-verify.ts
 *
 * Exit codes:
 *   0  every check passes
 *   1  drift detected
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  migrateLegacyToNew,
  toLegacySnapshot,
  enrichWithHierarchyDefaults,
  isLegacyV2,
  isNewV3,
  hydrationFromAnySnapshot,
  _resetWarnedAboutDroppedAssetsForTests,
  type LegacyV2Snapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  LEGACY_ASSET_IDS,
  DEFAULT_SUB_PROJECT_ID,
  DEFAULT_PHASE_ID,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/module1-reference.json');

// The fixture omits a few optional fields that the migrator treats as
// implicit defaults; we add them in so the round-trip can be a strict
// deep-equal comparison.
function normalizeForCompare(legacy: LegacyV2Snapshot): LegacyV2Snapshot {
  return {
    ...legacy,
    version:               2,
    projectNonEnclosedPct: legacy.projectNonEnclosedPct ?? 0,
    costStage:             legacy.costStage      ?? {},
    costScope:             legacy.costScope      ?? {},
    costDevFeeMode:        legacy.costDevFeeMode ?? {},
    allocBasis:            legacy.allocBasis     ?? 'direct_cost',
  };
}

function deepEqual(a: unknown, b: unknown, path = '$'): string | null {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== typeof b) {
    return `mismatch at ${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (typeof a !== 'object') {
    return `mismatch at ${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return `array/object mismatch at ${path}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `array length mismatch at ${path}: ${a.length} !== ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const r = deepEqual(a[i], b[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const r = deepEqual(ao[k], bo[k], `${path}.${k}`);
    if (r) return r;
  }
  return null;
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8');
  const fixtureLegacy = normalizeForCompare(JSON.parse(raw) as LegacyV2Snapshot);

  // 1. Type guard: the fixture is recognized as legacy v2.
  if (!isLegacyV2(fixtureLegacy)) fail('fixture not detected as legacy v2');
  console.log('OK isLegacyV2(fixture) === true');

  // 2. Forward migration: legacy v2 -> new v3.
  const v3 = migrateLegacyToNew(fixtureLegacy);
  if (!isNewV3(v3)) fail('migrated payload not recognized as new v3');
  console.log(`OK migrateLegacyToNew produced v3 with ${v3.assets.length} assets, ${v3.phases.length} phase(s), ${v3.costs.length} cost lines`);

  // 3. Spot-checks on the v3 shape.
  if (v3.assets.length !== 3) fail(`expected 3 assets, got ${v3.assets.length}`);
  const ids = v3.assets.map(a => a.id).sort();
  const wantIds = [LEGACY_ASSET_IDS.hospitality, LEGACY_ASSET_IDS.residential, LEGACY_ASSET_IDS.retail].sort();
  if (JSON.stringify(ids) !== JSON.stringify(wantIds)) fail(`asset ids mismatch: ${ids}`);
  if (v3.phases.length !== 1) fail(`expected 1 phase, got ${v3.phases.length}`);
  if (v3.costs.length !== fixtureLegacy.residentialCosts.length + fixtureLegacy.hospitalityCosts.length + fixtureLegacy.retailCosts.length) {
    fail(`cost count mismatch: ${v3.costs.length}`);
  }
  console.log('OK v3 shape spot-checks');

  // 4. Reverse adapter: new v3 -> legacy v2.
  const hydrate: Partial<typeof v3> = { ...v3 };
  delete hydrate.version;
  delete hydrate.savedAt;
  const roundTrip = normalizeForCompare(toLegacySnapshot(hydrate as Parameters<typeof toLegacySnapshot>[0]));

  // savedAt is only present if the input had it (absent in the fixture),
  // and the fixture also carries a leading "_comment" doc field that is
  // not part of the schema. Drop both kinds of non-schema noise before
  // the deep-equal so the comparison only checks data that round-trips.
  // Drop:
  //   - savedAt (only present on snapshots written through getSnapshot)
  //   - underscored doc fields (the fixture's _comment)
  //   - showResidential/showHospitality/showRetail (derived at runtime
  //     from projectType + retailPercent; the fixture pre-bakes them
  //     for the pipeline but getSnapshot does not persist them)
  const NON_SCHEMA = new Set(['savedAt', 'showResidential', 'showHospitality', 'showRetail']);
  const stripNoise = <T extends object>(o: T): T => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (NON_SCHEMA.has(k) || k.startsWith('_')) continue;
      out[k] = v;
    }
    return out as T;
  };
  const a = stripNoise(fixtureLegacy);
  const b = stripNoise(roundTrip);

  const diff = deepEqual(a, b);
  if (diff) fail(`round-trip drift: ${diff}`);
  console.log('OK round-trip legacy -> new -> legacy is bit-identical');

  // 5. hydrationFromAnySnapshot routes both shapes correctly.
  const hydratedFromLegacy = hydrationFromAnySnapshot(fixtureLegacy);
  if (hydratedFromLegacy.assets.length !== 3) fail('hydration from legacy did not produce 3 assets');
  const hydratedFromV3 = hydrationFromAnySnapshot(v3);
  if (hydratedFromV3.assets.length !== 3) fail('hydration from v3 did not produce 3 assets');
  console.log('OK hydrationFromAnySnapshot routes both v2 and v3');

  // 6. Robustness: bogus snapshot falls back to defaults rather than throwing.
  // Post Phase M1.5/5 the defaults seed assets=[] (the legacy 3-asset
  // seed was dropped in favour of the Hierarchy tab onboarding flow), so
  // a fall-back hydrate yields zero assets and zero costs.
  const bogus = hydrationFromAnySnapshot({ junk: true });
  if (bogus.assets.length !== 0 || bogus.costs.length !== 0) fail(`bogus snapshot did not fall back to defaults (assets=${bogus.assets.length}, costs=${bogus.costs.length})`);
  console.log('OK bogus input falls back to defaults');

  // ── M1.5 hierarchy checks ────────────────────────────────────────────────

  // 7. v2 -> v4 forward migration populates M1.5 hierarchy fields.
  if (!hydratedFromLegacy.masterHolding) fail('v2 migration missing masterHolding');
  if (hydratedFromLegacy.masterHolding.enabled !== false) fail('v2-migrated MH should be disabled by default');
  if (hydratedFromLegacy.subProjects.length !== 1) fail(`v2 migration should produce 1 sub-project, got ${hydratedFromLegacy.subProjects.length}`);
  if (hydratedFromLegacy.subProjects[0].id !== DEFAULT_SUB_PROJECT_ID) fail('migrated sub-project id mismatch');
  if (hydratedFromLegacy.subProjects[0].name !== fixtureLegacy.projectName) fail('migrated sub-project name should equal projectName');
  if (hydratedFromLegacy.subProjects[0].currency !== fixtureLegacy.currency) fail('migrated sub-project currency should equal currency');
  if (hydratedFromLegacy.subUnits.length !== 0) fail('v2 migration should produce empty subUnits');
  console.log('OK v2 -> v4 migration populates MH (disabled), 1 sub-project, 0 sub-units');

  // 8. Migrated assets carry subProjectId + phaseId pointing at the seeded defaults.
  for (const a of hydratedFromLegacy.assets) {
    if (a.subProjectId !== DEFAULT_SUB_PROJECT_ID) fail(`asset ${a.id} subProjectId mismatch: ${a.subProjectId}`);
    if (a.phaseId !== DEFAULT_PHASE_ID) fail(`asset ${a.id} phaseId mismatch: ${a.phaseId}`);
  }
  console.log('OK migrated assets bound to default sub-project + phase');

  // 9. Migrated phase carries subProjectId.
  if (hydratedFromLegacy.phases[0].subProjectId !== DEFAULT_SUB_PROJECT_ID) fail('migrated phase subProjectId mismatch');
  console.log('OK migrated phase bound to default sub-project');

  // 10. enrichWithHierarchyDefaults pads a bare-v3-shape snapshot.
  const bareV3 = { ...hydratedFromLegacy } as Partial<typeof hydratedFromLegacy> & typeof hydratedFromLegacy;
  delete (bareV3 as { masterHolding?: unknown }).masterHolding;
  delete (bareV3 as { subProjects?: unknown }).subProjects;
  delete (bareV3 as { subUnits?: unknown }).subUnits;
  const enriched = enrichWithHierarchyDefaults(bareV3);
  if (!enriched.masterHolding || enriched.subProjects.length === 0 || !Array.isArray(enriched.subUnits)) {
    fail('enrichWithHierarchyDefaults did not pad missing M1.5 fields');
  }
  console.log('OK enrichWithHierarchyDefaults pads missing M1.5 fields');

  // 11. toLegacySnapshot warn-once fires when MH is enabled.
  _resetWarnedAboutDroppedAssetsForTests();
  let warned = 0;
  const origWarn = console.warn;
  console.warn = (..._args: unknown[]) => { warned += 1; };
  try {
    const lossyV4 = { ...hydratedFromLegacy, masterHolding: { ...hydratedFromLegacy.masterHolding, enabled: true } };
    toLegacySnapshot(lossyV4);
    if (warned !== 1) fail(`toLegacySnapshot should warn exactly once on MH-enabled, got ${warned}`);
    // Second call must NOT warn again (warn-once-per-session).
    toLegacySnapshot(lossyV4);
    if (warned !== 1) fail(`toLegacySnapshot warn-once latch broken; got ${warned} warnings`);
  } finally {
    console.warn = origWarn;
  }
  console.log('OK toLegacySnapshot warn-once fires on MH-enabled');

  // 12. The standard non-lossy round-trip stays warning-free.
  _resetWarnedAboutDroppedAssetsForTests();
  warned = 0;
  console.warn = (..._args: unknown[]) => { warned += 1; };
  try {
    toLegacySnapshot(hydratedFromLegacy);
    if (warned !== 0) fail(`canonical round-trip should not warn, got ${warned}`);
  } finally {
    console.warn = origWarn;
  }
  console.log('OK canonical 3-asset round-trip stays warning-free');

  console.log('\nAll migrator round-trip checks passed.');
  process.exit(0);
}

main();
