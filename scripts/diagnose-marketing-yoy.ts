/**
 * diagnose-marketing-yoy.ts (2026-08-19), READ ONLY.
 *
 * Reported: the year-on-year marketing in Module 2 Revenue disagrees with the
 * Capex tab, which is correct. The stated rule is
 *
 *     marketing in year t = cash collected in year t x marketing %
 *
 * Compares, per asset and per line, on the live projects:
 *   A  what CAPEX renders          (computeAssetCost WITH collections + revenue)
 *   B  what the REVENUE table renders (the call the new table actually makes)
 *   C  the stated rule              (collections per period x rate)
 *
 * Writes nothing.
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAssetCost } from '@/src/core/calculations';
import { collectionsForAsset, phaseLocalToProjectIndex } from '@/src/core/calculations/capexPhasing';
import { computeAllSellResults } from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
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

const n0 = (v: number): string => v.toFixed(0).padStart(14);
const SELLING = new Set(['marketing', 'commission']);

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
    const projObj = (snap.project ?? {}) as Project;
    if (!costLines.some((l) => SELLING.has(resolveCatalogId(l) ?? ''))) continue;
    let rev; try { rev = computeAllSellResults(snap as never); } catch { continue; }
    const startYear = Number(String((projObj as unknown as { startDate?: string }).startDate ?? '').slice(0, 4));
    const N = rev.axisLength;
    const base = {
      project: projObj, phases, assets,
      subUnits: (snap.subUnits ?? []) as SubUnit[],
      parcels: (snap.parcels ?? []) as Parcel[],
      costOverrides: (snap.costOverrides ?? []) as CostOverride[],
      landAllocationMode: (snap.landAllocationMode ?? 'autoByBua') as LandAllocationMode,
      costLines,
    };
    console.log(`\n==================== ${proj.name} ====================`);

    const onAxis = (local: number[], offset: number): number[] => {
      const out = new Array<number>(N).fill(0);
      for (let i = 0; i < local.length; i++) {
        const idx = phaseLocalToProjectIndex(i, offset);
        if (idx >= 0 && idx < N) out[idx] += local[i] ?? 0;
      }
      return out;
    };

    for (const a of assets) {
      if (a.visible === false || a.isCompanion === true) continue;
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const phaseStartYear = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : startYear;
      const offset = Math.max(0, phaseStartYear - startYear);
      const collections = collectionsForAsset(rev, a.id, ph, startYear);

      // A: what CAPEX does, collections threaded.
      const capex = computeAssetCost({
        ...base, asset: a, phase: ph, revenue: rev,
        collectionsPerPeriod: collections,
        parcelFunding: (projObj as unknown as { financing?: { parcelFunding?: unknown } }).financing?.parcelFunding,
      } as never);
      // B: what the REVENUE table currently does, no collections passed.
      const revenueTable = computeAssetCost({
        ...base, asset: a, phase: ph, revenue: rev,
        parcelFunding: (projObj as unknown as { financing?: { parcelFunding?: unknown } }).financing?.parcelFunding,
      } as never);

      for (const l of costLines) {
        if (l.phaseId !== a.phaseId) continue;
        const id = resolveCatalogId(l);
        if (!SELLING.has(id ?? '')) continue;
        const capexSeries = onAxis(capex.perLinePerPeriod?.[l.id] ?? [], offset);
        const revSeries = onAxis(revenueTable.perLinePerPeriod?.[l.id] ?? [], offset);
        if (capexSeries.every((v) => v === 0) && revSeries.every((v) => v === 0)) continue;
        // C: the stated rule, collections per period x rate, on the project axis.
        const ov = base.costOverrides.find((o) => o.assetId === a.id && o.lineId === l.id);
        const rate = (ov && ov.overridden !== false && ov.value !== undefined ? ov.value : l.value) / 100;
        const cashPerPeriod = rev.bySellAsset.get(a.id)?.cashCollectedPerPeriod ?? [];
        const stated = new Array<number>(N).fill(0);
        for (let t = 0; t < N; t++) stated[t] = (cashPerPeriod[t] ?? 0) * rate;

        const same = capexSeries.every((v, t) => Math.abs(v - revSeries[t]) < 0.5);
        console.log(`\n  ${a.name} / ${l.name} [${id}]  rate ${(rate * 100).toFixed(2)}%  ${same ? 'A == B' : 'A != B  <-- DEFECT'}`);
        console.log(`     year        A capex        B revenue       C collections x rate`);
        for (let t = 0; t < N; t++) {
          if (Math.abs(capexSeries[t]) < 0.5 && Math.abs(revSeries[t]) < 0.5 && Math.abs(stated[t]) < 0.5) continue;
          console.log(`     ${startYear + t}  ${n0(capexSeries[t])} ${n0(revSeries[t])} ${n0(stated[t])}`);
        }
        const sum = (x: number[]): number => x.reduce((s, v) => s + v, 0);
        console.log(`     TOTAL ${n0(sum(capexSeries))} ${n0(sum(revSeries))} ${n0(sum(stated))}`);
      }
    }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
