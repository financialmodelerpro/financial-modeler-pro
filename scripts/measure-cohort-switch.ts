/**
 * measure-cohort-switch.ts (2026-08-19), READ ONLY.
 *
 * Step 3 of the sale cohort restructure moves real money. Run this at the
 * commit BEFORE the switch and at the commit after, and compare the two
 * outputs line for line.
 *
 * WHAT MUST HOLD, whichever way the numbers go:
 *   - lifetime collections unchanged PER ASSET, to the currency unit, because
 *     a rule that only re-times money cannot change the total
 *   - the balance sheet still balances to zero
 *
 * WHAT IS EXPECTED TO MOVE:
 *   - collections per year
 *   - the funding requirement and peak debt, because the deficit is sized on
 *     the cash the project actually has
 *
 * Run: npx tsx scripts/measure-cohort-switch.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAllSellResults } from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
import { computeFinancialsSnapshot, computeFundingGap } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import type { Asset } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const M = (n: number): string => (n / 1e6).toFixed(2) + 'm';
const U = (n: number): string => n.toFixed(2);
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id,name,updated_at').order('updated_at', { ascending: false });

  for (const p of projects ?? []) {
    const { data: v } = await sb.from('refm_project_versions')
      .select('version_number,snapshot').eq('project_id', p.id)
      .order('version_number', { ascending: false }).limit(1);
    const snap = v?.[0]?.snapshot as Record<string, unknown> | null;
    if (!snap) continue;
    let rev;
    try { rev = computeAllSellResults(snap as never); } catch { continue; }
    if (rev.bySellAsset.size === 0) continue;

    const assets = (snap.assets ?? []) as Asset[];
    const N = rev.axisLength;
    const startYear = rev.projectStartYear;
    console.log('\n======================== ' + p.name + ' (v' + v?.[0]?.version_number + ') ========================');

    // PER ASSET lifetime totals. Per asset, not just the project total, because
    // two assets moving in opposite directions would cancel in a project sum.
    console.log('\n  LIFETIME PER ASSET (sale value must equal collections, to the unit)');
    const totalByYear = new Array<number>(N).fill(0);
    for (const [assetId, r] of rev.bySellAsset) {
      const a = assets.find((x) => x.id === assetId);
      const saleValue = sum(r.presalesRevenuePerPeriod) + sum(r.postSalesRevenuePerPeriod);
      const collected = sum(r.cashCollectedPerPeriod);
      for (let t = 0; t < N; t++) totalByYear[t] += (r.cashCollectedPerPeriod ?? [])[t] ?? 0;
      const gap = collected - saleValue;
      console.log('    ' + (a?.name ?? assetId).padEnd(24)
        + ' sale value ' + U(saleValue).padStart(18)
        + '   collected ' + U(collected).padStart(18)
        + '   diff ' + U(gap).padStart(10)
        + (Math.abs(gap) < 0.005 ? '' : '   <-- LEAK'));
    }

    console.log('\n  COLLECTIONS PER YEAR (project total)');
    for (let t = 0; t < N; t++) {
      if (Math.abs(totalByYear[t]) < 0.005) continue;
      console.log('    ' + (startYear + t) + '  ' + U(totalByYear[t]).padStart(18));
    }
    console.log('    TOTAL ' + U(sum(totalByYear)).padStart(18));

    try {
      const fin = computeFinancialsSnapshot(snap as never);
      const gap = computeFundingGap(fin);
      const peak = Math.max(...(fin.bs.debtOutstandingPerPeriod ?? [0]));
      const worstBs = Math.max(...fin.bs.bsDifferencePerPeriod.map((x: number) => Math.abs(x)));
      console.log('\n  funding requirement  ' + M(gap.method3Waterfall.totalNetCashRequired));
      console.log('  peak debt            ' + M(peak));
      console.log('  worst |Assets - L&E| ' + worstBs.toFixed(2));
      console.log('  closing cash (final) ' + M(fin.directCF.closingCashPerPeriod[N - 1] ?? 0));
      console.log('  P&L revenue          ' + M(sum(fin.pl.totalRevenuePerPeriod)));
      console.log('  P&L cost of sales    ' + M(sum((fin.pl as unknown as Record<string, number[]>).cosPerPeriod)));
    } catch (e) {
      console.log('  financials threw: ' + (e as Error).message);
    }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
