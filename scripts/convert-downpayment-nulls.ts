/**
 * convert-downpayment-nulls.ts (2026-08-19)
 *
 * A DELIBERATE, MEASURED DATA CONVERSION, run once on request.
 *
 * `downpaymentByPhase` was written by the Step 1 setter, which zero-filled
 * every year it had not been told about. Step 2 changed the convention: an
 * unset year is `null` and carries the last set year forward, and only a
 * typed year is a number. A project saved before Step 2 therefore carries
 * TRAILING ZEROS that read as "the user chose no deposit for this year" when
 * they mean "never set".
 *
 * Left alone, that surfaces the first time somebody retypes a cell, which is
 * exactly the way nobody wants to find out. So this converts it now.
 *
 * WHAT IT CONVERTS: trailing zeros ONLY, and only where they sit after the
 * last non-zero entry. A zero the user typed BETWEEN two real values is left
 * exactly where it is, because that one really is a decision.
 *
 * Pass --apply to write. Without it, this reports and changes nothing.
 *
 * Run: npx tsx scripts/convert-downpayment-nulls.ts [--apply]
 * No em dashes in this file.
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAllSellResults } from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
import { computeFinancialsSnapshot, computeFundingGap } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);
const m2 = (n: number): string => (n / 1e6).toFixed(3) + 'm';

/** Trailing zeros become null. An interior zero is a decision and stays. */
function convert(arr: Array<number | null>): { next: Array<number | null>; changed: number } {
  let lastReal = -1;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) lastReal = i;
  }
  const next: Array<number | null> = arr.map((v, i) => (i > lastReal ? null : v));
  // Explicit accumulator type: reduce would otherwise infer it from the array
  // element (number | null) and the addition becomes a type error.
  const changed = next.reduce<number>((n, v, i) => n + (v === null && arr[i] !== null ? 1 : 0), 0);
  return { next, changed };
}

interface Measured { collections: number[]; requirement: number; peak: number; bs: number; }
function measure(snap: Record<string, unknown>): Measured | null {
  try {
    const rev = computeAllSellResults(snap as never);
    const fin = computeFinancialsSnapshot(snap as never);
    const gap = computeFundingGap(fin);
    const N = rev.axisLength;
    const collections = new Array<number>(N).fill(0);
    for (const [, r] of rev.bySellAsset) {
      for (let t = 0; t < N; t++) collections[t] += (r.cashCollectedPerPeriod ?? [])[t] ?? 0;
    }
    return {
      collections,
      requirement: gap.method3Waterfall.totalNetCashRequired,
      peak: Math.max(...(fin.bs.debtOutstandingPerPeriod ?? [0])),
      bs: Math.max(...fin.bs.bsDifferencePerPeriod.map((x: number) => Math.abs(x))),
    };
  } catch { return null; }
}

async function main(): Promise<void> {
  console.log(APPLY ? 'MODE: APPLY (this writes)\n' : 'MODE: DRY RUN (nothing is written)\n');
  const { data: projects } = await sb.from('refm_projects').select('id,name').limit(100);

  for (const p of projects ?? []) {
    const { data: vers } = await sb.from('refm_project_versions')
      .select('id,version_number,snapshot').eq('project_id', p.id)
      .order('version_number', { ascending: false }).limit(1);
    const row = vers?.[0];
    if (!row?.snapshot) continue;
    const snap = row.snapshot as { assets?: Array<Record<string, unknown>> };
    if (!snap.assets) continue;

    const edits: Array<{ name: string; before: Array<number | null>; after: Array<number | null> }> = [];
    const nextSnap = JSON.parse(JSON.stringify(snap)) as typeof snap;
    for (const a of nextSnap.assets ?? []) {
      const sell = (a.revenue as { sell?: Record<string, unknown> } | undefined)?.sell;
      const arr = sell?.downpaymentByPhase as Array<number | null> | undefined;
      if (!Array.isArray(arr)) continue;
      const { next, changed } = convert(arr);
      if (changed === 0) continue;
      edits.push({ name: String(a.name), before: arr.slice(), after: next });
      sell!.downpaymentByPhase = next;
    }
    if (edits.length === 0) continue;

    console.log('======== ' + p.name + ' (v' + row.version_number + ') ========');
    for (const e of edits) {
      console.log('  ' + e.name);
      console.log('    before  ' + JSON.stringify(e.before));
      console.log('    after   ' + JSON.stringify(e.after));
    }

    const before = measure(snap as unknown as Record<string, unknown>);
    const after = measure(nextSnap as unknown as Record<string, unknown>);
    if (!before || !after) { console.log('  could not measure; NOT writing'); continue; }

    let moved = 0;
    for (let t = 0; t < before.collections.length; t++) {
      moved = Math.max(moved, Math.abs((after.collections[t] ?? 0) - (before.collections[t] ?? 0)));
    }
    console.log('\n  largest per-year collections change  ' + moved.toFixed(6));
    console.log('  lifetime collections   ' + sum(before.collections).toFixed(2) + '  ->  ' + sum(after.collections).toFixed(2));
    console.log('  funding requirement    ' + m2(before.requirement) + '  ->  ' + m2(after.requirement));
    console.log('  peak debt              ' + m2(before.peak) + '  ->  ' + m2(after.peak));
    console.log('  worst |Assets - L&E|   ' + before.bs.toFixed(2) + '  ->  ' + after.bs.toFixed(2));
    console.log('  VERDICT: ' + (moved < 0.005 && Math.abs(after.requirement - before.requirement) < 0.005
      ? 'NO NUMBER MOVES'
      : '*** NUMBERS MOVE, read the figures above before applying ***'));

    if (APPLY) {
      const { error } = await sb.from('refm_project_versions')
        .update({ snapshot: nextSnap }).eq('id', row.id);
      console.log(error ? '  WRITE FAILED: ' + error.message : '  WRITTEN to version row ' + row.id);
    } else {
      console.log('  (dry run, not written)');
    }
    console.log('');
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
