/**
 * scripts/snapshot-fingerprint.ts
 *
 * A NUMBERS-ONLY fingerprint of the whole financials snapshot, taken from the
 * shared export fixture, so a presentation change can be proven not to have
 * moved a single figure.
 *
 * Run it on the tree you are changing, stash, run it again, diff the two files.
 * It prints every series the statements are built from, at full precision, in a
 * fixed order, and nothing else: no labels a rename would churn, no titles a
 * new table would shift.
 *
 * The fixture, not a live project, per [[feedback_fingerprint_baseline_trap]]:
 * a baseline taken from anything that can itself change proves nothing.
 *
 * Run: npx tsx scripts/snapshot-fingerprint.ts <out.json>
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import { buildExcelSampleState } from './excelSampleState';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Walk anything, emitting `path = number` lines. Maps are walked by sorted key
 *  so iteration order can never masquerade as a numeric change. */
function walk(v: any, path: string, out: string[], seen: Set<any>): void {
  if (v === null || v === undefined) return;
  if (typeof v === 'number') { out.push(`${path} = ${Number.isFinite(v) ? v.toPrecision(17) : String(v)}`); return; }
  if (typeof v === 'boolean' || typeof v === 'string') return;
  if (typeof v !== 'object') return;
  if (seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, out, seen)); return; }
  if (v instanceof Map) {
    for (const k of [...v.keys()].map(String).sort()) walk(v.get(k), `${path}{${k}}`, out, seen);
    return;
  }
  for (const k of Object.keys(v).sort()) walk(v[k], `${path}.${k}`, out, seen);
}

function main(): void {
  const outPath = process.argv[2];
  if (!outPath) { console.error('usage: npx tsx scripts/snapshot-fingerprint.ts <out.txt>'); process.exit(1); }
  const state = buildExcelSampleState();
  const snap = computeFinancialsSnapshot(state);
  const lines: string[] = [];
  walk(snap, 'snap', lines, new Set());
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`${lines.length} numbers written to ${outPath}`);
}
main();
