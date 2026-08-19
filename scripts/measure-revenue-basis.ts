/**
 * measure-revenue-basis.ts (2026-08-19), READ ONLY.
 *
 * What linking the percent-of-revenue BASE to the revenue module does to every
 * saved project, line by line and asset by asset.
 *
 * A/B through the SAME function the engine calls, differing only in whether the
 * revenue bases are supplied:
 *
 *   BEFORE  computeAssetCost without them -> falls back to metrics.totalRevenue,
 *           which is the sub-unit product metricValue x unitPrice summed over
 *           Sellable AND Operable AND Leasable (the old behaviour exactly)
 *   AFTER   computeAssetCost with saleRevenueTotal / totalRevenueTotal from the
 *           revenue module
 *
 * Any difference is a number that moves, and it must be reported rather than
 * discovered later.
 *
 * Run: npx tsx scripts/measure-revenue-basis.ts
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAssetCost } from '@/src/core/calculations';
import {
  collectionsTotalForAsset,
  saleRevenueTotalForAsset,
  totalRevenueTotalForAsset,
} from '@/src/core/calculations/capexPhasing';
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

const REVENUE_METHODS = new Set(['percent_of_revenue_sale', 'percent_of_revenue_cash', 'percent_of_total_revenue']);
const n2 = (v: number): string => v.toFixed(2);

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id, name, updated_at').order('updated_at', { ascending: false });
  let projectsMoved = 0, scanned = 0;
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
    if (!costLines.some((l) => REVENUE_METHODS.has(l.method))) continue;
    scanned += 1;
    let rev: ReturnType<typeof computeAllSellResults> | null = null;
    try { rev = computeAllSellResults(snap as never); } catch (e) {
      console.log(`${proj.name}: revenue engine threw (${(e as Error).message}); skipped`);
      continue;
    }
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
    const rows: string[] = [];
    let beforeTotal = 0, afterTotal = 0;
    for (const a of assets) {
      if (a.visible === false || a.isCompanion === true) continue;
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const before = computeAssetCost({ ...base, asset: a, phase: ph } as never);
      const after = computeAssetCost({
        ...base, asset: a, phase: ph,
        collectionsTotal: collectionsTotalForAsset(rev, a.id),
        saleRevenueTotal: saleRevenueTotalForAsset(rev, a.id),
        totalRevenueTotal: totalRevenueTotalForAsset(rev, a.id),
      } as never);
      beforeTotal += before.total; afterTotal += after.total;
      for (const l of costLines) {
        if (l.phaseId !== a.phaseId || !REVENUE_METHODS.has(l.method)) continue;
        const b = before.byLineId[l.id] ?? 0;
        const f = after.byLineId[l.id] ?? 0;
        if (Math.abs(b - f) <= 0.005) continue;
        rows.push(`    ${String(a.name).slice(0, 26).padEnd(26)} ${String(a.strategy).padEnd(14)} ${String(l.name).slice(0, 18).padEnd(18)} ${l.method.padEnd(24)} before ${n2(b).padStart(16)}  after ${n2(f).padStart(16)}  delta ${n2(f - b)}`);
      }
    }
    const delta = afterTotal - beforeTotal;
    const tag = Math.abs(delta) > 0.005 ? 'MOVES    ' : 'identical';
    console.log(`${tag} ${String(proj.name).slice(0, 30).padEnd(30)} v${String(vers?.[0]?.version_number).padEnd(6)} total capex ${n2(beforeTotal)} -> ${n2(afterTotal)}  (${n2(delta)})`);
    for (const r of rows) console.log(r);
    if (Math.abs(delta) > 0.005) projectsMoved += 1;
  }
  console.log(`\n${scanned} project(s) carry a percent-of-revenue line; ${projectsMoved} move.`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
