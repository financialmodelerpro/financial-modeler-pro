/**
 * diagnose-depreciation-start.ts (2026-08-19), READ ONLY.
 *
 * Reported: depreciation is charged in 2030, the LAST YEAR OF CONSTRUCTION, when
 * an asset should begin depreciating once it is available for use, i.e. when
 * operations start.
 *
 * `fixed-assets-resolvers.ts:211` computes
 *     handoverIdx = offset + cp - 1
 * which is the last construction period, and hands it to the depreciation engine
 * as `startIdx`. That index is the M2 PIT RECOGNITION handover, a deliberate and
 * verifier-pinned convention for REVENUE. This asks whether it is also being used
 * as the depreciation start, and what that costs per project.
 *
 * Writes nothing.
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import type { Asset, Phase } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

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
    if (assets.length === 0) continue;
    let s; try { s = computeFinancialsSnapshot(snap as never); } catch (e) {
      console.log(`${proj.name}: threw ${(e as Error).message}`); continue;
    }
    const projObj = (snap.project ?? {}) as Record<string, unknown>;
    const startYear = Number(String(projObj.startDate ?? '').slice(0, 4)) || s.yearLabels?.[0] || 0;
    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);
    console.log(`  project start ${startYear}, axis ${s.yearLabels?.[0]} .. ${s.yearLabels?.[s.yearLabels.length - 1]}`);

    for (const ph of phases) {
      const psY = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : startYear;
      const offset = Math.max(0, psY - startYear);
      const cp = ph.constructionPeriods ?? 0;
      const lastConstructionIdx = offset + cp - 1;
      const firstOperatingIdx = offset + cp;
      console.log(`  phase "${ph.name}": starts ${psY} (offset ${offset}), cp=${cp}`);
      console.log(`      last construction year  = index ${lastConstructionIdx} = ${startYear + lastConstructionIdx}   <- current depreciation startIdx`);
      console.log(`      first operating year    = index ${firstOperatingIdx} = ${startYear + firstOperatingIdx}   <- when the asset is available for use`);
    }

    const fa = s.fixedAssets;
    if (!fa) { console.log('  no fixedAssets block on the snapshot'); continue; }
    const dep = fa.projectTotals?.depreciable?.depreciationPerPeriod ?? [];
    console.log('  depreciation charged per period:');
    for (let t = 0; t < dep.length; t++) {
      if (Math.abs(dep[t] ?? 0) < 0.005) continue;
      console.log(`      ${s.yearLabels?.[t] ?? t}  ${M(dep[t] ?? 0)}`);
    }
    // Which of those years is still a construction year for the asset's phase?
    for (const a of assets) {
      if (a.visible === false) continue;
      const row = fa.byAsset?.get(a.id);
      if (!row) continue;
      const d = row.depreciable?.depreciationPerPeriod ?? [];
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const psY = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : startYear;
      const offset = Math.max(0, psY - startYear);
      const cp = ph.constructionPeriods ?? 0;
      const firstOperatingIdx = offset + cp;
      const early = d.map((v: number, t: number) => ({ v, t })).filter((x: { v: number; t: number }) => x.v > 0.005 && x.t < firstOperatingIdx);
      if (early.length === 0) continue;
      console.log(`  ** ${a.name} (${a.strategy}) depreciates BEFORE operations start (${startYear + firstOperatingIdx}):`);
      for (const e of early) console.log(`        ${startYear + e.t}  ${M(e.v)}`);
      const total = d.reduce((x: number, v: number) => x + (v ?? 0), 0);
      const earlySum = early.reduce((x: number, e: { v: number }) => x + e.v, 0);
      console.log(`        early total ${M(earlySum)} of a lifetime ${M(total)}`);
    }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
