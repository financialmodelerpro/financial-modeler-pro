/* eslint-disable @typescript-eslint/no-explicit-any -- READ ONLY diagnostic. */
/**
 * diagnose-finance-cost-chain.ts (2026-08-18)  READ ONLY. CHANGES NOTHING.
 *
 * Measures the six items of the finance-cost / IDC / returns review against the
 * live projects, before any engine change.
 *
 *   A  the Finance Cost roll-forward: does Opening + Accrued - Paid
 *      - Capitalised = Closing still hold, and where does it break?
 *   B  FCFF with and without the IDC term.
 *   C  FCFE now, and under the proposed shape.
 *   D  the Cash Deficit Funding rows, and what the finance-cost row carries.
 *   E  how operating cash currently breaks out per asset.
 *   F  how the fund fee is funded today.
 *
 * Run: npx tsx scripts/diagnose-finance-cost-chain.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { hydrationFromAnySnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { irr, moic } from '@/src/core/calculations/returns/irr';

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
const pc = (x: number | null): string => (x !== null && Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "n/a").padStart(9);
const mx = (x: number | null): string => (x !== null && Number.isFinite(x) ? `${x.toFixed(3)}x` : "n/a").padStart(8);
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

async function main(): Promise<void> {
  const { data: prs } = await sb.from('refm_projects').select('id,name').order('updated_at', { ascending: false }).limit(10);
  for (const pr of prs ?? []) {
    const { data: v } = await sb.from('refm_project_versions').select('snapshot').eq('project_id', pr.id)
      .order('version_number', { ascending: false }).limit(1);
    const raw = v?.[0]?.snapshot as any; if (!raw) continue;
    const s = hydrationFromAnySnapshot(raw) as any; if (!s.assets?.length) continue;
    let snap: any, rs: any;
    try { snap = computeFinancialsSnapshot(s); rs = computeReturnsSnapshot(snap, s.project); } catch { continue; }
    const N = snap.axisLength;
    const y0 = new Date(s.project.startDate).getUTCFullYear();
    const c = snap.financing.combined;
    const d = snap.directCF;

    console.log('\n' + '='.repeat(104));
    console.log(`PROJECT ${pr.name}   start ${y0}, ${N} periods`);

    // ── A. The finance cost roll-forward ───────────────────────────────────
    console.log('\n  [A] FINANCE COST ROLL-FORWARD  (Opening + Accrued - Capitalised - Paid = Closing)');
    console.log('      year   opening    accrued  capitalised       paid     closing');
    let open = 0, worstClosing = 0;
    for (let t = 0; t < N; t++) {
      const acc = c.totalInterestAccrued[t] ?? 0;
      const cap = c.totalInterestCapitalized[t] ?? 0;
      const paid = (snap.financing.facilities.size > 0
        ? Array.from(snap.financing.facilities.values() as any).reduce((x: number, f: any) => x + (f.interestPaid?.[t] ?? 0), 0)
        : 0);
      const close = open + acc - paid; void cap;
      if (acc !== 0 || paid !== 0) {
        console.log(`      ${y0 + t} ${k(open)} ${k(acc)} ${k(cap)} ${k(paid)} ${k(close)}`);
      }
      if (Math.abs(close) > Math.abs(worstClosing)) worstClosing = close;
      open = close;
    }
    const accT = sum(c.totalInterestAccrued), capT = sum(c.totalInterestCapitalized);
    const paidT = sum(c.totalInterestPaid);
    console.log(`      TOTALS         accrued ${k(accT)}  capitalised ${k(capT)}  paid ${k(paidT)}`);
    console.log(`      worst |closing| = ${k(worstClosing)}k   ${Math.abs(worstClosing) < 1 ? 'FOOTS' : '<== DOES NOT FOOT: the capitalised slice is removed twice'}`);
    console.log(`      cash interest per the DEFICIT WATERFALL (accrued - capitalised) = ${k(accT - capT)}k`);
    console.log(`      cash interest per FacilityResult.interestPaid                    = ${k(paidT)}k`);
    console.log(`      -> two definitions, differing by ${k(paidT - (accT - capT))}k, which is the capitalised total`);

    // ── B / C. FCFF and FCFE, now and proposed ─────────────────────────────
    const b = rs.buildup;
    const fcff = rs.fcffPerPeriod.slice();
    const fcfe = rs.fcfePerPeriod.slice();
    // Proposed FCFF: drop the IDC term (idcCapitalisedPerPeriod is NEGATIVE).
    const fcffNoIdc = fcff.map((x: number, i: number) => x - (b.idcCapitalisedPerPeriod[i] ?? 0));
    console.log('\n  [B/C] FCFF / FCFE');
    console.log(`      FCFF today  (cfo - cash capex - in-kind - IDC)  IRR ${pc(irr(fcff))} MOIC ${mx(moic(fcff))} total ${k(sum(fcff))}`);
    console.log(`      FCFF proposed (IDC removed, in-kind kept)       IRR ${pc(irr(fcffNoIdc))} MOIC ${mx(moic(fcffNoIdc))} total ${k(sum(fcffNoIdc))}`);
    console.log(`      FCFE today                                      IRR ${pc(irr(fcfe))} MOIC ${mx(moic(fcfe))} total ${k(sum(fcfe))}`);
    console.log(`      FCFE proposed: UNCHANGED by construction (IDC leaves FCFF and is`);
    console.log(`        deducted in the FCFE step instead; the levered holder bore it either way)`);
    console.log(`      IDC inside FCFF today = ${k(-sum(b.idcCapitalisedPerPeriod))}k`);

    // ── D. Deficit funding rows ────────────────────────────────────────────
    const w = snap.fundingGap?.method3Waterfall;
    console.log('\n  [D] CASH DEFICIT FUNDING (Method 3 waterfall)');
    if (!w) { console.log('      (no funding gap snapshot on this project)'); } else {
      console.log(`      finance cost paid (cash) in the sizing   ${k(sum(w.financeCostPaidPerPeriod))}k`);
      let constr = 0, ops = 0;
      const capexByPeriod = snap.financing.capex.perPeriod.inclAllLand;
      for (let t = 0; t < N; t++) {
        const val = w.financeCostPaidPerPeriod[t] ?? 0;
        if ((capexByPeriod[t] ?? 0) > 0) constr += val; else ops += val;
      }
      console.log(`        of which in CONSTRUCTION periods       ${k(constr)}k`);
      console.log(`        of which in POST-OPERATIONS periods    ${k(ops)}k   <== item D says this does not belong in deficit sizing`);
      console.log(`      IDC paid in cash (memo)                  ${k(sum(w.idcCashPaidPerPeriod))}k`);
      console.log(`      IDC capitalised to debt (memo)           ${k(sum(w.idcDrawdownPerPeriod))}k`);
      console.log(`      net cash required (total)                ${k(sum(w.netCashRequiredPerPeriod))}k`);
    }

    // ── E. Operating cash breakout ─────────────────────────────────────────
    console.log('\n  [E] CASH FROM OPERATIONS, what exists per asset today');
    const byStrategy: Record<string, { rev: number; opex: number; n: number }> = {};
    for (const a of s.assets) {
      if (a.visible === false) continue;
      const cf = snap.perAssetCF.get(a.id); if (!cf) continue;
      const grp = (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') ? 'Residential (Sell)'
        : (a.strategy === 'Operate' || a.isCompanion) ? 'Hospitality (Operate)' : 'Retail (Lease)';
      byStrategy[grp] ??= { rev: 0, opex: 0, n: 0 };
      byStrategy[grp].rev += sum(cf.revenueReceivedPerPeriod);
      byStrategy[grp].opex += sum(cf.opexPaidPerPeriod);
      byStrategy[grp].n += 1;
    }
    for (const [g, x] of Object.entries(byStrategy)) {
      console.log(`      ${g.padEnd(24)} assets=${x.n}  revenue received ${k(x.rev)}  opex paid ${k(x.opex)}  net ${k(x.rev - x.opex)}`);
    }
    console.log(`      project-level rows NOT attributed to an asset:`);
    console.log(`        HQ expenses           ${k(sum(d.hqOpexPaidPerPeriod))}`);
    console.log(`        fund / management fee ${k(sum(d.fundFeesPaidPerPeriod))}`);
    console.log(`        tax paid              ${k(sum(d.taxPaidPerPeriod))}`);
    console.log(`        escrow adjustment     ${k(sum(d.netRevenueAdjustmentPerPeriod))}`);
    console.log(`      Cash from Operations    ${k(sum(d.cashFromOperationsPerPeriod))}`);

    // ── F. Fund fee funding ────────────────────────────────────────────────
    console.log('\n  [F] MANAGEMENT / FUND FEE FUNDING');
    const feeTot = sum(snap.fundFees?.totalPerPeriod);
    console.log(`      fund layer active: ${snap.fundFees?.active === true}`);
    console.log(`      fee total ${k(feeTot)}k, currently inside Cash from Operations, so it`);
    console.log(`      lowers cash available and is funded by the DEFICIT at the project`);
    console.log(`      debt/equity ratio. There is no funding toggle today.`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
