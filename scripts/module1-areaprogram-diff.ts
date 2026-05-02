/**
 * Module 1 Area Program snapshot diff (Phase M1.7/4).
 *
 * Re-runs runAreaProgramPipeline against the area-program fixture and
 * compares against the committed baseline. Numeric tolerance is zero —
 * the JSON serialization of the live run must match the baseline byte-
 * for-byte.
 *
 * This is the M1.7 counterpart to module1-snapshot-diff.ts (single-
 * phase) and module1-multiphase-diff.ts (multi-phase). All three run as
 * part of the per-phase regression-guard cadence.
 *
 *   npx tsx scripts/module1-areaprogram-diff.ts
 *
 * Exit codes:
 *   0  baseline matches
 *   1  drift detected (first diff lines printed to stderr)
 *   2  baseline missing or unreadable
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadV4Fixture, runAreaProgramPipeline } from './module1-pipeline';

const FIXTURE_PATH  = resolve(process.cwd(), 'tests/fixtures/module1-areaprogram.json');
const BASELINE_PATH = resolve(process.cwd(), 'tests/snapshots/module1-areaprogram-baseline.json');
const MAX_DIFF_LINES = 50;

function readBaseline(): string {
  try {
    return readFileSync(BASELINE_PATH, 'utf-8');
  } catch (err) {
    console.error(`Cannot read baseline at ${BASELINE_PATH}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

function firstDiff(a: string, b: string, maxLines: number): string {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const len = Math.max(aLines.length, bLines.length);
  const out: string[] = [];
  let shown = 0;
  for (let i = 0; i < len && shown < maxLines; i++) {
    if (aLines[i] !== bLines[i]) {
      out.push(`@@ line ${i + 1} @@`);
      out.push(`- ${aLines[i] ?? '<EOF>'}`);
      out.push(`+ ${bLines[i] ?? '<EOF>'}`);
      shown += 1;
    }
  }
  if (shown === maxLines) out.push(`... (truncated at ${maxLines} differing lines)`);
  return out.join('\n');
}

function main() {
  const v4       = loadV4Fixture(FIXTURE_PATH);
  const live     = JSON.stringify(runAreaProgramPipeline(v4), null, 2) + '\n';
  const baseline = readBaseline();

  if (live === baseline) {
    console.log(`OK — module1 area-program snapshot matches baseline (${(live.length / 1024).toFixed(1)} KB).`);
    process.exit(0);
  }

  console.error('DRIFT — module1 area-program snapshot does not match baseline.');
  console.error(`Baseline:  ${BASELINE_PATH}`);
  console.error(`Fixture:   ${FIXTURE_PATH}`);
  console.error('');
  console.error(firstDiff(baseline, live, MAX_DIFF_LINES));
  console.error('');
  console.error('Investigate before committing:');
  console.error('  1. If Module 1 area-program math intentionally changed, regenerate:');
  console.error('       npx tsx scripts/module1-areaprogram-snapshot.ts');
  console.error('     and commit the new baseline alongside the math change.');
  console.error('  2. Otherwise the change is a real regression — revert and re-test.');
  process.exit(1);
}

main();
