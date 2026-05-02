/**
 * Module 1 multi-phase baseline writer (Phase M1.5/12).
 *
 * Loads `tests/fixtures/module1-multiphase.json` (a v4 HydrateSnapshot
 * with phases.length > 1), runs the multi-phase pipeline, writes the
 * result to `tests/snapshots/module1-multiphase-baseline.json`.
 *
 * Run once to capture the baseline; commit the result. Re-run only
 * when the fixture or pipeline intentionally changes.
 *
 * Usage:
 *   npx tsx scripts/module1-multiphase-snapshot.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadV4Fixture, runMultiPhasePipeline } from './module1-pipeline';

const FIXTURE_PATH  = resolve(process.cwd(), 'tests/fixtures/module1-multiphase.json');
const BASELINE_PATH = resolve(process.cwd(), 'tests/snapshots/module1-multiphase-baseline.json');

function main() {
  const v4   = loadV4Fixture(FIXTURE_PATH);
  const snap = runMultiPhasePipeline(v4);
  const json = JSON.stringify(snap, null, 2) + '\n';
  writeFileSync(BASELINE_PATH, json);
  console.log(`Wrote ${(json.length / 1024).toFixed(1)} KB to ${BASELINE_PATH}`);
}

main();
