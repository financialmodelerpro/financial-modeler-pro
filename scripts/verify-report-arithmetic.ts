/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * verify-report-arithmetic.ts
 *
 * The export review (2026-08-12) found FOUR wrong numbers and two broken sign
 * conventions that every existing verifier passed straight over, because each
 * one checked that a row EXISTS, not that the column ADDS UP. This file checks
 * the arithmetic itself, on the identities a reader would actually try:
 *
 *   A1  the cash waterfall reaches the closing cash its last row claims to tie
 *       to (it was adding interest and principal instead of subtracting them,
 *       because directCF stores both ALREADY NEGATIVE and the builder negated
 *       them a second time). Overstatement was 2 x interest + 2 x principal.
 *   A2  the FCFE build-up foots to FCFE (the PDF started from FCFF, which
 *       already carries the terminal ENTERPRISE value, then added the terminal
 *       EQUITY value on top).
 *   A3  "new debt" means ONE thing across the document, and it reconciles:
 *       existing debt + new debt raised == peak debt outstanding.
 *   A4  per-asset cost is non-zero and foots to total development cost (the
 *       per-asset capex series is a POSITIVE magnitude and the engine clamped
 *       `max(0, -sum)`, so every asset reported zero cost and 100% margin).
 *   B1  the summary PDF's P&L column adds up (deductions were printed positive
 *       beside a negative fund fee row).
 *   C1/C2 no stock is summed across periods in the cash waterfall.
 *
 * Every check runs against the FIXTURE (buildExcelSampleState) so it is a stable
 * baseline, and again against the real project when database credentials are
 * present. Toggle-off byte-identity is proven on the fixture only, per
 * CLAUDE.md: the real project is edited in place and is not a baseline.
 *
 * Run: npx tsx scripts/verify-report-arithmetic.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { pdfText } from './pdfTextExtract';
import { generateProjectPdf, generateSummaryPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildCashSweepTables } from '../src/hubs/modeling/platforms/refm/lib/reports/financingReports';
import { FCFE_BUILDUP_LABELS } from '../src/hubs/modeling/platforms/refm/lib/reports/streamReports';
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
/** Relative tolerance, anchored on the PEAK magnitude of the series (never the
 *  last period, which can be near zero and turns a rounding residue into a
 *  failure). Absolute floor of 1 currency unit for all-zero series. */
const near = (a: number, b: number, scale: number): boolean =>
  Math.abs(a - b) <= Math.max(1, Math.abs(scale) * 1e-9);

const PID = '1daa9217-d2b8-4b22-acbf-18fed79adeff'; // FMP RE HUB
const MODULE_KEYS = ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'];
const FUND_TERMS = {
  enabled: true, fundSize: 0, fundSizeOverride: false, facilityLimit: 0, facilityLimitOverride: false,
  fundStructureFeePct: 0.005, fundManagementFeePct: 0.005, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.005, otherExpensesPerAnnum: 3_000_000,
  performanceFeePct: 0.2, hurdleRatePct: 0.08,
  fundManagerName: 'Fund Manager', feeDistribution: [] as any[],
};

/** pdf-lib writes CID glyph ids and Inter substitutes case-alternate forms for
 *  brackets, so these land in the private use area and a naive decode silently
 *  DROPS every parenthesis, turning negatives into positives. */
const PUA: Record<string, string> = {
  '\uE081': '(', '\uE082': ')', '\uE083': '[', '\uE084': ']', '\uE088': '-', '\uE092': ':',
};
const decode = (b: Uint8Array): string => pdfText(b).replace(/[\uE000-\uF8FF]/g, (c) => PUA[c] ?? '?');
/** "1,234.5" / "(1,234.5)" / "-" -> number. */
const num = (s: string): number | null => {
  const t = s.trim();
  if (t === '-' || t === '') return 0;
  const m = /^\(?([0-9,]+(?:\.[0-9]+)?)\)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return t.startsWith('(') ? -v : v;
};
/** The Total cell of a labelled row in the decoded text (first token after the
 *  label). `from` scopes the search past a heading, because build-up tables
 *  reuse labels ("(+) Cash from operations" is in BOTH the FCFF and the FCFE
 *  build-up) and a whole-document search silently reads the wrong table. */
function rowTotal(txt: string, label: string, from = 0): number | null {
  const lines = txt.split('\n');
  const i = lines.findIndex((l, k) => k >= from && l.trim() === label);
  if (i < 0) return null;
  return num(lines[i + 1] ?? '');
}
const lineOf = (txt: string, needle: string): number =>
  txt.split('\n').findIndex((l) => l.includes(needle));

