/**
 * diagnose-fee-visibility.ts (2026-08-19), READ ONLY.
 *
 * Item 1: the fund management fee equity row and the Fund Terms toggle are
 * reported as invisible on production, on a commit that carries both.
 *
 * Answers, per live project:
 *   - what the durable refm_fund_terms row says
 *   - what the version snapshot's project.fundTerms says
 *   - whether the two agree, and which one the engine reads
 *   - the fee schedule, the fee equity draw, and the exact value of every
 *     condition that gates the row and the toggle
 *
 * Writes nothing.
 */
/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { computeFinancialsSnapshot, computeFundingGap } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { resolveFundTerms } from '@/src/hubs/modeling/platforms/refm/lib/fundTerms';

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
  const { data: rows, error: rowsErr } = await sb.from('refm_fund_terms')
    .select('project_id, fund_enabled, management_fee_funding, fund_management_fee_pct, custody_admin_fee_pct, fund_structure_fee_pct, debt_arranging_fee_pct, other_expenses_per_annum');
  console.log('refm_fund_terms read error:', rowsErr ? rowsErr.message : 'none');

  for (const proj of projects ?? []) {
    const { data: vers } = await sb.from('refm_project_versions')
      .select('version_number, snapshot').eq('project_id', proj.id)
      .order('version_number', { ascending: false }).limit(1);
    const snap = vers?.[0]?.snapshot as Record<string, unknown> | null;
    if (!snap) continue;
    console.log(`\n==================== ${proj.name} (v${vers?.[0]?.version_number}) ====================`);

    // 1. THE DURABLE ROW.
    const row = (rows ?? []).find((r) => r.project_id === proj.id);
    console.log('  [durable refm_fund_terms row]');
    console.log(row
      ? `      fund_enabled=${row.fund_enabled}  management_fee_funding=${JSON.stringify(row.management_fee_funding)}  mgmtPct=${row.fund_management_fee_pct} custodyPct=${row.custody_admin_fee_pct} structPct=${row.fund_structure_fee_pct} arrangePct=${row.debt_arranging_fee_pct} otherPA=${row.other_expenses_per_annum}`
      : '      NO ROW');

    // 2. THE SNAPSHOT COPY, which is what the ENGINE reads.
    const projObj = (snap.project ?? {}) as Record<string, unknown>;
    const rawFt = projObj.fundTerms as Record<string, unknown> | undefined;
    console.log('  [version snapshot project.fundTerms]');
    console.log(rawFt
      ? `      enabled=${JSON.stringify(rawFt.enabled)}  managementFeeFunding=${JSON.stringify(rawFt.managementFeeFunding)}`
      : '      ABSENT from the snapshot');
    const resolved = resolveFundTerms(projObj as never);
    console.log(`  [resolveFundTerms] enabled=${resolved.enabled} managementFeeFunding=${resolved.managementFeeFunding}`);

    // 3. THE GATES, evaluated.
    console.log('  [gates]');
    console.log(`      Fund Terms toggle renders when the tab renders. Tab "off" banner when !terms.enabled -> off=${!resolved.enabled}`);
    console.log(`      Financing-tab toggle gated on fundTermsResolved.enabled -> ${resolved.enabled ? 'SHOWN' : 'HIDDEN'}`);

    // 4. THE ENGINE, as saved.
    const state = snap as never;
    let s;
    try { s = computeFinancialsSnapshot(state); } catch (e) { console.log('      engine threw:', (e as Error).message); continue; }
    const feeTotal = sum(s.fundFees?.totalPerPeriod);
    const eq = s.financing.equity;
    console.log('  [engine, AS SAVED]');
    console.log(`      fund fees charged        ${M(feeTotal)}`);
    console.log(`      equity.totalDevelopment  ${M(eq.totalDevelopment)}`);
    console.log(`      equity.totalManagementFee ${M(eq.totalManagementFee)}   <- schedule 9 row shows when > 0.005`);
    console.log(`      => equity fee row is ${eq.totalManagementFee > 0.005 ? 'SHOWN' : 'HIDDEN'}`);
    const w = computeFundingGap(s).method3Waterfall;
    console.log(`      waterfall.feeFundedByEquity   ${w.feeFundedByEquity}`);
    console.log(`      waterfall fee draw total      ${M(sum(w.managementFeeEquityDrawPerPeriod))}`);
    console.log(`      funding method                ${(projObj.financing as Record<string, unknown> | undefined)?.fundingMethod ?? 'default'}`);

    // 5. THE SAME MODEL WITH THE TOGGLE FLIPPED TO EQUITY, so we can see whether
    //    the row would appear at all on this project's data.
    const flipped = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>;
    const fp = flipped.project as Record<string, unknown>;
    fp.fundTerms = { ...(fp.fundTerms as object ?? {}), enabled: true, managementFeeFunding: 'equity' };
    try {
      const sf = computeFinancialsSnapshot(flipped as never);
      const wf = computeFundingGap(sf).method3Waterfall;
      console.log('  [engine, WITH enabled=true AND managementFeeFunding=equity]');
      console.log(`      fund fees charged            ${M(sum(sf.fundFees?.totalPerPeriod))}`);
      console.log(`      equity.totalManagementFee    ${M(sf.financing.equity.totalManagementFee)}  => row ${sf.financing.equity.totalManagementFee > 0.005 ? 'SHOWN' : 'HIDDEN'}`);
      console.log(`      waterfall fee draw total     ${M(sum(wf.managementFeeEquityDrawPerPeriod))}`);
      console.log(`      periods with construction spend AND a fee: ${wf.cashFromInvPerPeriod.filter((v, t) => v < -0.005 && (wf.fundFeesPerPeriod[t] ?? 0) > 0).length}`);
      // The reconciliation the user reported.
      const splitEquitySum = sum(sf.financing.debtEquitySplit.equity);
      const splitDedicated = sum(sf.financing.debtEquitySplit.dedicatedEquity);
      console.log(`      RECONCILE: equity.totalCash ${sf.financing.equity.totalCash} vs split.equity sum ${splitEquitySum} (dedicated ${splitDedicated})`);
      console.log(`      reconciliation issues: ${sf.financing.reconciliation.issues.length ? sf.financing.reconciliation.issues.join(' | ') : 'none'}`);
    } catch (e) { console.log('      flipped engine threw:', (e as Error).message); }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
