/**
 * diagnose-marketing.ts (2026-08-19), READ ONLY.
 *
 * Three reported symptoms on the Marketing cost line:
 *   1. A rate typed on one asset appeared on another (and clearing it on the
 *      second cleared it on the first).
 *   2. Marketing is charged to Operate and Lease assets, which carry their own
 *      operating expenses and do not carry a selling cost.
 *   3. The marketing AMOUNT looks wrong.
 *
 * Reads the latest saved version of every project. Writes nothing.
 * Run: npx tsx scripts/diagnose-marketing.ts
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeAssetCost, computeAssetRevenue } from '@/src/core/calculations';
import { assetVisibleLines } from '@/src/core/calculations/selectedBase';
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
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const M = (n: number): string => (n / 1e6).toFixed(3) + 'm';

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
    const costLines = (snap.costLines ?? []) as CostLine[];
    if (assets.length === 0) continue;
    const state = {
      project: (snap.project ?? {}) as Project,
      phases: (snap.phases ?? []) as Phase[],
      assets,
      subUnits: (snap.subUnits ?? []) as SubUnit[],
      parcels: (snap.parcels ?? []) as Parcel[],
      costLines,
      costOverrides: (snap.costOverrides ?? []) as CostOverride[],
      landAllocationMode: (snap.landAllocationMode ?? 'autoByBua') as LandAllocationMode,
    };
    const selling = costLines.filter((l) => {
      const c = resolveCatalogId(l);
      return c === 'marketing' || c === 'commission';
    });
    if (selling.length === 0) continue;
    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);

    for (const l of selling) {
      const which = resolveCatalogId(l);
      console.log(`\n  [${which}] id=${l.id} name="${l.name}" phase=${l.phaseId}`);
      console.log(`     method=${l.method} value=${l.value} stage=${l.stage ?? '-'}/${l.stageOverride ?? '-'} target=${l.targetAssetId ?? 'PROJECT-WIDE'} disabled=${l.disabled ?? false}`);
      const ovs = state.costOverrides.filter((o) => o.lineId === l.id);
      console.log(`     overrides: ${ovs.length ? ovs.map((o) => `${o.assetId.slice(0, 8)}:v=${o.value}${o.overridden === false ? '(inactive)' : ''}${o.disabled ? '(off)' : ''}`).join(', ') : 'NONE (so every asset in the phase reads line.value)'}`);
      for (const a of assets.filter((x) => x.visible !== false && x.phaseId === l.phaseId)) {
        const visible = assetVisibleLines(costLines, l.phaseId, a.id);
        if (!visible.some((v) => v.id === l.id)) continue;
        const rev = computeAssetRevenue(a, state.subUnits);
        const ph = state.phases.find((p) => p.id === a.phaseId);
        if (!ph) continue;
        const res = computeAssetCost({ ...state, asset: a, phase: ph } as unknown as Parameters<typeof computeAssetCost>[0]);
        const amt = res.byLineId[l.id] ?? 0;
        const ov = state.costOverrides.find((o) => o.lineId === l.id && o.assetId === a.id);
        const effV = ov && ov.overridden !== false && ov.value !== undefined ? ov.value : l.value;
        const effM = ov && ov.overridden !== false && ov.method ? ov.method : l.method;
        const effOff = (ov && ov.overridden !== false && ov.disabled === true) || l.disabled === true;
        console.log(`       ${String(a.strategy).padEnd(14)} ${a.name.slice(0, 30).padEnd(30)} basis=${M(rev)} eff(method=${effM},v=${effV}${effOff ? ',OFF' : ''}) charged=${amt.toFixed(2)}`);
      }
    }

    console.log('\n  -- the basis the % method reads (metricValue x unitPrice), by strategy --');
    for (const a of assets.filter((x) => x.visible !== false)) {
      const units = state.subUnits.filter((u) => u.assetId === a.id
        && (u.category === 'Sellable' || u.category === 'Operable' || u.category === 'Leasable'));
      const rev = computeAssetRevenue(a, state.subUnits);
      if (units.length === 0) continue;
      const detail = units.map((u) => `${u.category}/${u.metric} ${u.metricValue} x ${u.unitPrice ?? 0}`).join('; ');
      console.log(`     ${String(a.strategy).padEnd(14)} ${a.name.slice(0, 26).padEnd(26)} basis=${M(rev)}  [${detail}]`);
    }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
