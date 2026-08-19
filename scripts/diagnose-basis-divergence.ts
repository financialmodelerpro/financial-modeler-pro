/**
 * diagnose-basis-divergence.ts (2026-08-19), READ ONLY.
 *
 * Item 2, the part that matters: after linking the revenue bases into
 * `computeAssetCost`, do ALL of its call sites pass them?
 *
 * They do not. Five sites pass `collectionsTotal` and not the two new bases, and
 * three pass nothing at all. A site that omits them falls back to
 * `metrics.totalRevenue`, the old sub-unit product, so the SAME cost line has
 * two values depending on which surface asks. This measures that gap on the live
 * projects rather than asserting it.
 *
 * Writes nothing.
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAssetCost } from '@/src/core/calculations';
import { collectionsTotalForAsset, saleRevenueTotalForAsset, totalRevenueTotalForAsset } from '@/src/core/calculations/capexPhasing';
import { computeAllSellResults } from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { resolveCatalogId } from '@/src/hubs/modeling/platforms/refm/lib/state/costCatalog';
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

const n2 = (v: number): string => v.toFixed(2);
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
    if (!costLines.some((l) => REVENUE_METHODS.has(l.method))) continue;
    let rev; try { rev = computeAllSellResults(snap as never); } catch { continue; }
    const base = {
      project: (snap.project ?? {}) as Project,
      phases, assets,
      subUnits: (snap.subUnits ?? []) as SubUnit[],
      parcels: (snap.parcels ?? []) as Parcel[],
      costOverrides: (snap.costOverrides ?? []) as CostOverride[],
      landAllocationMode: (snap.landAllocationMode ?? 'autoByBua') as LandAllocationMode,
      costLines,
    };
    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);

    // A. WIRED vs UNWIRED, the same line valued both ways.
    let wiredTotal = 0, unwiredTotal = 0;
    const rows: string[] = [];
    for (const a of assets) {
      if (a.visible === false || a.isCompanion === true) continue;
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const wired = computeAssetCost({
        ...base, asset: a, phase: ph,
        collectionsTotal: collectionsTotalForAsset(rev, a.id),
        saleRevenueTotal: saleRevenueTotalForAsset(rev, a.id),
        totalRevenueTotal: totalRevenueTotalForAsset(rev, a.id),
      } as never);
      // Exactly what an unwired site passes today: collections only.
      const unwired = computeAssetCost({
        ...base, asset: a, phase: ph,
        collectionsTotal: collectionsTotalForAsset(rev, a.id),
      } as never);
      wiredTotal += wired.total; unwiredTotal += unwired.total;
      for (const l of costLines) {
        if (l.phaseId !== a.phaseId || !REVENUE_METHODS.has(l.method)) continue;
        const w = wired.byLineId[l.id] ?? 0, u = unwired.byLineId[l.id] ?? 0;
        if (Math.abs(w - u) <= 0.005) continue;
        rows.push(`      ${String(a.name).slice(0, 24).padEnd(24)} ${String(l.name).slice(0, 16).padEnd(16)} [${resolveCatalogId(l) ?? 'custom'}] wired ${n2(w).padStart(15)}  unwired ${n2(u).padStart(15)}  gap ${n2(w - u)}`);
      }
    }
    console.log(`  [A] per-asset capex total: WIRED ${n2(wiredTotal)}  UNWIRED ${n2(unwiredTotal)}  gap ${n2(wiredTotal - unwiredTotal)}`);
    for (const r of rows) console.log(r);

    // B. What the FINANCING AGGREGATE (wired) says, against what the per-asset CF
    //    loop inside the same snapshot (unwired) says. Both are live surfaces.
    try {
      const s = computeFinancialsSnapshot(snap as never);
      const aggregate = s.financing.capex.totals.inclAllLand;
      let perAssetCf = 0;
      for (const cf of s.perAssetCF.values()) perAssetCf += (cf.capexPerPeriod ?? []).reduce((x: number, v: number) => x + (v ?? 0), 0);
      console.log(`  [B] financing aggregate capex (wired) ${n2(aggregate)}`);
      console.log(`      per-asset CF capex   (unwired)    ${n2(perAssetCf)}`);
      console.log(`      DIVERGENCE                        ${n2(aggregate - perAssetCf)}`);
    } catch (e) { console.log('  [B] snapshot threw:', (e as Error).message); }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
