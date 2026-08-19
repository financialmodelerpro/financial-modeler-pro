/**
 * measure-depreciation-start.ts (2026-08-19), READ ONLY.
 *
 * Depreciation begins when an asset is AVAILABLE FOR USE, which is the first
 * operating period, not the last construction one. `fixed-assets-resolvers.ts`
 * handed the depreciation engine `offset + cp - 1`, which is the M2 PIT
 * revenue-recognition handover index: a deliberate, verifier-pinned convention
 * for REVENUE, reused for a different question.
 *
 * Run before and after the change; the two runs are comparable line for line.
 *
 * WHAT TO WATCH. This is a TIMING shift, so lifetime depreciation should be
 * unchanged. It will NOT be unchanged where a vintage's useful life already ran
 * past the end of the axis: pushing it a year later pushes more of it off the
 * end, and that is a real reduction in charged depreciation rather than a bug.
 * Both figures are printed so the difference is visible rather than assumed.
 *
 * Run: npx tsx scripts/measure-depreciation-start.ts
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
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

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
    let s;
    try { s = computeFinancialsSnapshot(snap as never); } catch (e) {
      console.log(`${proj.name}: threw ${(e as Error).message}`); continue;
    }
    const projObj = (snap.project ?? {}) as Record<string, unknown>;
    const startYear = Number(String(projObj.startDate ?? '').slice(0, 4)) || s.yearLabels?.[0] || 0;
    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);

    const fa = s.fixedAssets;
    const dep = fa?.projectTotals?.depreciable?.depreciationPerPeriod ?? [];
    console.log(`  lifetime depreciation charged   ${M(sum(dep))}`);
    console.log('  per period:');
    for (let t = 0; t < dep.length; t++) {
      if (Math.abs(dep[t] ?? 0) < 0.005) continue;
      console.log(`      ${s.yearLabels?.[t] ?? t}  ${M(dep[t] ?? 0)}`);
    }

    // Anything charged BEFORE its phase's first operating period is the defect.
    let earlyTotal = 0;
    for (const a of assets) {
      if (a.visible === false) continue;
      const row = fa?.byAsset?.get(a.id);
      const d = row?.depreciable?.depreciationPerPeriod ?? [];
      const ph = phases.find((p) => p.id === a.phaseId);
      if (!ph) continue;
      const psY = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : startYear;
      const offset = Math.max(0, psY - startYear);
      const firstOperatingIdx = offset + (ph.constructionPeriods ?? 0);
      const early = d
        .map((v: number, t: number) => ({ v, t }))
        .filter((x: { v: number; t: number }) => x.v > 0.005 && x.t < firstOperatingIdx);
      if (early.length === 0) continue;
      const e = early.reduce((x: number, r: { v: number }) => x + r.v, 0);
      earlyTotal += e;
      console.log(`  ** ${a.name} (${a.strategy}) depreciates before operations start (${startYear + firstOperatingIdx}): ${M(e)}`);
      for (const r of early) console.log(`        ${startYear + r.t}  ${M(r.v)}`);
    }
    console.log(`  TOTAL CHARGED BEFORE OPERATIONS  ${M(earlyTotal)}   ${earlyTotal < 0.005 ? '<- none' : '<- DEFECT'}`);

    // The statements that move with it.
    // FIELD NAMES CHECKED against the P&L interface, not guessed: an absent
    // field sums to 0 and would have reported a real figure as zero.
    console.log(`  P&L D&A           ${M(sum(s.pl.daPerPeriod))}`);
    console.log(`  profit after tax  ${M(sum(s.pl.patPerPeriod))}`);
    console.log(`  tax               ${M(sum(s.pl.taxPerPeriod))}`);
    const worstBs = Math.max(...s.bs.bsDifferencePerPeriod.map((v: number) => Math.abs(v)));
    // CONSERVATION. Moving the start later charges less depreciation INSIDE the
    // axis, and the difference must reappear as closing NBV, or value has gone
    // missing rather than moved.
    const closingNbv = fa?.projectTotals?.depreciable?.closingNBVPerPeriod ?? [];
    const additions = fa?.projectTotals?.depreciable?.additionsPerPeriod ?? [];
    console.log(`  additions (depreciable base)  ${M(sum(additions))}`);
    console.log(`  closing NBV at exit           ${M(closingNbv[closingNbv.length - 1] ?? 0)}`);
    console.log(`  base less lifetime charge     ${M(sum(additions) - sum(dep))}`);
    console.log(`  worst |Assets - L&E|  ${worstBs.toFixed(2)}`);
    console.log(`  closing cash (final)  ${M(s.directCF.closingCashPerPeriod[s.axisLength - 1] ?? 0)}`);
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
