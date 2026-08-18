/* eslint-disable @typescript-eslint/no-explicit-any -- READ ONLY diagnostic: it walks a saved snapshot whose shape is whatever the project was saved with. */
/**
 * diagnose-cf-capex-foot.ts (2026-08-18)  READ ONLY.
 *
 * Reported: the cash flow Investing section's per-asset capex rows do not add
 * up to its own "Total Capex" subtotal, and the balance sheet is out.
 *
 * Measures, on the live saved snapshots:
 *   1. per-asset capex rows summed, per period, against the Total Capex row
 *   2. what the residue is (in-kind land?), per period
 *   3. whether the balance sheet actually balances, and by how much
 *
 * Run: npx tsx scripts/diagnose-cf-capex-foot.ts [project name fragment]
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { hydrationFromAnySnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
const url = process.env.SUPABASE_URL ?? '', key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !key) { console.error('Missing SUPABASE creds'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const only = process.argv[2];
const n = (v: number): string => (Math.round(v) / 1000).toFixed(1);

async function main(): Promise<void> {
  const { data: projects } = await sb.from('refm_projects')
    .select('id, name, updated_at').order('updated_at', { ascending: false }).limit(20);
  for (const proj of projects ?? []) {
    if (only && !proj.name.toLowerCase().includes(only.toLowerCase())) continue;
    const { data: vers } = await sb.from('refm_project_versions')
      .select('version_number, label, snapshot').eq('project_id', proj.id)
      .order('version_number', { ascending: false }).limit(1);
    const raw = vers?.[0]?.snapshot as any; if (!raw) continue;
    const s = hydrationFromAnySnapshot(raw) as any;
    if (!s.assets?.length) continue;
    let snap: any;
    try { snap = computeFinancialsSnapshot(s); } catch (e) { console.log(`${proj.name}: engine threw ${(e as Error).message}`); continue; }
    const N = snap.axisLength;
    console.log('\n' + '='.repeat(78));
    console.log(`PROJECT ${proj.name}  (v${vers![0].version_number}) periods=${N}`);

    // 1. The rows the CF Investing section renders, summed.
    const rowsSum = new Array<number>(N).fill(0);
    for (const a of s.assets) {
      if (a.visible === false) continue;
      const series = snap.perAssetCF.get(a.id)?.capexPerPeriod ?? [];
      for (let t = 0; t < N; t++) rowsSum[t] += series[t] ?? 0;
    }
    const subtotal = snap.directCF.capexPerPeriod.map((v: number) => -v); // rendered negative
    const cap = snap.financing.capex.perPeriod;
    console.log('\n  per-period (thousands)');
    console.log('  t    assetRows     TotalCapex      residue    landInKind   inclAllLand   exclLandIK');
    let totRows = 0, totSub = 0, totIK = 0;
    for (let t = 0; t < N; t++) {
      const r = rowsSum[t], sub = subtotal[t] ?? 0, ik = cap.landInKind[t] ?? 0;
      totRows += r; totSub += sub; totIK += ik;
      if (r === 0 && sub === 0 && ik === 0) continue;
      console.log(`  ${String(t).padStart(2)} ${n(r).padStart(12)} ${n(sub).padStart(14)} ${n(r - sub).padStart(12)} ${n(ik).padStart(13)} ${n(cap.inclAllLand[t] ?? 0).padStart(13)} ${n(cap.exclLandInKind[t] ?? 0).padStart(12)}`);
    }
    console.log(`  TOT ${n(totRows).padStart(12)} ${n(totSub).padStart(14)} ${n(totRows - totSub).padStart(12)} ${n(totIK).padStart(13)}`);
    console.log(`  residue == in-kind land? ${Math.abs((totRows - totSub) - totIK) < 1 ? 'YES' : 'NO'}`);

    // 2. Balance sheet, per period.
    console.log('\n  t     bsDiff    inKindEqCum   landClosing   equityCashCum');
    let ikCum = 0, eqCum = 0;
    for (let t = 0; t < N; t++) {
      ikCum += snap.financing.equity.inKindPerPeriod[t] ?? 0;
      eqCum += snap.financing.equity.cashPerPeriod[t] ?? 0;
      console.log(`  ${String(t).padStart(2)} ${n(snap.bs.bsDifferencePerPeriod[t]).padStart(11)} ${n(ikCum).padStart(13)} ${n(snap.bs.landPerPeriod[t]).padStart(13)} ${n(eqCum).padStart(14)}`);
    }


    // 3. Where does each parcel's in-kind value get stamped, on each side?
    const projStart = new Date(s.project.startDate).getUTCFullYear();
    console.log('\n  parcels:');
    for (const pc of s.parcels) {
      const inKind = pc.area * pc.rate * (Math.max(0, Math.min(100, 100 - (pc.cashPct ?? 0))) / 100);
      const ph = s.phases.find((x: any) => x.id === pc.phaseId);
      const psy = ph?.startDate ? new Date(ph.startDate).getUTCFullYear() : projStart;
      const off = Math.max(0, psy - projStart);
      console.log(`   ${pc.name ?? pc.id}  phase=${ph?.name ?? '(none)'} start=${psy} offset=${off} -> equity idx ${Math.max(0, off - 1)}  inKind=${n(inKind)}  cashPct=${pc.cashPct}`);
    }
    console.log('  assets and the phase they sit in:');
    for (const a of s.assets) {
      const ph = s.phases.find((x: any) => x.id === a.phaseId);
      const psy = ph?.startDate ? new Date(ph.startDate).getUTCFullYear() : projStart;
      console.log(`   ${a.name}  phase=${ph?.name} start=${psy}  parcelId=${a.parcelId ?? '(none)'}`);
    }


    // 4. Totals: parcel-derived in-kind vs capex-derived in-kind.
    let parcelIK = 0;
    for (const pc of s.parcels) parcelIK += pc.area * pc.rate * (Math.max(0, Math.min(100, 100 - (pc.cashPct ?? 0))) / 100);
    const capexIK = cap.landInKind.reduce((x: number, y: number) => x + y, 0);
    const eqIK = snap.financing.equity.totalInKind;
    console.log(`\n  in-kind TOTALS: parcel-derived ${n(parcelIK)}  capex-derived ${n(capexIK)}  equity.totalInKind ${n(eqIK)}  -> ${Math.abs(parcelIK - capexIK) < 1 ? 'AGREE' : 'DIVERGE by ' + n(parcelIK - capexIK)}`);

    // 2b. Balance sheet.
    const bs = snap.bs;
    const keys = Object.keys(bs).filter((k) => /balanc|check|diff|residu/i.test(k));
    console.log(`\n  BS keys of interest: ${keys.join(', ')}`);
    for (const k of keys) {
      const v = (bs as any)[k];
      if (Array.isArray(v)) console.log(`   ${k}: max |v| = ${Math.max(...v.map((x: number) => Math.abs(x))).toFixed(2)}`);
      else console.log(`   ${k}: ${JSON.stringify(v)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