async function runFor(tag: string, state: any): Promise<void> {
  console.log(`\n=== ${tag} ===`);
  const snap: any = computeFinancialsSnapshot(state);
  const rs: any = computeReturnsSnapshot(snap, state.project);
  const N = snap.axisLength;
  const dcf = snap.directCF;
  const peakCash = Math.max(1, ...dcf.closingCashPerPeriod.map((v: number) => Math.abs(v)));

  // ── A1 + B2: the cash waterfall reaches closing cash ──────────────────────
  console.log('-- A1/B2: the cash waterfall ties to closing cash --');
  const minCash = state.project.financing?.minimumCashReserve ?? snap.financing.funding.minCashReserve ?? 0;
  const opening = dcf.openingCashPerPeriod.slice(0, N);
  const rebuilt: number[] = [];
  for (let i = 0; i < N; i++) {
    const avail = (opening[i] ?? 0) + (dcf.cashFromOperationsPerPeriod[i] ?? 0) + (dcf.cashFromInvestmentPerPeriod[i] ?? 0)
      + (dcf.equityDrawdownPerPeriod[i] ?? 0) + (dcf.debtDrawdownPerPeriod[i] ?? 0) + (dcf.interestPaidPerPeriod[i] ?? 0);
    rebuilt.push(avail + (dcf.debtRepaymentPerPeriod[i] ?? 0) - (snap.dividends.totalDividendsPerPeriod[i] ?? 0));
  }
  const worst = Math.max(...rebuilt.map((v, i) => Math.abs(v - (dcf.closingCashPerPeriod[i] ?? 0))));
  check('the waterfall chain equals closing cash in EVERY period',
    worst <= Math.max(1, peakCash * 1e-9), `worst residue ${worst.toExponential(2)} on peak ${(peakCash / 1e6).toFixed(1)}m`);

  const sweepTables = buildCashSweepTables(snap, state, (v: number) => String(v));
  const wf = sweepTables.find((t) => t.title.startsWith('Cash Waterfall'));
  check('the shared builder emits the Cash Waterfall', !!wf);
  if (wf) {
    const byLabel = (l: string) => wf.rows.find((r) => r.label === l);
    const avail = byLabel('= Cash Available');
    const forDiv = byLabel('= Cash Available for Dividend');
    const closing = byLabel('= Closing Cash (ties to CF + BS)');
    check('builder: "= Cash Available" matches the engine period by period', !!avail
      && avail.values.every((v, i) => near(v, (opening[i] ?? 0) + (dcf.cashFromOperationsPerPeriod[i] ?? 0) + (dcf.cashFromInvestmentPerPeriod[i] ?? 0)
        + (dcf.equityDrawdownPerPeriod[i] ?? 0) + (dcf.debtDrawdownPerPeriod[i] ?? 0) + (dcf.interestPaidPerPeriod[i] ?? 0), peakCash)));
    check('builder: interest is SUBTRACTED, not added (a positive-interest project moves the row)',
      !!avail && sum(avail.values) < sum(opening) + sum(dcf.cashFromOperationsPerPeriod.slice(0, N)) + sum(dcf.cashFromInvestmentPerPeriod.slice(0, N))
        + sum(dcf.equityDrawdownPerPeriod.slice(0, N)) + sum(dcf.debtDrawdownPerPeriod.slice(0, N)) + 1);
    check('builder: "(-) Interest Paid" is displayed NEGATIVE',
      (byLabel('(-) Interest Paid')?.values ?? []).every((v, i) => v === (dcf.interestPaidPerPeriod[i] ?? 0)));
    check('builder: "(-) Debt Paid (total ...)" is displayed NEGATIVE',
      (byLabel('(-) Debt Paid (total principal incl. sweep)')?.values ?? []).every((v, i) => v === (dcf.debtRepaymentPerPeriod[i] ?? 0)));
    check('builder: Cash Available + Debt Paid == Cash Available for Dividend', !!avail && !!forDiv
      && forDiv.values.every((v, i) => near(v, (avail.values[i] ?? 0) + (dcf.debtRepaymentPerPeriod[i] ?? 0), peakCash)));
    check('builder: Cash Available for Dividend - Dividends == Closing Cash', !!forDiv && !!closing
      && closing.values.every((v, i) => near(v, (forDiv.values[i] ?? 0) - (snap.dividends.totalDividendsPerPeriod[i] ?? 0), peakCash)));

    // ── C1 + C2: no stock summed across periods ─────────────────────────────
    console.log('-- C1/C2: no stock is summed across periods --');
    const STOCKS = ['Opening Cash', '= Cash Available', '(memo) Minimum Cash Requirement (reserved, not spent)',
      '(memo) Headroom above the minimum reserve', '= Cash Available for Dividend', '= Closing Cash (ties to CF + BS)'];
    for (const l of STOCKS) {
      const row = byLabel(l);
      check(`stock row carries an explicit Total, never a period sum: ${l}`,
        !!row && row.totalOverride !== undefined, row ? 'no totalOverride' : 'row missing');
    }
    const reserve = byLabel('(memo) Minimum Cash Requirement (reserved, not spent)');
    check('the minimum cash reserve Total is the STANDING reserve, not N x it',
      !!reserve && near(Number(reserve.totalOverride), -minCash, Math.max(1, minCash)),
      `total=${reserve?.totalOverride} minCash=${minCash}`);
    check('the reserve is a memo beside the chain, not a step in it (indented)', reserve?.indent === 1);
  }

  // ── A2: the FCFE build-up foots ───────────────────────────────────────────
  console.log('-- A2: the FCFE build-up foots to FCFE --');
  const bu = rs.buildup;
  const peakFcfe = Math.max(1, ...rs.fcfePerPeriod.map((v: number) => Math.abs(v)));
  // 2026-08-18: FCFE is now the CHAIN FROM FCFF. It starts at the FCFF
  // subtotal, backs out the two things FCFF carries that the levered stream
  // replaces, and adds the financing legs. No in-kind term and no IDC term:
  // both are inside the FCFF subtotal already.
  const fcfeRebuilt = rs.fcfePerPeriod.map((_: number, i: number) =>
    (bu.existingEquityPerPeriod[i] ?? 0) + (bu.fcffSubtotalPerPeriod[i] ?? 0)
    + (bu.existingPreCapexRemovalPerPeriod[i] ?? 0) + (bu.terminalEnterpriseRemovalPerPeriod[i] ?? 0)
    + (bu.financeCostPerPeriod[i] ?? 0)
    + (bu.debtDrawPerPeriod[i] ?? 0) + (bu.idcDrawPerPeriod[i] ?? 0) + (bu.principalRepayPerPeriod[i] ?? 0)
    + (bu.terminalEquityPerPeriod[i] ?? 0));
  check('the build-up components sum to FCFE in every period',
    fcfeRebuilt.every((v: number, i: number) => near(v, rs.fcfePerPeriod[i] ?? 0, peakFcfe)),
    `worst ${Math.max(...fcfeRebuilt.map((v: number, i: number) => Math.abs(v - (rs.fcfePerPeriod[i] ?? 0)))).toExponential(2)}`);
  check('the build-up does NOT start from FCFF (which already carries the terminal enterprise value)',
    !near(sum(fcfeRebuilt), sum(rs.fcffPerPeriod) + sum(bu.terminalEquityPerPeriod), peakFcfe)
    || sum(bu.terminalEquityPerPeriod) === 0);

  // ── A3: one definition of new debt, and it reconciles ─────────────────────
  console.log('-- A3: new debt reconciles to peak debt --');
  const newDebtRaised = sum(snap.financing.combined.totalDrawdown) + sum(snap.financing.combined.totalInterestCapitalized);
  const peakDebt = Math.max(0, ...snap.bs.debtOutstandingPerPeriod);
  const existingDebt = snap.financing.existing.debtOutstandingTotal;
  const repaid = sum(snap.financing.combined.totalPrincipalRepaid);
  const closingDebt = snap.bs.debtOutstandingPerPeriod[N - 1] ?? 0;
  // The roll-forward is the real identity. "raised == peak - existing" holds only
  // when every draw precedes every repayment; a project that draws and repays
  // concurrently (the fixture does) legitimately raises MORE than its peak.
  check('existing + new debt raised - principal repaid == closing debt outstanding',
    near(existingDebt + newDebtRaised - repaid, closingDebt, Math.max(1, peakDebt)),
    `${(existingDebt / 1e6).toFixed(1)} + ${(newDebtRaised / 1e6).toFixed(1)} - ${(repaid / 1e6).toFixed(1)} vs closing ${(closingDebt / 1e6).toFixed(1)}`);
  check('new debt raised covers the peak above the existing balance',
    existingDebt + newDebtRaised >= peakDebt - Math.max(1, peakDebt * 1e-9),
    `${((existingDebt + newDebtRaised) / 1e6).toFixed(1)} vs peak ${(peakDebt / 1e6).toFixed(1)}`);
  check('the cash-only drawdown is SMALLER than the debt raised (capitalised interest is the gap)',
    sum(snap.directCF.debtDrawdownPerPeriod.slice(0, N)) <= newDebtRaised + 1);
  check('Sources & Uses uses that same figure',
    near(rs.sourcesUses.newDebt, newDebtRaised, Math.max(1, newDebtRaised)),
    `${rs.sourcesUses.newDebt} vs ${newDebtRaised}`);

  // ── A4: per-asset cost is real ────────────────────────────────────────────
  console.log('-- A4: per-asset economics carries real cost --');
  const rows = rs.perAsset.rows as any[];
  check('at least one asset carries a non-zero cost', rows.some((r) => r.totalCost > 0),
    rows.map((r) => `${r.assetName}=${r.totalCost}`).join(' '));
  check('no asset reports a 100% margin while the project has development cost',
    !(snap.financing.capex.totals.inclAllLand > 0 && rows.length > 0 && rows.every((r) => r.profitMargin === 1)),
    rows.map((r) => `${r.assetName}:${r.profitMargin}`).join(' '));
  check('per-asset cost never exceeds total development cost',
    rs.perAsset.totalCost <= snap.financing.capex.totals.inclAllLand * 1.000001,
    `${(rs.perAsset.totalCost / 1e6).toFixed(1)} vs ${(snap.financing.capex.totals.inclAllLand / 1e6).toFixed(1)}`);
  check('an income asset with cost now reports a yield on cost',
    rows.filter((r) => r.isIncomeAsset && r.totalCost > 0).every((r) => r.yieldOnCost !== null));

  // ── B1: the summary PDF P&L column adds up ────────────────────────────────
  console.log('-- B1: the summary PDF P&L column adds up --');
  const common = { state, projectName: 'Arithmetic Check', dateLabel: '12 August 2026', displayScale: 'millions' } as any;
  const sumTxt = decode(await generateSummaryPdf({ ...common, selectedModuleKeys: [] }));
  const rev = rowTotal(sumTxt, 'Total revenue');
  const cos = rowTotal(sumTxt, 'Cost of sales');
  const opex = rowTotal(sumTxt, 'Operating expenses');
  const fee = snap.fundFees.active ? rowTotal(sumTxt, 'Total Fund Management Fee') : 0;
  const ebitda = rowTotal(sumTxt, 'EBITDA');
  const da = rowTotal(sumTxt, 'Depreciation & amortization');
  const ebit = rowTotal(sumTxt, 'EBIT');
  const interest = rowTotal(sumTxt, 'Interest expense');
  const pbt = rowTotal(sumTxt, 'Profit before tax');
  const tax = rowTotal(sumTxt, 'Tax / Zakat');
  const pat = rowTotal(sumTxt, 'Profit after tax');
  const got = [rev, cos, opex, fee, ebitda, da, ebit, interest, pbt, tax, pat];
  check('every summary P&L Total cell decoded', got.every((v) => v !== null), JSON.stringify(got));
  if (got.every((v) => v !== null)) {
    // Printed in millions to 1dp, so 0.2 absorbs the rounding of four addends.
    check('revenue + cost of sales + opex + fund fee == EBITDA (as printed)',
      Math.abs((rev! + cos! + opex! + (fee ?? 0)) - ebitda!) < 0.2, `${rev} ${cos} ${opex} ${fee} -> ${ebitda}`);
    check('EBITDA + D&A == EBIT (as printed)', Math.abs((ebitda! + da!) - ebit!) < 0.2, `${ebitda} ${da} -> ${ebit}`);
    check('EBIT + interest == PBT (as printed)', Math.abs((ebit! + interest!) - pbt!) < 0.2, `${ebit} ${interest} -> ${pbt}`);
    check('PBT + tax == PAT (as printed)', Math.abs((pbt! + tax!) - pat!) < 0.2, `${pbt} ${tax} -> ${pat}`);
    check('deductions print NEGATIVE, matching the full report',
      cos! <= 0 && opex! <= 0 && da! <= 0 && interest! <= 0 && tax! <= 0,
      `cos=${cos} opex=${opex} da=${da} int=${interest} tax=${tax}`);
  }

  // ── A3 in the document: the exec summary agrees with Sources & Uses ───────
  const fullTxt = decode(await generateProjectPdf({ ...common, selectedModuleKeys: MODULE_KEYS }));
  const execDebt = rowTotal(fullTxt, 'Total new debt (incl. capitalised interest)');
  check('the executive summary prints the reconciling new-debt figure',
    execDebt !== null && Math.abs(execDebt - newDebtRaised / 1e6) < 0.2,
    `printed ${execDebt} vs ${(newDebtRaised / 1e6).toFixed(1)}`);
  // 2026-08-18: the drawdown is now SPLIT, so the row that used to read
  // "(cash)" to distinguish it from the capitalised-interest figure is instead
  // named for what it funds. Both halves must be on the page.
  check('the FCFE build-up names BOTH drawdowns, capex and IDC',
    fullTxt.includes('(+) Debt Drawdown for Capex') && fullTxt.includes('(+) Debt Drawdown for IDC'));

  // A2 ON THE PAGE, not just in the engine. The engine identity can hold while
  // the PDF renders a different row list, which is exactly what happened: the
  // engine was right and the PDF's own copy of the build-up was not. So add the
  // printed Total cells and require them to reach the printed "= FCFE".
  console.log('-- A2 (rendered): the printed FCFE build-up column adds up --');
  const fcfeAt = lineOf(fullTxt, 'FCFE Build-up');
  check('the full report renders an FCFE Build-up', fcfeAt >= 0);
  if (fcfeAt >= 0) {
    // Labels come FROM THE SHARED BUILDER, so this verifier cannot drift from
    // the thing it checks and a renamed row fails loudly rather than silently.
    const COMPONENTS = FCFE_BUILDUP_LABELS.slice(0, -1);
    const parts = COMPONENTS.map((l) => rowTotal(fullTxt, l, fcfeAt));
    const printedFcfe = rowTotal(fullTxt, FCFE_BUILDUP_LABELS[FCFE_BUILDUP_LABELS.length - 1], fcfeAt);
    check('every printed FCFE build-up row decoded', parts.every((v) => v !== null) && printedFcfe !== null,
      COMPONENTS.map((l, i) => `${l}=${parts[i]}`).join(' | '));
    if (parts.every((v) => v !== null) && printedFcfe !== null) {
      const added = parts.reduce((s, v) => s + (v ?? 0), 0);
      // Eight addends printed to 1dp in millions.
      check('the printed rows add to the printed "= FCFE"', Math.abs(added - printedFcfe) < 0.5,
        `rows add to ${added.toFixed(1)}, printed ${printedFcfe.toFixed(1)}`);
    }
    // The old first row was a bare "FCFF" (the FCFF build-up's own total row is
    // "= FCFF"), so a bare FCFF line after this heading is that regression.
    check('the build-up does not start from FCFF, which already carries the terminal enterprise value',
      !fullTxt.split('\n').slice(fcfeAt).some((l) => l.trim() === 'FCFF'));
  }
}

