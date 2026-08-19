/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-e2e.ts (fund layer Step 7: end-to-end verification)
 *
 * Everything before this proved a PIECE. This proves the pieces hold together,
 * and it runs against the REAL project (FMP RE HUB, 3 phases, 8 assets across
 * Operate / Sell / Sell+Manage / Lease, 15 sub-units, 30 cost lines, 2
 * facilities) rather than the hand-built fixture, because a fixture is chosen
 * by the person writing the test and a real project is not.
 *
 * It reads the project's latest saved version snapshot and NEVER writes: the
 * fund terms are applied in memory only, so the live project is untouched.
 * With no database credentials it falls back to the shared Excel fixture and
 * says so in the header rather than silently testing something smaller.
 *
 * WHAT IT PROVES
 *
 *   1. TOGGLE OFF EQUALS TODAY, on real data, across the engine, all three
 *      exports and the screen builders. Not "the fund section is hidden": the
 *      full financials and returns snapshots must be Object.is identical
 *      between fund-terms-absent and fund-terms-present-but-disabled, and the
 *      Excel workbook and both PDFs must be identical too.
 *   2. THE FEES FLOW. P&L to cash flow to the funding requirement, with the
 *      cash chain asserted as an identity rather than a direction.
 *   3. THE WATERFALL CONSERVES CASH. Every period, every distribution is fully
 *      accounted for: nothing lost, nothing created, and the unpaid hurdle
 *      balance closes into the next period's opening.
 *   4. THE PERFORMANCE FEE IS CHARGED ONLY ON THE EXCESS above the hurdle.
 *   5. GROSS AND POST-FEE RETURNS ARE CORRECT, recomputed independently here
 *      rather than read back from the field being tested.
 *   6. THE FUND MANAGER'S FEE INCOME IS RIGHT AND DISTURBS NOTHING.
 *   7. EVERY SURFACE AGREES, in the reference row order.
 *
 * Run: npx tsx scripts/verify-fund-e2e.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { pdfText } from './pdfTextExtract';
import { computeFinancialsSnapshot, computeFundingGap } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { generateProjectPdf, generateSummaryPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows, buildFundFeeBasisRows } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import {
  buildFundWaterfallRows, buildFundFeeIncomeRows, buildFundGrossNetRows, buildFundEarnerRows,
  FUND_WATERFALL_ROW_ORDER, isFundActive, type FundReportCtx,
} from '../src/hubs/modeling/platforms/refm/lib/reports/fundReports';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { irr as irrOf, moic as moicOf } from '../src/core/calculations/returns/irr';
import { buildExcelSampleState } from './excelSampleState';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const sum = (a: readonly number[] = []): number => a.reduce((s, v) => s + (v ?? 0), 0);
const M = (v: number): string => `${(v / 1e6).toFixed(3)}m`;
/** Money tolerance. The engine is a fixed point, so exact equality is not the
 *  right bar for derived chains; 1 currency unit on a 14bn project is tight. */
const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= tol;

