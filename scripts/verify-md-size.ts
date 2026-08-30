// verify-md-size.ts
// Guards CLAUDE.md against growing back over the harness limit.
// CLAUDE.md is loaded into every session and the harness truncates it at 150,000
// characters. It reached 166,857 on 2026-08-30 and was restructured (dated
// narrative moved to CHANGELOG.md). This check keeps that from recurring:
//   WARN  when CLAUDE.md exceeds the target ceiling (100,000 chars)
//   FAIL  when CLAUDE.md exceeds the hard ceiling  (140,000 chars, before the
//         real 150,000 limit bites, so there is room to fix it calmly)
// Sub-files are reported for visibility only; they are loaded on demand and
// carry no hard limit.
//
// Run: npx tsx scripts/verify-md-size.ts

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

const TARGET_CEILING = 100_000;
const HARD_CEILING = 140_000;
const HARNESS_LIMIT = 150_000;

const REPORT_ONLY = [
  'CHANGELOG.md',
  'CLAUDE-REFM.md',
  'CLAUDE-DB.md',
  'CLAUDE-ROUTES.md',
  'CLAUDE-FEATURES.md',
  'CLAUDE-MODELING-HUB.md',
  'CLAUDE-AI.md',
  'CLAUDE-TODO.md',
  'docs/TRAPS.md',
  'docs/FUND_LAYER_GUIDELINE.md',
];

function sizeOf(rel: string): number | null {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.statSync(p).size;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

let failed = false;

const claudeSize = sizeOf('CLAUDE.md');
if (claudeSize === null) {
  console.error('FAIL  CLAUDE.md not found');
  failed = true;
} else if (claudeSize > HARD_CEILING) {
  console.error(
    `FAIL  CLAUDE.md is ${fmt(claudeSize)} chars, over the hard ceiling of ${fmt(HARD_CEILING)} ` +
      `(harness truncates at ${fmt(HARNESS_LIMIT)}). Move the newest dated content to CHANGELOG.md now.`
  );
  failed = true;
} else if (claudeSize > TARGET_CEILING) {
  console.warn(
    `WARN  CLAUDE.md is ${fmt(claudeSize)} chars, over the ${fmt(TARGET_CEILING)} target ` +
      `(hard ceiling ${fmt(HARD_CEILING)}, harness limit ${fmt(HARNESS_LIMIT)}). ` +
      `Move dated session entries to CHANGELOG.md before this becomes a failure.`
  );
} else {
  console.log(
    `OK    CLAUDE.md is ${fmt(claudeSize)} chars ` +
      `(target < ${fmt(TARGET_CEILING)}, hard ceiling ${fmt(HARD_CEILING)})`
  );
}

console.log('');
console.log('Report only (no limit, loaded on demand):');
for (const rel of REPORT_ONLY) {
  const s = sizeOf(rel);
  console.log(`      ${rel.padEnd(32)} ${s === null ? 'absent' : fmt(s) + ' chars'}`);
}

if (failed) process.exit(1);
