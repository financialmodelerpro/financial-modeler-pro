/**
 * measure-selling-scope.ts (2026-08-19), READ ONLY.
 *
 * What the selling-cost scope does to every saved project: total capex per
 * asset, with the scope ON (the code as it stands) and OFF (the rule ignored,
 * which is exactly the previous behaviour). Any difference is a number that
 * moves, and it must be reported rather than discovered later.
 *
 * Run: npx tsx scripts/measure-selling-scope.ts
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAssetCost } from '@/src/core/calculations';
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

/** The scope OFF: every selling-cost line is explicitly marked 'all', which is
 *  what every line resolved to before this rule existed. */
function withScopeOff(lines: CostLine[]): CostLine[] {
  return lines.map((l) => ({ ...l, assetScopeOverride: 'all' as const }));
}

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id, name, updated_at').order('updated_at', { ascending: false });
  let moved = 0, scanned = 0;
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
    scanned += 1;
    const base = {
      project: (snap.project ?? {}) as Project,
      phases,
      assets,
      subUnits: (snap.subUnits ?? []) as SubUnit[],
      parcels: (snap.parcels ?? []) as Parcel[],
      costOverrides: (snap.costOverrides ?? []) as CostOverride[],
      landAllocationMode: (snap.landAllocationMode ?? 'autoByBua') as LandAllocationMode,
    };
    const rows: string[] = [];
    let onTotal = 0, offTotal = 0;
    for (const a of assets) {
      if (a.visible === false) continue;
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const on = computeAssetCost({ ...base, costLines, asset: a, phase: ph } as never).total;
      const off = computeAssetCost({ ...base, costLines: withScopeOff(costLines), asset: a, phase: ph } as never).total;
      onTotal += on; offTotal += off;
      if (Math.abs(on - off) > 0.005) {
        rows.push(`    ${String(a.name).slice(0, 30).padEnd(30)} ${String(a.strategy).padEnd(14)} before ${off.toFixed(2).padStart(18)}  after ${on.toFixed(2).padStart(18)}  delta ${(on - off).toFixed(2)}`);
      }
    }
    const delta = onTotal - offTotal;
    const tag = Math.abs(delta) > 0.005 ? 'MOVES' : 'identical';
    console.log(`${tag.padEnd(10)} ${String(proj.name).slice(0, 34).padEnd(34)} v${String(vers?.[0]?.version_number).padEnd(6)} total ${offTotal.toFixed(2)} -> ${onTotal.toFixed(2)}`);
    for (const r of rows) console.log(r);
    if (Math.abs(delta) > 0.005) moved += 1;
  }
  console.log(`\n${scanned} projects measured, ${moved} with a changed total.`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
