/* eslint-disable @typescript-eslint/no-explicit-any -- READ ONLY diagnostic over saved snapshots. */
/**
 * diagnose-returns-idc.ts (2026-08-18)  READ ONLY.
 *
 * Answers, by measurement on both saved projects:
 *   1. Does FCFF deduct in-kind land? Does FCFE? Are the two consistent?
 *   2. Do the DISPLAYED build-up rows sum to the DISPLAYED total?
 *   3. Where does IDC go: does it reach capex, CWIP/inventory, fixed assets?
 *      Is any of it shown as PAID during construction?
 *   4. What are the settings, and the baseline IRR / MOIC to measure against?
 *
 * Run: npx tsx scripts/diagnose-returns-idc.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { hydrationFromAnySnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildFcffBuildup, buildFcfeBuildup } from '@/src/hubs/modeling/platforms/refm/lib/reports/streamReports';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
const sb = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } });
const M = (v: number): string => (v / 1e6).toFixed(3);
const sum = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

async function main(): Promise<void> {
  const { data: prs } = await sb.from('refm_projects').select('id,name').order('updated_at', { ascending: false }).limit(10);
  for (const pr of prs ?? []) {
    const { data: v } = await sb.from('refm_project_versions').select('snapshot').eq('project_id', pr.id)
      .order('version_number', { ascending: false }).limit(1);
    const raw = v?.[0]?.snapshot as any; if (!raw) continue;
    const s = hydrationFromAnySnapshot(raw) as any; if (!s.assets?.length) continue;
    let snap: any, rs: any;
    try { snap = computeFinancialsSnapshot(s); rs = computeReturnsSnapshot(snap, s.project); } catch (e) { console.log(`${pr.name}: threw ${(e as Error).message}`); continue; }
    const N = snap.axisLength;

    console.log('\n' + '='.repeat(80));
    console.log(`PROJECT ${pr.name}   periods=${N}`);

    // ── 1. Settings ────────────────────────────────────────────────────────
    const cfg = s.project.idcConfig ?? {};
    console.log(`\n  idcConfig: allocationBasis=${cfg.allocationBasis ?? 'land (default)'}  capitalize=${cfg.capitalize !== false}  fundingMode=${cfg.fundingMode ?? 'conditional (default)'}`);

    // ── 2. Where does IDC go? ──────────────────────────────────────────────
    let dcTot = 0, capTot = 0, capCashTot = 0, paidTot = 0;
    for (const f of snap.financing.facilities.values()) {
      dcTot += sum(f.interestDuringConstruction); capTot += sum(f.interestCapitalized);
      capCashTot += sum(f.interestCapitalizedCashPaid); paidTot += sum(f.interestPaid);
    }
    console.log(`\n  IDC (all facilities, lifetime):`);
    console.log(`    interestDuringConstruction  ${M(dcTot).padStart(12)} m   <- interest arising in the construction window`);
    console.log(`      of which capitalised      ${M(capTot).padStart(12)} m   <- added to the DEBT BALANCE, no cash, no drawdown row`);
    console.log(`      of which paid in cash     ${M(capCashTot).padStart(12)} m   <- conditional mode only`);
    console.log(`    interestPaid (all periods)  ${M(paidTot).padStart(12)} m   <- includes post-construction interest`);

    const capexIncl = sum(snap.financing.capex.perPeriod.inclAllLand);
    const capexCash = sum(snap.financing.capex.perPeriod.exclLandInKind);
    const inKindLand = sum(snap.financing.capex.perPeriod.landInKind);
    const idcNbv = snap.idc?.idcNbvPerPeriod ? (snap.idc.idcNbvPerPeriod[N - 1] ?? 0) : 0;
    console.log(`\n  Does IDC reach capex?`);
    console.log(`    capex inclAllLand           ${M(capexIncl).padStart(12)} m`);
    console.log(`    capex exclLandInKind (CFI)  ${M(capexCash).padStart(12)} m`);
    console.log(`    in-kind land inside capex   ${M(inKindLand).padStart(12)} m`);
    console.log(`    IDC inside capex?           ${Math.abs(capexIncl - capexCash - inKindLand) < 1 ? 'NO. capex = cash + in-kind exactly, no IDC term' : 'unclear'}`);
    console.log(`    IDC NBV on the balance sheet at exit ${M(idcNbv)} m  (Operate/Lease share, so it IS capitalised there)`);

    // Inventory carries IDC for Sell assets: check one.
    let invIdc = 0;
    for (const a of s.assets) {
      const idcRow = snap.idc?.byAsset?.get?.(a.id)?.idcPerPeriod;
      if (idcRow) invIdc += sum(idcRow);
    }
    console.log(`    IDC allocated to assets (all) ${M(invIdc)} m  (feeds Sell inventory + Operate/Lease fixed assets)`);

    // ── 3. FCFF / FCFE consistency ─────────────────────────────────────────
    const b = rs.buildup ?? {};
    console.log(`\n  FCFF / FCFE build-up:`);
    console.log(`    FCFF deducts in-kind land?  ${'inKindLandPerPeriod' in b && sum(b.cfiPerPeriod) !== 0 ? 'NO (FCFF = cfo + cfi only; cfi is the CASH basis)' : 'NO'}`);
    console.log(`    FCFE deducts in-kind land?  YES, as "(-) In-Kind Equity Investment" = ${M(sum(b.inKindLandPerPeriod))} m`);
    console.log(`    So the pair today: FCFF ignores it, FCFE charges it once.`);

    // Do the displayed rows sum to the displayed total?
    const mk = (label: string, series: number[], opts: any): any => ({ label, series, ...opts });
    for (const [nm, rows, total] of [
      ['FCFF', buildFcffBuildup(rs as any, mk as any), rs.fcffPerPeriod],
      ['FCFE', buildFcfeBuildup(rs as any, mk as any), rs.fcfePerPeriod],
    ] as any[]) {
      const comps = rows.filter((r: any) => !r.isTotal);
      const shownTotal = rows.find((r: any) => r.isTotal);
      const L = (total ?? []).length;
      let worst = 0, worstAt = -1;
      for (let t = 0; t < L; t++) {
        const s2 = comps.reduce((x: number, r: any) => x + (r.series?.[t] ?? 0), 0);
        const d = Math.abs(s2 - (shownTotal?.series?.[t] ?? 0));
        if (d > worst) { worst = d; worstAt = t; }
      }
      console.log(`    ${nm}: displayed rows vs displayed total, worst |diff| = ${worst.toFixed(2)} at index ${worstAt}  ${worst < 1 ? '(FOOTS)' : '(DOES NOT FOOT)'}`);
    }
    console.log(`    Is FCFE built FROM FCFF? NO. Both are built in parallel from components (streamBuild.ts).`);

    // ── 4. Baseline metrics ────────────────────────────────────────────────
    const r = rs.result ?? {};
    const pc = (x: number | undefined): string => (x === undefined || !Number.isFinite(x) ? 'n/a' : `${(x * 100).toFixed(2)}%`);
    const mx = (x: number | undefined): string => (x === undefined || !Number.isFinite(x) ? 'n/a' : `${x.toFixed(3)}x`);
    console.log(`\n  BASELINE (to measure the change against):`);
    console.log(`    Project (FCFF)  IRR ${pc(r.fcff?.irr)}   MOIC ${mx(r.fcff?.moic)}`);
    console.log(`    Equity  (FCFE)  IRR ${pc(r.fcfe?.irr)}   MOIC ${mx(r.fcfe?.moic)}`);
    console.log(`    Dividends       IRR ${pc(r.dividends?.irr)}   MOIC ${mx(r.dividends?.moic)}`);
    console.log(`    FCFF total ${M(sum(rs.fcffPerPeriod))} m,  FCFE total ${M(sum(rs.fcfePerPeriod))} m`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
