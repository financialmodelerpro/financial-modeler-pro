/**
 * scripts/probe-live-cost-lines.ts
 *
 * READ-ONLY probe over the live projects: what the saved snapshots actually
 * carry as cost lines, and what the engine computes from them.
 *
 * Written 2026-08-31 to answer one question with a measurement rather than an
 * argument: does anything move on a live project when the seed-count constant
 * a VERIFIER reads is corrected? It prints the per-phase cost-line count, the
 * base ids present, whether the retired-from-seeding transfer tax is on the
 * project at all, and the Module 2 cost-of-sales total, so a before/after pair
 * can be diffed line for line.
 *
 * Never writes. Skips cleanly with no credentials.
 *
 * Run: npx tsx scripts/probe-live-cost-lines.ts
 *
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { hydrationFromAnySnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { SEEDED_COST_LINE_IDS, STANDARD_COST_LINE_IDS } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

const baseId = (id: string): string => id.split('__')[0];

function report(name: string, snapshot: any): void {
  console.log(`\n=== ${name} ===`);
  const state: any = hydrationFromAnySnapshot(snapshot);
  const lines: any[] = state.costLines ?? [];
  const phases: any[] = state.phases ?? [];
  console.log(`  phases=${phases.length}  costLines=${lines.length}`);
  for (const ph of phases) {
    const slice = lines.filter((c) => c.phaseId === ph.id);
    const ids = slice.map((c) => baseId(c.id));
    const custom = ids.filter((i) => !(STANDARD_COST_LINE_IDS as readonly string[]).includes(i));
    console.log(`  phase ${ph.id}: ${slice.length} lines`
      + `  (seed set is ${SEEDED_COST_LINE_IDS.length})`
      + `  rett present: ${ids.includes('rett')}`
      + `  custom: ${custom.length}`);
  }
  try {
    const snap: any = computeFinancialsSnapshot(state);
    let cos = 0;
    for (const [, v] of snap.byAssetCostOfSales as Map<string, any>) {
      cos += (v.cos.perPeriod as number[]).reduce((s, x) => s + x, 0);
    }
    console.log(`  cost of sales, all Sell assets, lifetime = ${cos.toFixed(2)}`);
  } catch (e) {
    console.log(`  engine skipped: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('(skipped: no database credentials)'); return; }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: projects, error } = await sb
    .from('refm_projects').select('id,name').order('updated_at', { ascending: false }).range(0, 49);
  if (error) { console.log(`(skipped: ${error.message})`); return; }
  for (const p of (projects ?? []) as any[]) {
    const { data } = await sb.from('refm_project_versions')
      .select('snapshot,version_label').eq('project_id', p.id)
      .order('created_at', { ascending: false }).limit(1);
    if (!data?.length) { console.log(`\n=== ${p.name} === (no saved version)`); continue; }
    report(`${p.name} (version ${(data[0] as any).version_label})`, (data[0] as any).snapshot);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
