/**
 * diagnose-marketing-e2e.ts (2026-08-19), READ ONLY.
 *
 * End to end on the SAVED snapshots: for every cost line that is a selling cost
 * by IDENTITY, does the scope rule actually catch it, and what basis is it
 * charging on?
 *
 * The question this was written to answer: after scoping marketing to selling
 * assets, the live project STILL charges it to retail. Why?
 *
 * Run: npx tsx scripts/diagnose-marketing-e2e.ts
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAssetCost, computeAssetRevenue, deriveAssetScope } from '@/src/core/calculations';
import { assetVisibleLines } from '@/src/core/calculations/selectedBase';
import { resolveCatalogId } from '@/src/hubs/modeling/platforms/refm/lib/state/costCatalog';
import { deriveLineBaseId, assetStrategySells } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeAllSellResults } from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
import type { Asset, CostLine, CostOverride, Parcel, Phase, SubUnit, LandAllocationMode, Project } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

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
const REVENUE_METHODS = new Set(['percent_of_revenue_sale', 'percent_of_revenue_cash', 'percent_of_total_revenue']);

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id, name, updated_at').order('updated_at', { ascending: false });
  for (const proj of projects ?? []) {
    const { data: vers } = await sb.from('refm_project_versions')
      .select('version_number, snapshot').eq('project_id', proj.id)
      .order('version_number', { ascending: false }).limit(1);
    const snap = vers?.[0]?.snapshot as Record<string, unknown> | null;
    if (!snap) continue;
    const assets = (snap.assets ?? []) as Asset[];
    const phases = (snap.phases ?? []) as Phase[];
    const costLines = (snap.costLines ?? []) as CostLine[];
    if (assets.length === 0 || costLines.length === 0) continue;
    const base = {
      project: (snap.project ?? {}) as Project,
      phases,
      assets,
      subUnits: (snap.subUnits ?? []) as SubUnit[],
      parcels: (snap.parcels ?? []) as Parcel[],
      costOverrides: (snap.costOverrides ?? []) as CostOverride[],
      landAllocationMode: (snap.landAllocationMode ?? 'autoByBua') as LandAllocationMode,
      costLines,
    };
    let rev: ReturnType<typeof computeAllSellResults> | null = null;
    try { rev = computeAllSellResults(snap as never); } catch { rev = null; }

    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);

    // 1. IDENTITY vs SCOPE. A line is a selling cost by identity if
    //    resolveCatalogId says marketing / commission. The scope rule must agree.
    console.log('\n  [1] IDENTITY vs SCOPE, every line');
    let mismatch = 0;
    for (const l of costLines) {
      const identity = resolveCatalogId(l);
      const isSelling = identity === 'marketing' || identity === 'commission';
      const scope = deriveAssetScope(l);
      const agrees = isSelling ? scope === 'selling' : scope === 'all';
      if (isSelling || !agrees) {
        if (!agrees) mismatch += 1;
        console.log(`      ${agrees ? 'ok  ' : 'MISS'} id=${l.id}`);
        console.log(`             name="${l.name}" catalogId=${JSON.stringify(l.catalogId)} baseId=${deriveLineBaseId(l.id)}`);
        console.log(`             identity=${identity ?? 'none'} scope=${scope} scopeOverride=${JSON.stringify(l.assetScopeOverride)}`);
      }
    }
    console.log(`      -> ${mismatch} line(s) whose SCOPE disagrees with their IDENTITY`);

    // 2. What each non-selling asset is actually charged for a selling line.
    console.log('\n  [2] WHAT A HELD ASSET IS CHARGED for a selling line');
    for (const a of assets) {
      if (a.visible === false || a.isCompanion === true) continue;
      if (assetStrategySells(a.strategy)) continue;
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const res = computeAssetCost({ ...base, asset: a, phase: ph } as never);
      const visible = assetVisibleLines(costLines, a.phaseId, a.id, a.strategy);
      for (const l of costLines) {
        const identity = resolveCatalogId(l);
        if (identity !== 'marketing' && identity !== 'commission') continue;
        if (l.phaseId !== a.phaseId) continue;
        const amt = res.byLineId[l.id] ?? 0;
        const sees = visible.some((v) => v.id === l.id);
        console.log(`      ${String(a.strategy).padEnd(9)} ${a.name.slice(0, 26).padEnd(26)} ${l.name.slice(0, 20).padEnd(20)} sees=${sees ? 'YES' : 'no '} charged=${amt.toFixed(2)}`);
      }
    }

    // 3. Every line on a percent-of-revenue method, and the basis it uses.
    console.log('\n  [3] EVERY percent-of-revenue LINE, and the basis it charges on');
    for (const a of assets) {
      if (a.visible === false || a.isCompanion === true) continue;
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const res = computeAssetCost({ ...base, asset: a, phase: ph } as never);
      const visible = assetVisibleLines(costLines, a.phaseId, a.id, a.strategy);
      const revLines = visible.filter((l) => REVENUE_METHODS.has(l.method));
      if (revLines.length === 0) continue;
      const costBasis = computeAssetRevenue(a, base.subUnits);
      const sell = rev?.bySellAsset.get(a.id);
      const hosp = rev?.byHospitalityAsset.get(a.id);
      const lease = rev?.byLeaseAsset.get(a.id);
      const saleRev = sum(sell?.presalesRevenuePerPeriod) + sum(sell?.postSalesRevenuePerPeriod);
      const engineTotal = saleRev + sum(hosp?.totalRevenuePerPeriod) + sum(lease?.totalRevenuePerPeriod);
      console.log(`      ${String(a.strategy).padEnd(14)} ${a.name.slice(0, 26).padEnd(26)}`);
      console.log(`           basis used   ${M(costBasis).padStart(12)}   revenue module: sale ${M(saleRev)} total ${M(engineTotal)}`);
      for (const l of revLines) {
        console.log(`           ${l.method.padEnd(26)} ${l.name.slice(0, 22).padEnd(22)} v=${String(l.value).padStart(6)} charged=${(res.byLineId[l.id] ?? 0).toFixed(2)}`);
      }
    }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
