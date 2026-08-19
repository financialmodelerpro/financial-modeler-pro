/**
 * diagnose-marketing-basis.ts (2026-08-19), READ ONLY.
 *
 * Answers ONE question with measurements: is the basis the percent-of-revenue
 * cost methods charge on actually the asset's revenue?
 *
 * The basis today is `computeAssetRevenue`, which sums `metricValue x unitPrice`
 * over the Sellable, Operable AND Leasable sub-units. Those three products are
 * not the same kind of number:
 *
 *   Sellable   area x price per sqm, or units x price per unit  = a SALE value
 *   Leasable   area x rent per sqm per year                     = ONE YEAR of rent
 *   Operable   keys x ADR                                       = ONE NIGHT at 100%
 *
 * So the comparison below is against the revenue engine, which computes each
 * class properly over the whole hold.
 *
 * Run: npx tsx scripts/diagnose-marketing-basis.ts
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAssetRevenue } from '@/src/core/calculations';
import { computeAllSellResults } from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !key) { console.error('Missing creds'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const M = (n: number): string => (n / 1e6).toFixed(3) + 'm';
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id, name, updated_at').order('updated_at', { ascending: false }).limit(6);
  for (const proj of projects ?? []) {
    const { data: vers } = await sb.from('refm_project_versions')
      .select('version_number, snapshot').eq('project_id', proj.id)
      .order('version_number', { ascending: false }).limit(1);
    const snap = vers?.[0]?.snapshot as Record<string, unknown> | null;
    if (!snap) continue;
    const assets = (snap.assets ?? []) as Array<Record<string, unknown>>;
    if (assets.length === 0) continue;
    let rev;
    try {
      rev = computeAllSellResults(snap as never);
    } catch (e) { console.log(`\n${proj.name}: revenue engine threw (${(e as Error).message})`); continue; }
    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);
    console.log('  asset                        strategy       COST-ENGINE basis   REVENUE-ENGINE lifetime    ratio');
    let costTotal = 0, revTotal = 0;
    for (const a of assets) {
      if (a.visible === false) continue;
      const id = a.id as string;
      const basis = computeAssetRevenue(a as never, (snap.subUnits ?? []) as never);
      const sell = rev.bySellAsset.get(id);
      const hosp = rev.byHospitalityAsset.get(id);
      const lease = rev.byLeaseAsset.get(id);
      const saleRev = sum(sell?.presalesRevenuePerPeriod) + sum(sell?.postSalesRevenuePerPeriod);
      const hospRev = sum(hosp?.totalRevenuePerPeriod);
      const leaseRev = sum(lease?.totalRevenuePerPeriod);
      const engine = saleRev + hospRev + leaseRev;
      if (basis <= 0 && engine <= 0) continue;
      costTotal += basis; revTotal += engine;
      const ratio = basis > 0 ? (engine / basis) : Number.NaN;
      const parts = [saleRev > 0 ? `sale ${M(saleRev)}` : '', hospRev > 0 ? `hosp ${M(hospRev)}` : '', leaseRev > 0 ? `lease ${M(leaseRev)}` : ''].filter(Boolean).join(' + ');
      console.log(`  ${String(a.name).slice(0, 28).padEnd(28)} ${String(a.strategy).padEnd(14)} ${M(basis).padStart(14)}   ${M(engine).padStart(14)}  x${Number.isNaN(ratio) ? '  n/a' : ratio.toFixed(1).padStart(6)}   [${parts}]`);
    }
    console.log(`  ${'TOTAL'.padEnd(43)} ${M(costTotal).padStart(14)}   ${M(revTotal).padStart(14)}  x${(revTotal / (costTotal || 1)).toFixed(1)}`);
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
