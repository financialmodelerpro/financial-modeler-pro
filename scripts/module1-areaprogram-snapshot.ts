/**
 * Module 1 Area Program baseline writer (Phase M1.7/4).
 *
 * Loads `tests/fixtures/module1-areaprogram.json` (a v4 HydrateSnapshot
 * carrying plots[] / zones[] + assets bound to a plot via plotId), runs
 * runAreaProgramPipeline (M1.7 calc engines: envelope, cascade, parking
 * allocation), and writes the result to
 * `tests/snapshots/module1-areaprogram-baseline.json`.
 *
 * Run once to capture the baseline; commit the result. Re-run only when
 * the area-program fixture or pipeline intentionally changes.
 *
 * Usage:
 *   npx tsx scripts/module1-areaprogram-snapshot.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadV4Fixture, runAreaProgramPipeline } from './module1-pipeline';

const FIXTURE_PATH  = resolve(process.cwd(), 'tests/fixtures/module1-areaprogram.json');
const BASELINE_PATH = resolve(process.cwd(), 'tests/snapshots/module1-areaprogram-baseline.json');

function main() {
  const v4   = loadV4Fixture(FIXTURE_PATH);
  const snap = runAreaProgramPipeline(v4);
  const json = JSON.stringify(snap, null, 2) + '\n';
  writeFileSync(BASELINE_PATH, json);
  console.log(`Wrote ${(json.length / 1024).toFixed(1)} KB to ${BASELINE_PATH}`);
}

main();
