/* eslint-disable @typescript-eslint/no-explicit-any -- READ ONLY diagnostic over saved snapshots. */
/**
 * diagnose-idc-per-facility.ts (2026-08-18)  READ ONLY. CHANGES NOTHING.
 *
 * The IAS 23 qualifying-asset question, asked of the actual data:
 *
 *   1. Is anything genuinely OPERATING at project start? (The premise under
 *      review is that nothing is.)
 *   2. Per PHYSICAL facility (asset) and per year: is it in its construction
 *      window or its operating window?
 *   3. Per DEBT facility (tranche) and per year: what is the finance cost, how
 *      is it classified TODAY, and where would it land under the per-facility
 *      rule?
 *   4. Since a debt facility is project-wide and funds several phases at once,
 *      what does its interest look like when SPLIT across phases by drawdown,
 *      and classified by each phase's own window?
 *
 * Run: npx tsx scripts/diagnose-idc-per-facility.ts
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
const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } });
const k = (v: number): string => (Math.round(v) / 1000).toFixed(0).padStart(10);
const sum = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

async function main(): Promise<void> {
  const { data: prs } = await sb.from('refm_projects').select('id,name').order('updated_at', { ascending: false }).limit(10);
  for (const pr of prs ?? []) {
    const { data: v } = await sb.from('refm_project_versions').select('snapshot').eq('project_id', pr.id)
      .order('version_number', { ascending: false }).limit(1);
    const raw = v?.[0]?.snapshot as any; if (!raw) continue;
    const s = hydrationFromAnySnapshot(raw) as any; if (!s.assets?.length) continue;
    let snap: any; try { snap = computeFinancialsSnapshot(s); } catch (e) { console.log(`${pr.name}: ${(e as Error).message}`); continue; }
    const N = snap.axisLength;
    const y0 = new Date(s.project.startDate).getUTCFullYear();

    console.log('\n' + '='.repeat(112));
    console.log(`PROJECT ${pr.name}   start ${y0}, ${N} periods`);

    // ── 1. Phase windows ───────────────────────────────────────────────────
    console.log('\n  PHASES (construction window vs operating window)');
    const phaseWin = new Map<string, { name: string; cStart: number; cEnd: number; opStart: number; status: string }>();
    for (const p of s.phases) {
      const off = new Date(p.startDate).getUTCFullYear() - y0;
      const cp = p.constructionPeriods ?? 0;
      const ov = p.overlapPeriods ?? 0;
      const cEnd = off + Math.max(0, cp - ov);   // exclusive
      phaseWin.set(p.id, { name: p.name, cStart: off, cEnd, opStart: cEnd, status: p.status ?? 'development' });
      console.log(`    ${String(p.name).padEnd(10)} status=${String(p.status ?? 'development').padEnd(12)} cp=${String(cp).padStart(2)} overlap=${ov}  construction ${cp > 0 ? `${y0 + off}..${y0 + cEnd - 1}` : '(none)'}  operating from ${y0 + cEnd}`);
    }

    // ── 2. Is anything OPERATING AT PROJECT START? ─────────────────────────
    console.log('\n  IS ANYTHING OPERATING AT PROJECT START?');
    let anyOperatingAtStart = false;
    for (const a of s.assets) {
      const w = phaseWin.get(a.phaseId);
      const preCapex = Number(a.historicalPreCapexBuilding ?? 0);
      const histEquity = Number(a.historicalEquityAmount ?? 0);
      const operatingAtStart = (w?.opStart ?? 99) <= 0;
      if (operatingAtStart || preCapex > 0 || histEquity > 0) anyOperatingAtStart = true;
      console.log(`    ${String(a.name).padEnd(22)} phase=${String(w?.name ?? '?').padEnd(9)} strategy=${String(a.strategy).padEnd(14)} status=${String(a.status ?? 'development').padEnd(12)} operatingFrom=${y0 + (w?.opStart ?? 0)}  historicalPreCapex=${k(preCapex)}  historicalEquity=${k(histEquity)}${operatingAtStart ? '   <== OPERATING AT PROJECT START' : ''}`);
    }
    console.log(`    -> ${anyOperatingAtStart ? 'AT LEAST ONE facility is operating (or carries historical spend) at start' : 'NOTHING is operating at project start; every facility is built inside the model'}`);

    // ── 3. Debt facilities ─────────────────────────────────────────────────
    console.log('\n  DEBT FACILITIES');
    for (const t of s.financingTranches) {
      const w = phaseWin.get(t.phaseId);
      console.log(`    ${String(t.name ?? t.id).padEnd(24)} origin=${String(t.origin ?? 'new').padEnd(9)} phaseId->${String(w?.name ?? '(none)').padEnd(9)} opening=${k(Number(t.openingBalance ?? 0))} originationYear=${t.originationYear ?? '-'} rate=${(t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0) || t.interestRatePct}%`);
    }

    // ── 4. Per tranche, per year: today vs the per-facility rule ───────────
    // Candidate A: the tranche's OWN phase window (pre Pass 28 behaviour).
    // Candidate B: split the tranche's interest across phases by each phase's
    //   share of CUMULATIVE capex to date, and classify each slice by that
    //   phase's own window. This is the reading that lets a Phase 1 asset flip
    //   to operating while Phase 2 is still building.
    const capexByPhasePeriod = new Map<string, number[]>();
    for (const p of s.phases) capexByPhasePeriod.set(p.id, new Array<number>(N).fill(0));
    for (const a of s.assets) {
      if (a.visible === false) continue;
      const cf = snap.perAssetCF.get(a.id);
      if (!cf) continue;
      const arr = capexByPhasePeriod.get(a.phaseId);
      if (!arr) continue;
      for (let t = 0; t < N; t++) arr[t] += cf.capexPerPeriod[t] ?? 0;
    }

    console.log('\n  PER TRANCHE, PER YEAR: interest, today vs the per-facility rule');
    console.log('    tranche                 year   interest    TODAY:IDC  TODAY:oper   |  A(own phase)   B(split by phase, IDC part)   phases building / operating');
    const cum = new Map<string, number>();
    for (const p of s.phases) cum.set(p.id, 0);
    const totals = { today: 0, todayOp: 0, a: 0, b: 0 };
    for (const t of s.financingTranches) {
      const f = snap.financing.facilities.get(t.id);
      if (!f) continue;
      const own = phaseWin.get(t.phaseId);
      for (let i = 0; i < N; i++) {
        const acc = f.interestAccrued?.[i] ?? 0;
        if (acc === 0) continue;
        const todayIdc = f.interestDuringConstruction?.[i] ?? 0;
        const todayOp = acc - todayIdc;
        // A: own phase still building this year?
        const aIdc = own && i >= own.cStart && i < own.cEnd ? acc : 0;
        // B: split by each phase's share of cumulative capex, classify per phase.
        let cumAll = 0;
        for (const p of s.phases) {
          const c = (cum.get(p.id) ?? 0) + Math.abs(capexByPhasePeriod.get(p.id)?.[i] ?? 0);
          cum.set(p.id, c); cumAll += c;
        }
        let bIdc = 0;
        const building: string[] = [], operating: string[] = [];
        for (const p of s.phases) {
          const w = phaseWin.get(p.id)!;
          const share = cumAll > 0 ? (cum.get(p.id) ?? 0) / cumAll : 0;
          const isBuilding = i >= w.cStart && i < w.cEnd;
          if (share > 0.0001) (isBuilding ? building : operating).push(`${w.name} ${(share * 100).toFixed(0)}%`);
          if (isBuilding) bIdc += acc * share;
        }
        totals.today += todayIdc; totals.todayOp += todayOp; totals.a += aIdc; totals.b += bIdc;
        console.log(`    ${String(t.name ?? t.id).slice(0, 22).padEnd(22)} ${y0 + i}  ${k(acc)} ${k(todayIdc)} ${k(todayOp)}   | ${k(aIdc)}  ${k(bIdc)}          build[${building.join(', ')}] oper[${operating.join(', ')}]`);
      }
      // Reset cumulative for the next tranche pass.
      for (const p of s.phases) cum.set(p.id, 0);
    }
    console.log(`    ${'TOTALS'.padEnd(22)}        ${k(totals.today + totals.todayOp)} ${k(totals.today)} ${k(totals.todayOp)}   | ${k(totals.a)}  ${k(totals.b)}`);
    console.log(`\n    Today:  IDC ${k(totals.today)}k, operating ${k(totals.todayOp)}k`);
    console.log(`    Rule A: IDC ${k(totals.a)}k  (moves ${k(totals.a - totals.today)}k into IDC)`);
    console.log(`    Rule B: IDC ${k(totals.b)}k  (moves ${k(totals.b - totals.today)}k into IDC)`);
    void sum;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
