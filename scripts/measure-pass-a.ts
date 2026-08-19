/**
 * measure-pass-a.ts (2026-08-19), READ ONLY.
 *
 * The two live defects Pass A fixes, measured the same way before and after so
 * the two runs are comparable line for line.
 *
 *   1. THE FINANCING AGGREGATE VERSUS THE PER-ASSET CASH FLOW. Linking the
 *      revenue bases into `computeAssetCost` wired five of its eleven call
 *      sites; the rest fall back to the old sub-unit product, so the same cost
 *      line has two values depending on which surface asks. These two totals
 *      must be equal.
 *
 *   2. THE RECONCILIATION, under BOTH fee-funding settings. `reconcile`
 *      compares `EquityMovement.totalCash` against `sum(split.equity)`, and
 *      since the fee equity draw rides in `split.dedicatedEquity` the check is
 *      short by exactly the fee whenever the fee is equity funded. It is
 *      therefore invisible on `deficit`, which is what both live projects are
 *      set to, which is why the suite stayed green.
 *
 * Run: npx tsx scripts/measure-pass-a.ts
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';

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

const n2 = (v: number): string => v.toFixed(2);

function withFunding(snap: Record<string, unknown>, mode: 'deficit' | 'equity'): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>;
  const p = copy.project as Record<string, unknown>;
  p.fundTerms = { ...((p.fundTerms as object) ?? {}), enabled: true, managementFeeFunding: mode };
  return copy;
}

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id, name, updated_at').order('updated_at', { ascending: false });
  for (const proj of projects ?? []) {
    const { data: vers } = await sb.from('refm_project_versions')
      .select('version_number, snapshot').eq('project_id', proj.id)
      .order('version_number', { ascending: false }).limit(1);
    const snap = vers?.[0]?.snapshot as Record<string, unknown> | null;
    if (!snap) continue;
    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);

    // (1) The two capex totals that must agree, on the model AS SAVED.
    try {
      const s = computeFinancialsSnapshot(snap as never);
      const aggregate = s.financing.capex.totals.inclAllLand;
      let perAssetCf = 0;
      for (const cf of s.perAssetCF.values()) {
        perAssetCf += (cf.capexPerPeriod ?? []).reduce((x: number, v: number) => x + (v ?? 0), 0);
      }
      const gap = aggregate - perAssetCf;
      console.log('  [1] capex, financing aggregate vs per-asset Cash Flow (as saved)');
      console.log(`      financing aggregate  ${n2(aggregate)}`);
      console.log(`      per-asset CF         ${n2(perAssetCf)}`);
      console.log(`      DIVERGENCE           ${n2(gap)}   ${Math.abs(gap) < 0.005 ? '<- agree' : '<- DISAGREE'}`);
    } catch (e) { console.log('  [1] threw:', (e as Error).message); }

    // (2) Reconciliation under both settings.
    console.log('  [2] reconciliation');
    for (const mode of ['deficit', 'equity'] as const) {
      try {
        const s = computeFinancialsSnapshot(withFunding(snap, mode) as never);
        const iss = s.financing.reconciliation.issues;
        const eq = s.financing.equity;
        const split = s.financing.debtEquitySplit;
        const sumSplitEquity = split.equity.reduce((x: number, v: number) => x + (v ?? 0), 0);
        const sumDedicated = (split.dedicatedEquity ?? []).reduce((x: number, v: number) => x + (v ?? 0), 0);
        console.log(`      --- managementFeeFunding = ${mode}`);
        console.log(`          totalCash ${n2(eq.totalCash)} = development ${n2(eq.totalDevelopment)} + fee ${n2(eq.totalManagementFee)}`);
        console.log(`          split.equity ${n2(sumSplitEquity)} + split.dedicatedEquity ${n2(sumDedicated)} = ${n2(sumSplitEquity + sumDedicated)}`);
        console.log(`          issues (${iss.length}): ${iss.length ? iss.join(' | ') : 'none'}`);
      } catch (e) { console.log(`      --- ${mode}: threw ${(e as Error).message}`); }
    }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