// ── Exact deep comparison, the Step 1 guard's shape ────────────────────────
const typeTag = (v: unknown): string => Object.prototype.toString.call(v);
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null;
  const ta = typeTag(a), tb = typeTag(b);
  if (ta !== tb) return `${path || '<root>'}: type ${ta} vs ${tb}`;
  if (typeof a === 'number' || typeof a === 'string' || typeof a === 'boolean' || a === null || a === undefined) {
    return `${path || '<root>'}: ${String(a)} vs ${String(b)}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return `${path}.size: ${a.size} vs ${b.size}`;
    for (const [k, va] of a.entries()) {
      if (!b.has(k)) return `${path}.get(${String(k)}): missing`;
      const d = firstDiff(va, b.get(k), `${path}.get(${String(k)})`); if (d) return d;
    }
    return null;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(ao), ...Object.keys(bo)])).sort();
    for (const k of keys) {
      if (!(k in ao)) return `${path}.${k}: absent on the left`;
      if (!(k in bo)) return `${path}.${k}: absent on the right`;
      const d = firstDiff(ao[k], bo[k], `${path}.${k}`); if (d) return d;
    }
    return null;
  }
  return `${path || '<root>'}: not comparable (${ta})`;
}

// ── Fund terms. FULLY POPULATED, because that is the state a real user reaches:
//    a user who fills the tab in and then switches the toggle off must get the
//    same numbers as a user who never opened it. ─────────────────────────────
const TERMS_BASE = {
  fundSize: 0, fundSizeOverride: false, facilityLimit: 0, facilityLimitOverride: false,
  fundStructureFeePct: 0.01, fundManagementFeePct: 0.02, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.0075, otherExpensesPerAnnum: 1_500_000,
  performanceFeePct: 0.20, hurdleRatePct: 0.08,
  fundManagerName: 'FMP Fund Managers', feeDistribution: [] as any[],
};

const PID = '1daa9217-d2b8-4b22-acbf-18fed79adeff'; // FMP RE HUB
const MODULE_KEYS = ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'];

async function loadRealProject(): Promise<{ raw: any; source: string }> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { raw: buildExcelSampleState(), source: 'FIXTURE (no database credentials)' };
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.from('refm_project_versions')
      .select('snapshot,version_label,created_at').eq('project_id', PID)
      .order('created_at', { ascending: false }).limit(1);
    if (error || !data?.length) return { raw: buildExcelSampleState(), source: `FIXTURE (query failed: ${error?.message ?? 'no versions'})` };
    const v = data[0] as any;
    return { raw: v.snapshot, source: `FMP RE HUB, saved version ${v.version_label ?? '(unlabelled)'} of ${String(v.created_at).slice(0, 10)}` };
  } catch (e) {
    return { raw: buildExcelSampleState(), source: `FIXTURE (connection failed: ${(e as Error).message})` };
  }
}

async function main(): Promise<void> {
  const { raw, source } = await loadRealProject();
  console.log('=== Fund layer Step 7: end-to-end verification ===');
  console.log(`Data source: ${source}\n`);
  const clone = (): any => JSON.parse(JSON.stringify(raw));
  const withTerms = (o: Partial<typeof TERMS_BASE> & { enabled: boolean }): any => {
    const s = clone(); s.project.fundTerms = { ...TERMS_BASE, ...o }; return s;
  };

  // Fund terms ABSENT. Built by DELETING them rather than by trusting the saved
  // snapshot not to have any: once the project saved a version with the fund
  // layer enabled (2026-08-10), "as saved" became fund-ON and this comparison
  // was silently measuring fund-on against fund-off instead of absent against
  // disabled. The verifier has to construct the state it means.
  const offState = clone();
  if (offState.project) delete offState.project.fundTerms;
  const disabledState = withTerms({ enabled: false });        // populated but OFF
  const onState = withTerms({ enabled: true });               // the real terms
  const snapOff = computeFinancialsSnapshot(offState);
  const retOff = computeReturnsSnapshot(snapOff, offState.project);
  const snapOn = computeFinancialsSnapshot(onState);
  const retOn = computeReturnsSnapshot(snapOn, onState.project);
  const N = snapOn.axisLength;
  console.log(`Project: ${raw.project?.name ?? '(unnamed)'}  phases=${(raw.phases ?? []).length} assets=${(raw.assets ?? []).length} periods=${N}`);
  console.log(`Fund OFF: revenue ${M(sum(snapOff.pl.totalRevenuePerPeriod))}, EBITDA ${M(sum(snapOff.pl.ebitdaPerPeriod))}, PAT ${M(sum(snapOff.pl.patPerPeriod))}`);
  console.log(`Fund ON : fees ${M(sum(snapOn.fundFees.totalPerPeriod))}, distributions ${M(retOn.waterfall.totalDistributions)}, performance fee ${M(retOn.waterfall.totalPerformanceFee)}\n`);

  // ══ 1. TOGGLE OFF EQUALS TODAY ════════════════════════════════════════════
  console.log('-- 1. Toggle OFF: identical to today, on real data --');
  {
    const snapD = computeFinancialsSnapshot(disabledState);
    const retD = computeReturnsSnapshot(snapD, disabledState.project);
    const dFin = firstDiff(snapOff, snapD);
    check('engine: the FULL financials snapshot is byte-identical (absent vs populated-but-disabled)', dFin === null, dFin ?? '');
    const dRet = firstDiff(retOff, retD);
    check('engine: the FULL returns snapshot is byte-identical', dRet === null, dRet ?? '');
    check('fund flags are all off', !snapD.fundFees.active && !retD.waterfall.active && !retD.feeEarners.active);

    const ctxD: FundReportCtx = { snap: snapD, returns: retD, fmt: { money: String, pct: () => '', mult: () => '' } };
    check('every fund presentation builder is empty',
      buildFundWaterfallRows(ctxD).length === 0 && buildFundFeeIncomeRows(ctxD).length === 0
      && buildFundGrossNetRows(ctxD).length === 0 && buildFundEarnerRows(ctxD).length === 0
      && buildFundFeeBasisRows(snapD).length === 0);

    // Screen builders: the rows the M4 tabs render.
    const labels = getFinancialLabels(offState.project.financialTerminology ?? defaultTerminologyForCountry(offState.project.country));
    const mk = (s: any, st: any) => ({ snap: s, state: st, labels, filterPhaseId: '__all__', fmt: (v: number) => String(v) });
    for (const [nm, fn] of [['P&L', buildPLRows], ['Direct CF', buildDirectCFRows], ['Indirect CF', buildIndirectCFRows]] as const) {
      const d = firstDiff((fn as any)(mk(snapOff, offState)), (fn as any)(mk(snapD, disabledState)));
      check(`screen: ${nm} rows identical`, d === null, d ?? '');
    }
    const dBs = firstDiff(buildBSRows(mk(snapOff, offState) as any), buildBSRows(mk(snapD, disabledState) as any));
    check('screen: Balance Sheet rows identical', dBs === null, dBs ?? '');

    // Excel + both PDFs.
    const fp = (wb: ExcelJS.Workbook): string => {
      const out: string[] = [];
      for (const ws of wb.worksheets) {
        out.push(`## ${ws.name} ${JSON.stringify(ws.pageSetup ?? null)}`);
        ws.eachRow((row, R) => row.eachCell((c, C) => {
          const v: any = c.value;
          const s = v && typeof v === 'object' ? ('formula' in v ? `F:${v.formula}` : ('text' in v ? `T:${v.text}` : JSON.stringify(v))) : JSON.stringify(v);
          out.push(`${R},${C}=${s}|${JSON.stringify(c.fill ?? null)}|${JSON.stringify(c.numFmt ?? null)}`);
        }));
      }
      return out.join('\n');
    };
    const xOff = fp(buildModelWorkbook({ state: offState, projectName: 'E2E', dateLabel: 'd' }));
    const xD = fp(buildModelWorkbook({ state: disabledState, projectName: 'E2E', dateLabel: 'd' }));
    check('export: the Excel workbook is identical', xOff === xD,
      `${xOff.length} vs ${xD.length} chars`);

    const common = (s: any): any => ({ state: s, projectName: 'E2E', dateLabel: 'd', displayScale: 'millions' });
    const pOff = pdfText(await generateProjectPdf({ ...common(offState), selectedModuleKeys: MODULE_KEYS } as any));
    const pD = pdfText(await generateProjectPdf({ ...common(disabledState), selectedModuleKeys: MODULE_KEYS } as any));
    check('export: the full project PDF is identical', pOff === pD);
    const sOff = pdfText(await generateSummaryPdf({ ...common(offState), selectedModuleKeys: [] } as any));
    const sD = pdfText(await generateSummaryPdf({ ...common(disabledState), selectedModuleKeys: [] } as any));
    check('export: the summary PDF is identical', sOff === sD);

    // Stronger still: toggle ON with every rate at zero must also equal today.
    // This separates "the toggle changes nothing" from "the fees change things".
    const zero = withTerms({ enabled: true, fundStructureFeePct: 0, fundManagementFeePct: 0, custodyAdminFeePct: 0, debtArrangingFeePct: 0, otherExpensesPerAnnum: 0 });
    const snapZ = computeFinancialsSnapshot(zero);
    const dZ = firstDiff(snapOff.pl, snapZ.pl);
    check('toggle ON at zero rates leaves the P&L identical (the toggle itself moves nothing)', dZ === null, dZ ?? '');
  }

  // ══ 2. THE FEES FLOW ══════════════════════════════════════════════════════
  console.log('\n-- 2. Toggle ON: fees flow P&L -> cash flow -> funding requirement --');
  {
    check('the fund layer is actually active on this project', isFundActive(retOn) && snapOn.fundFees.active);
    check('P&L books exactly the schedule total, per period',
      snapOn.pl.fundFeesPerPeriod.every((v, t) => near(v, snapOn.fundFees.totalPerPeriod[t] ?? 0, 0.01)));
    check('the five fee lines sum to the total, per period',
      snapOn.fundFees.totalPerPeriod.every((v, t) => near(v, snapOn.fundFees.lines.reduce((s, l) => s + (l.amountPerPeriod[t] ?? 0), 0), 0.01)));
    check('EBITDA equals pre-fee EBITDA less the fee, EVERY period',
      snapOn.pl.ebitdaPerPeriod.every((v, t) =>
        near(v, (snapOn.pl.ebitdaBeforeFundFeesPerPeriod?.[t] ?? 0) - (snapOn.fundFees.totalPerPeriod[t] ?? 0), 0.01)));
    check('the cash flow fee row carries the P&L fee negated, EVERY period',
      snapOn.directCF.fundFeesPaidPerPeriod.every((v, t) => near(v, -(snapOn.pl.fundFeesPerPeriod[t] ?? 0), 0.01)));
    // The cash chain as an EXACT IDENTITY: cash from operations falls by the
    // fee, less the tax the fee shields. A fee that cut both the tax bill and
    // cash by its gross amount would be double counting.
    //
    // NOTE ON SIGN, because this is where it is easy to get wrong: taxPaid is
    // stored NEGATIVE (an outflow), so the fee's tax shield shows up as
    // taxPaid_on being LESS negative than taxPaid_off, and the identity ADDS
    // that difference. Measured worst residue on the real project: 2.4e-7 on a
    // 2,040m scale, so this is exact, not approximate.
    let chainOk = true, chainDetail = '';
    for (let t = 0; t < N; t++) {
      const taxSaved = (snapOn.directCF.taxPaidPerPeriod[t] ?? 0) - (snapOff.directCF.taxPaidPerPeriod[t] ?? 0);
      const expected = (snapOff.directCF.cashFromOperationsPerPeriod[t] ?? 0) - (snapOn.fundFees.totalPerPeriod[t] ?? 0) + taxSaved;
      const got = snapOn.directCF.cashFromOperationsPerPeriod[t] ?? 0;
      if (!near(got, expected, 0.01)) { chainOk = false; chainDetail = `t=${t} got ${M(got)} expected ${M(expected)}`; break; }
    }
    check('cash from operations falls by the fee less the tax it shields, EXACTLY, every period', chainOk, chainDetail);
    check('the fee RAISES the funding requirement',
      sum(computeFundingGap(snapOn).method3Waterfall.netCashRequiredPerPeriod)
      > sum(computeFundingGap(snapOff).method3Waterfall.netCashRequiredPerPeriod));

    // THE FREEZE, tested the only way that actually means anything.
    //
    // An earlier version of this check moved the minimum cash reserve and
    // asserted the fees did not change. That was WRONG and it failed correctly:
    // moving an INPUT legitimately changes the fee, because it changes the
    // fee-free model the base is read from. The freeze does not claim the fee
    // is invariant to inputs. It claims the fee charges on the FEE-FREE pass,
    // so the funding the fee itself causes cannot come back as a bigger fee.
    //
    // So: recompute the engine's own fund-size formula on BOTH runs and check
    // which one the fee actually charged on. It must be the fee-free one.
    //
    // THE FORMULA CHANGED ON 2026-08-19 and this check follows it: the fund
    // size is now the SELECTED FUNDING METHOD'S REQUIREMENT (base debt plus
    // base equity at its ratio), matching the reference, where it used to be
    // every draw the model made over its life. What is being tested is
    // unchanged and is the whole point: whichever formula, it is evaluated on
    // the FEE-FREE pass.
    const fundSizeOf = (s: any): number => {
      const req = Math.max(0, s.financing.funding.selectedWithMinCash ?? 0);
      const d = Math.max(0, s.financing.funding.debtPct ?? 0) / 100;
      const e = Math.max(0, s.financing.funding.equityPct ?? 0) / 100;
      return req * d + req * e;
    };
    const charged = snapOn.fundFees.fundSize.amount;
    const feeFreeSize = fundSizeOf(snapOff), withFeesSize = fundSizeOf(snapOn);
    check('the fee charges on the FEE-FREE funding requirement, exactly', near(charged, feeFreeSize, 0.01),
      `charged ${M(charged)} vs fee-free ${M(feeFreeSize)}`);
    check('and NOT on the with-fees requirement (so the freeze is not vacuous)',
      Math.abs(charged - withFeesSize) > 1_000_000,
      `charged ${M(charged)} vs with-fees ${M(withFeesSize)} (the fees raised the requirement by ${M(withFeesSize - feeFreeSize)})`);
    check('the base EXCLUDES what the reference excludes: it is smaller than every-draw-ever',
      charged < (snapOff.financing.equity.grandTotal ?? 0)
        + (snapOff.financing.existing.debtOutstandingTotal ?? 0)
        + (snapOff.financing.combined.totalDrawdown as number[]).reduce((s: number, v: number) => s + (v ?? 0), 0)
        + (snapOff.financing.combined.totalInterestCapitalized as number[]).reduce((s: number, v: number) => s + (v ?? 0), 0),
      'in-kind land, pre-existing capital and IDC drawdowns are outside the base');

    // Statement integrity with fees on. The engine is an iterative fixed point,
    // so the bar is that the fund layer does not DEGRADE the residue, not that
    // the residue is zero: this project already carries one with the fund off.
    check('Direct cash flow equals Indirect, every period (bridge holds with fees on)',
      snapOn.directCF.closingCashPerPeriod.every((v, t) => near(v, snapOn.indirectCF.closingCashPerPeriod[t] ?? 0, 5)));
    const bsResidue = (s: any): number => {
      let worst = 0;
      for (let t = 0; t < N; t++) worst = Math.max(worst, Math.abs((s.bs.totalAssetsPerPeriod[t] ?? 0) - (s.bs.totalLiabilitiesAndEquityPerPeriod[t] ?? 0)));
      return worst;
    };
    const scale = Math.max(...snapOn.bs.totalAssetsPerPeriod.map(Math.abs), 1);
    check('the balance sheet balances to solver tolerance, every period', bsResidue(snapOn) / scale < 1e-6,
      `worst ${bsResidue(snapOn).toExponential(3)} on ${M(scale)} = ${(bsResidue(snapOn) / scale).toExponential(2)} relative`);
    check('and the fund layer does not WORSEN that residue', bsResidue(snapOn) <= bsResidue(snapOff) * 1.01 + 1,
      `on ${bsResidue(snapOn).toExponential(3)} vs off ${bsResidue(snapOff).toExponential(3)}`);
  }

  // ══ 3 to 6. The waterfall, returns and fee earners ════════════════════════
  // The real project at its own 8% hurdle never clears it, so the carry
  // mechanics would be VACUOUS there. Both cases are run and both are reported:
  // the real terms, and a cleared-hurdle case that exercises the fee.
  const cases: Array<{ label: string; state: any }> = [
    { label: 'real terms (8% hurdle)', state: onState },
    { label: 'cleared hurdle (0% hurdle, 20% fee)', state: withTerms({ enabled: true, hurdleRatePct: 0 }) },
  ];
  // Collected across the cases so the "the waterfall touches no gross stream"
  // claim is tested BETWEEN two different hurdle settings rather than asserted.
  const grossByCase: Array<{ label: string; fcff: number[]; fcfe: number[]; div: number[]; irr: number | null }> = [];
  for (const c of cases) {
    const s = computeFinancialsSnapshot(c.state);
    const r = computeReturnsSnapshot(s, c.state.project);
    const w = r.waterfall;
    console.log(`\n-- 3. Waterfall conservation :: ${c.label} --`);
    console.log(`     distributions ${M(w.totalDistributions)}, hurdle paid ${M(w.totalHurdlePaid)}, excess ${M(w.totalExcessDistributions)}, fee ${M(w.totalPerformanceFee)}, shortfall ${M(w.hurdleShortfall)}`);
    let split = true, accrual = true, closes = true, minRule = true, feeRule = true, d = '';
    for (let i = 0; i < w.periods.length; i++) {
      const p = w.periods[i];
      if (!near(p.distribution, p.hurdlePaid + p.excessDistributions, 0.01)) { split = false; d = `t=${i} distribution split`; }
      if (!near(p.hurdleAccrued, (p.openingUnpaidHurdle + p.equityDrawn) * w.hurdleRate, 0.01)) { accrual = false; d = `t=${i} accrual`; }
      if (!near(p.totalHurdleOwed, p.equityDrawn + p.openingUnpaidHurdle + p.hurdleAccrued, 0.01)) { accrual = false; d = `t=${i} owed`; }
      if (!near(p.hurdlePaid, Math.min(p.distribution, p.totalHurdleOwed), 0.01)) { minRule = false; d = `t=${i} MIN rule`; }
      if (!near(p.closingUnpaidHurdle, p.totalHurdleOwed - p.hurdlePaid, 0.01)) { closes = false; d = `t=${i} closing`; }
      const nxt = w.periods[i + 1];
      if (nxt && !near(p.closingUnpaidHurdle, nxt.openingUnpaidHurdle, 0.01)) { closes = false; d = `t=${i} closing != next opening`; }
      if (!near(p.performanceFee, p.excessDistributions * w.performanceFeePct, 0.01)) { feeRule = false; d = `t=${i} fee != excess x pct`; }
      if (p.excessDistributions <= 0 && p.performanceFee !== 0) { feeRule = false; d = `t=${i} fee charged with no excess`; }
      if (!near(p.netDistribution, p.distribution - p.performanceFee, 0.01)) { split = false; d = `t=${i} net distribution`; }
      if (!near(p.excessDistributions, p.performanceFee + p.excessAfterFee, 0.01)) { split = false; d = `t=${i} excess split`; }
    }
    check(`[${c.label}] every distribution splits into hurdle paid + excess, and excess into fee + remainder`, split, d);
    check(`[${c.label}] the hurdle accrues on the opening balance PLUS the same-period draw`, accrual, d);
    check(`[${c.label}] hurdle paid is MIN(distribution, owed)`, minRule, d);
    check(`[${c.label}] the unpaid hurdle balance closes into the next period's opening`, closes, d);
    check(`[${c.label}] the performance fee is charged ONLY on the excess above the hurdle`, feeRule, d);
    // "Zero by construction" is true in exact arithmetic; in doubles it leaves
    // a residue. Measured on the real project: -9.5e-7 against 4,437m of
    // distributions, a relative 2.2e-16, which is one machine epsilon. The bar
    // is therefore relative to the cash being split, not literal zero.
    check(`[${c.label}] nothing is lost or created: unallocated is zero to machine precision`,
      Math.abs(w.unallocated) / Math.max(1, w.totalDistributions) < 1e-12,
      `${w.unallocated} on ${M(w.totalDistributions)}`);
    check(`[${c.label}] lifetime distributions == hurdle paid + excess`,
      near(w.totalDistributions, w.totalHurdlePaid + w.totalExcessDistributions, 1));
    check(`[${c.label}] lifetime excess == performance fee + remainder`,
      near(w.totalExcessDistributions, w.totalPerformanceFee + w.totalExcessAfterFee, 1));
    check(`[${c.label}] lifetime net distributions == distributions less the fee`,
      near(w.totalNetDistributions, w.totalDistributions - w.totalPerformanceFee, 1));

    console.log(`-- 4. Gross vs post-fee returns :: ${c.label} --`);
    const gross = r.result.dividends, net = r.resultNetDividends;
    check(`[${c.label}] the net stream is the gross stream less the fee, per period`,
      r.netDividendStreamPerPeriod.every((v, t) => near(v, (r.dividendStreamPerPeriod[t] ?? 0) - (w.performanceFeePerPeriod[t] ?? 0), 0.01)));
    // Recomputed here, independently, rather than read back from the field.
    const myIrr = irrOf([...r.netDividendStreamPerPeriod]);
    const myMoic = moicOf([...r.netDividendStreamPerPeriod]);
    check(`[${c.label}] the post-fee IRR recomputes independently`,
      (myIrr === null && net.irr === null) || (myIrr !== null && net.irr !== null && Math.abs(myIrr - net.irr) < 1e-9),
      `mine=${myIrr} snapshot=${net.irr}`);
    check(`[${c.label}] the post-fee MOIC recomputes independently`, Math.abs(myMoic - net.moic) < 1e-9,
      `mine=${myMoic} snapshot=${net.moic}`);
    if (w.totalPerformanceFee > 0) {
      check(`[${c.label}] a fee was charged, so the net IRR is BELOW the gross IRR`,
        net.irr !== null && gross.irr !== null && net.irr < gross.irr, `gross=${gross.irr} net=${net.irr}`);
      check(`[${c.label}] and the net MOIC is below the gross MOIC`, net.moic < gross.moic);
    } else {
      check(`[${c.label}] no fee was charged, so gross and net are EQUAL`,
        Object.is(net.irr, gross.irr) && Object.is(net.moic, gross.moic), `gross=${gross.irr} net=${net.irr}`);
    }
    grossByCase.push({ label: c.label, fcff: r.fcffPerPeriod, fcfe: r.fcfePerPeriod, div: r.dividendStreamPerPeriod, irr: gross.irr });

    console.log(`-- 5. Fee earners :: ${c.label} --`);
    const fe = r.feeEarners;
    check(`[${c.label}] the Fund Manager takes 100% of the management fees, unsplit`,
      near(fe.earners.filter((e) => e.kind === 'fund_manager').reduce((a, e) => a + e.totalManagementFeeIncome, 0), sum(s.fundFees.totalPerPeriod), 1));
    check(`[${c.label}] management fees earned equal the fees CHARGED in the P&L`,
      near(fe.totalManagementFee, sum(s.pl.fundFeesPerPeriod), 1));
    check(`[${c.label}] allocated performance fee + unallocated == the total performance fee`,
      near(fe.allocatedPerformanceFee + fe.unallocatedPerformanceFee, w.totalPerformanceFee, 1));
    check(`[${c.label}] no fee earner id appears among the equity partner ids`, (() => {
      const partnerIds = new Set(r.partners.partners.map((p: any) => p.id));
      return fe.earners.every((e) => !partnerIds.has(e.entityId));
    })());
    // The decisive one: changing the fee split must move NOTHING but feeEarners.
    // The matrix column is `performanceFeePct`. An earlier version of this used
    // `sharePct`, which sanitizeFeeDistribution drops to 0, so the split did
    // not move and the "not vacuous" guard below caught it. Keeping that guard.
    const alt = JSON.parse(JSON.stringify(c.state));
    alt.project.fundTerms = {
      ...alt.project.fundTerms,
      feeDistribution: [{ partyId: '__fund_manager__', partyName: 'FMP Fund Managers', performanceFeePct: 0.55, developerFeePct: 0, commissionPct: 0 }],
    };
    const rAlt = computeReturnsSnapshot(computeFinancialsSnapshot(alt), alt.project);
    check(`[${c.label}] changing the fee matrix leaves the ENTIRE partners block byte-identical`,
      firstDiff(r.partners, rAlt.partners) === null, firstDiff(r.partners, rAlt.partners) ?? '');
    check(`[${c.label}] and leaves every gross stream byte-identical`,
      firstDiff(r.fcffPerPeriod, rAlt.fcffPerPeriod) === null
      && firstDiff(r.fcfePerPeriod, rAlt.fcfePerPeriod) === null
      && firstDiff(r.dividendStreamPerPeriod, rAlt.dividendStreamPerPeriod) === null);
    check(`[${c.label}] and the fee split DID move (so the check is not vacuous)`,
      firstDiff(r.feeEarners, rAlt.feeEarners) !== null);
    // Sigma partners == consolidated, the identity the partner table rests on.
    check(`[${c.label}] Sigma partner streams still equals the consolidated stream, per period`, (() => {
      const ps = r.partners.partners;
      if (!ps.length) return true;
      for (let i = 0; i < r.dividendStreamPerPeriod.length; i++) {
        const agg = ps.reduce((a: number, p: any) => a + (p.cashFlowStream?.[i] ?? 0), 0);
        if (!near(agg, r.dividendStreamPerPeriod[i] ?? 0, 1)) return false;
      }
      return true;
    })());
  }

  // The two cases differ ONLY in the hurdle rate, and the hurdle splits cash
  // that has already left the project, so every GROSS stream must be identical
  // between them. This is the structural claim that keeps the waterfall out of
  // the funding solve, tested across two real settings rather than asserted.
  console.log('\n-- 6. The waterfall touches no gross stream --');
  {
    const [a, b] = grossByCase;
    check('changing the hurdle leaves FCFF byte-identical', firstDiff(a.fcff, b.fcff) === null, firstDiff(a.fcff, b.fcff) ?? '');
    check('changing the hurdle leaves FCFE byte-identical', firstDiff(a.fcfe, b.fcfe) === null, firstDiff(a.fcfe, b.fcfe) ?? '');
    check('changing the hurdle leaves the gross Distributed Equity stream byte-identical',
      firstDiff(a.div, b.div) === null, firstDiff(a.div, b.div) ?? '');
    check('and the gross IRR is the same on both', Object.is(a.irr, b.irr), `${a.irr} vs ${b.irr}`);
  }

  // ══ 7. EVERY SURFACE AGREES ═══════════════════════════════════════════════
  console.log('\n-- 7. Consistency: screen, full PDF, summary PDF, Excel --');
  {
    const ctxNum: FundReportCtx = { snap: snapOn, returns: retOn, fmt: { money: (v) => String(v), pct: () => '', mult: () => '' } };
    const wfRows = buildFundWaterfallRows(ctxNum);
    const common = (s: any): any => ({ state: s, projectName: 'E2E', dateLabel: 'd', displayScale: 'millions' });
    const full = pdfText(await generateProjectPdf({ ...common(onState), selectedModuleKeys: MODULE_KEYS } as any));
    const summary = pdfText(await generateSummaryPdf({ ...common(onState), selectedModuleKeys: [] } as any));
    const wb = buildModelWorkbook({ state: onState, projectName: 'E2E', dateLabel: 'd' });
    const ret = wb.getWorksheet('Returns')!;
    const labelOf = (ws: ExcelJS.Worksheet, R: number): string => {
      const a = ws.getCell(R, 1).value;
      return typeof a === 'string' ? a : (a && typeof a === 'object' && 'text' in (a as any) ? (a as any).text : '');
    };
    const rowOf = (ws: ExcelJS.Worksheet, label: string): number => {
      let hit = -1; ws.eachRow((_r, R) => { if (hit < 0 && labelOf(ws, R) === label) hit = R; }); return hit;
    };

    // Row ORDER identical on all four surfaces.
    check('the waterfall row order matches on the screen builder', wfRows.map((r) => r.label).join('|') === FUND_WATERFALL_ROW_ORDER.join('|'));
    const orderIn = (txt: string): boolean => {
      const lines = txt.split('\n');
      const start = lines.findIndex((l) => l.includes('Distribution Waterfall'));
      if (start < 0) return false;
      const sc = lines.slice(start);
      const idx = FUND_WATERFALL_ROW_ORDER.map((l) => sc.findIndex((x) => x.includes(l)));
      return idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    };
    check('the waterfall row order matches in the full PDF', orderIn(full));
    check('the waterfall row order matches in the summary PDF', orderIn(summary));
    check('the waterfall row order matches in Excel', (() => {
      const rows = FUND_WATERFALL_ROW_ORDER.map((l) => rowOf(ret, l));
      return rows.every((v, i) => v > 0 && (i === 0 || v > rows[i - 1]));
    })());

    // The NUMBERS: every waterfall row's lifetime total must agree between the
    // shared builder and the Excel cell, and appear in both PDFs (which render
    // in millions, so they are matched on the formatted figure).
    let cellsOk = true, cellDetail = '';
    for (const row of wfRows) {
      if (row.totalOverride === '') continue; // balances carry no total anywhere
      const R = rowOf(ret, row.label);
      const cell = R > 0 ? ret.getCell(R, 4).value : null;
      const got = typeof cell === 'number' ? cell : NaN;
      if (!near(got, Number(row.totalOverride), 1)) { cellsOk = false; cellDetail = `${row.label}: excel=${got} builder=${row.totalOverride}`; break; }
    }
    check('every waterfall total agrees between the shared builder and the Excel cell', cellsOk, cellDetail);

    // Both PDFs render money in millions WITH thousands separators ("1,047.1"),
    // so the needle has to be built the same way. An earlier version searched
    // for "1047.1" and failed on every figure above a billion.
    const mm = (v: number): string => (v / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const keyFigures: Array<[string, number]> = [
      ['total fund fees', sum(snapOn.fundFees.totalPerPeriod)],
      ['performance fee', retOn.waterfall.totalPerformanceFee],
      ['distributions', retOn.waterfall.totalDistributions],
      ['fund manager fee income', retOn.feeEarners.earners[0]?.totalFeeIncome ?? 0],
    ];
    for (const [nm, v] of keyFigures) {
      if (Math.abs(v) < 1e5) { check(`${nm} is zero on this project, so no cross-surface figure to match`, true); continue; }
      const needle = mm(v);
      check(`${nm} (${needle}m) appears in the full PDF`, full.includes(needle), needle);
      check(`${nm} (${needle}m) appears in the summary PDF`, summary.includes(needle), needle);
    }
    check('both PDFs and Excel name the same Fund Manager',
      full.includes(TERMS_BASE.fundManagerName) && summary.includes(TERMS_BASE.fundManagerName)
      && rowOf(ret, 'Fund Manager') > 0);
    check('the P&L fee total agrees between the shared builder and Excel', (() => {
      const pl = wb.getWorksheet('P&L')!;
      const R = rowOf(pl, 'Total Fund Management Fee');
      const v = R > 0 ? pl.getCell(R, 4).value : null;
      return typeof v === 'number' && near(v, -sum(snapOn.fundFees.totalPerPeriod), 1);
    })());
    check('the cash flow fee row agrees between the shared builder and Excel', (() => {
      const cf = wb.getWorksheet('Cash Flow')!;
      const R = rowOf(cf, 'Fund Management and Other Expenses');
      const v = R > 0 ? cf.getCell(R, 4).value : null;
      return typeof v === 'number' && near(v, sum(snapOn.directCF.fundFeesPaidPerPeriod), 1);
    })());
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
