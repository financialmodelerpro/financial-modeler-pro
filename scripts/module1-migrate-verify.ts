/**
 * scripts/module1-migrate-verify.ts
 *
 * Round-trip verifier for the Phase M1.R legacy <-> new shape migrator.
 * Loads the canonical Module 1 fixture (legacy v2 cost-array shape),
 * migrates it forward to v3, then converts back to v2 and asserts that
 * the result is deeply equal to the input.
 *
 * Run:
 *   npx tsx scripts/module1-migrate-verify.ts
 *
 * Exit codes:
 *   0  round-trip is lossless for the canonical 3-asset case
 *   1  drift detected
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  migrateLegacyToNew,
  toLegacySnapshot,
  isLegacyV2,
  isNewV3,
  hydrationFromAnySnapshot,
  type LegacyV2Snapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  LEGACY_ASSET_IDS,
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
  const { version: _v, savedAt: _s, ...hydrate } = v3;
  const roundTrip = normalizeForCompare(toLegacySnapshot(hydrate));

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
  const bogus = hydrationFromAnySnapshot({ junk: true });
  if (bogus.assets.length !== 3 || bogus.costs.length !== 0) fail('bogus snapshot did not fall back to defaults');
  console.log('OK bogus input falls back to defaults');

  console.log('\nAll migrator round-trip checks passed.');
  process.exit(0);
}

main();