async function main(): Promise<void> {
  console.log('=== Report arithmetic (the identities a reader would try) ===');

  // Fixture, fund ON. Stable baseline, always runs.
  const fx = buildExcelSampleState();
  fx.project.fundTerms = { ...FUND_TERMS };
  for (const ph of fx.phases) ph.dividendPolicy = { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.9, mode: 'cash_above_min' };
  await runFor('FIXTURE (fund enabled)', fx);

  // Real project, if reachable. Read-only, never written back.
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const { data, error } = await sb.from('refm_project_versions').select('snapshot,version_label')
        .eq('project_id', PID).order('created_at', { ascending: false }).limit(1);
      if (error) console.log(`\n(real project skipped: ${error.message})`);
      else if (data?.length) await runFor(`FMP RE HUB (saved version ${(data[0] as any).version_label})`, (data[0] as any).snapshot);
    } catch (e) { console.log(`\n(real project skipped: ${(e as Error).message})`); }
  } else {
    console.log('\n(real project skipped: no database credentials)');
  }

  // ── Toggle-off byte-identity, on the FIXTURE only ─────────────────────────
  console.log('\n=== Fund toggle OFF is byte-identical to fund terms ABSENT ===');
  const mk = async (mut: (s: any) => void): Promise<string> => {
    const s = buildExcelSampleState(); mut(s);
    const c = { state: s, projectName: 'Toggle', dateLabel: '12 August 2026', displayScale: 'millions' } as any;
    return decode(await generateProjectPdf({ ...c, selectedModuleKeys: MODULE_KEYS })) + '\n#####\n'
      + decode(await generateSummaryPdf({ ...c, selectedModuleKeys: [] }));
  };
  const absent = await mk(() => { /* no fund terms at all */ });
  const disabled = await mk((s) => { s.project.fundTerms = { ...FUND_TERMS, enabled: false }; });
  check('both PDFs are identical with fund terms absent vs populated-but-disabled', absent === disabled,
    `${absent.length} vs ${disabled.length} chars`);
  check('no fund content leaks when the toggle is off',
    !/Fund Layer|Distribution Waterfall|Fund structure fee|Total Fund Management Fee|hurdle/i.test(disabled));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('FAILURES:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
