/**
 * Module 1 baseline snapshot writer.
 *
 * Loads `tests/fixtures/module1-reference.json`, runs the pipeline, writes
 * the result to `tests/snapshots/module1-baseline.json`. Run once to capture
 * the baseline; commit the result. Re-run only when the fixture or pipeline
 * intentionally changes.
 *
 * Usage:
 *   npx tsx scripts/module1-snapshot.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFixture, runPipeline } from './module1-pipeline';

const FIXTURE_PATH  = resolve(process.cwd(), 'tests/fixtures/module1-reference.json');
const BASELINE_PATH = resolve(process.cwd(), 'tests/snapshots/module1-baseline.json');

function main() {
  const input = loadFixture(FIXTURE_PATH);
  const snap  = runPipeline(input);
  const json  = JSON.stringify(snap, null, 2) + '\n';
  writeFileSync(BASELINE_PATH, json);
  console.log(`Wrote ${(json.length / 1024).toFixed(1)} KB to ${BASELINE_PATH}`);
}

main();
