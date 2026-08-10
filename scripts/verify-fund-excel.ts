/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-excel.ts (fund layer Step 6: the fund rows in the Excel export)
 *
 * Step 6 is a PRESENTATION step, so the checks are about three things and
 * nothing else:
 *
 *   1. TOGGLE OFF SHOWS NOTHING. Not "the fund section is hidden", but that no
 *      fund label exists anywhere in the workbook, on any of the 17 sheets. The
 *      byte-identity of the fund-off workbook against the pre-Step-6 build was
 *      measured separately (8,615 cell entries, value + fill + number format,
 *      identical); this file pins the part that can be re-run forever.
 *
 *   2. EVERY FIGURE TIES TO THE ENGINE. A presentation layer's failure mode is
 *      a number that looks right and came from somewhere else, so each row is
 *      compared against the snapshot field it claims to render, per period and
 *      in total, not just as a lifetime sum.
 *
 *   3. THE ROWS ARE IN THE REFERENCE ORDER, with the reference labels, and the
 *      three BALANCE rows carry no lifetime total. A balance summed across
 *      periods is a number with no meaning, and it is exactly the kind of thing
 *      a row-copying pass adds back without noticing.
 *
 * Plus two behavioural checks that a dead or hardcoded implementation cannot
 * pass: changing the performance fee must MOVE the waterfall and the net
 * returns, and changing the distribution matrix must move the earner split
 * while leaving the waterfall untouched.
 *
 * Run: npx tsx scripts/verify-fund-excel.ts
 *
 * No em dashes in this file.
 */
import ExcelJS from 'exceljs';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildExcelSampleState } from './excelSampleState';
import { ALLOWED_FILLS } from '../src/hubs/modeling/platforms/refm/lib/excel/styles';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const near = (a: number, b: number, tol = 0.5): boolean => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-9);
const sum = (a: readonly number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

// ── Fixture ─────────────────────────────────────────────────────────────────
const TERMS = {
  enabled: true,
  fundSize: 500_000_000,
  facilityLimit: 300_000_000,
  fundStructureFeePct: 0.01,
  fundManagementFeePct: 0.02,
  custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.0075,
  otherExpensesPerAnnum: 1_500_000,
  performanceFeePct: 0.2,
  hurdleRatePct: 0.08,
  fundManagerName: 'Riverside Fund Managers',
  feeDistribution: [],
};

/** The shared Excel fixture, with the fund layer on and dividends flowing so
 *  the waterfall has real distributions to split. */
function fundState(o: { hurdle?: number; perfFee?: number; matrix?: any[]; off?: boolean } = {}): any {
  const s = buildExcelSampleState();
  if (!o.off) {
    s.project.fundTerms = {
      ...TERMS,
      hurdleRatePct: o.hurdle ?? TERMS.hurdleRatePct,
      performanceFeePct: o.perfFee ?? TERMS.performanceFeePct,
      feeDistribution: o.matrix ?? [],
    };
  }
  for (const ph of s.phases) {
    ph.dividendPolicy = { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.9, mode: 'cash_above_min' };
  }
  return s;
}

const build = (state: any): ExcelJS.Workbook =>
  buildModelWorkbook({ state, projectName: 'Riverside Mixed-Use', dateLabel: '10 August 2026' });

// ── Sheet readers (shared period geometry: A label, D total, E opening, F..) ──
const LBL = 1, META_B = 2, META_C = 3, TOTAL = 4, OPEN = 5;
const pcol = (t: number): number => OPEN + 1 + t;
const labelOf = (ws: ExcelJS.Worksheet, R: number): string => {
  const a = ws.getCell(R, LBL).value;
  return typeof a === 'string' ? a : (a && typeof a === 'object' && 'text' in (a as any) ? (a as any).text : '');
};
const allLabels = (ws: ExcelJS.Worksheet): Array<{ row: number; label: string }> => {
  const out: Array<{ row: number; label: string }> = [];
  ws.eachRow((_r, R) => { const l = labelOf(ws, R); if (l) out.push({ row: R, label: l }); });
  return out;
};
const rowOf = (ws: ExcelJS.Worksheet, label: string): number => {
  const hit = allLabels(ws).find((x) => x.label === label);
  return hit ? hit.row : -1;
};
const numAt = (ws: ExcelJS.Worksheet, R: number, C: number): number => {
  const v: any = ws.getCell(R, C).value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof v.result === 'number') return v.result;
  return NaN;
};
const totalAt = (ws: ExcelJS.Worksheet, label: string): number => { const R = rowOf(ws, label); return R > 0 ? numAt(ws, R, TOTAL) : NaN; };
const isBlank = (ws: ExcelJS.Worksheet, R: number, C: number): boolean => {
  const v = ws.getCell(R, C).value;
  return v === null || v === undefined || v === '';
};
/** The per-period series of a row, on the STREAM basis (opening column first). */
const streamAt = (ws: ExcelJS.Worksheet, label: string, N: number): number[] => {
  const R = rowOf(ws, label);
  if (R < 0) return [];
  const out = [numAt(ws, R, OPEN)];
  for (let t = 0; t < N; t++) out.push(numAt(ws, R, pcol(t)));
  return out;
};

async function main(): Promise<void> {
  console.log('=== Fund layer Step 6: Excel export rows ===\n');

  const stateOn = fundState();
  const snapOn = computeFinancialsSnapshot(stateOn);
  const rsOn = computeReturnsSnapshot(snapOn, stateOn.project);
  const N = snapOn.axisLength;
  const wbOn = build(stateOn);
  const wbOff = build(fundState({ off: true }));

  // ── 1. Toggle off: no fund row exists anywhere in the workbook ─────────────
  console.log('\n-- 1. Toggle OFF shows nothing, on any sheet --');
  // Deliberately narrow: "funding" (the funding method, funding mix, funding
  // gap) is a different word and predates the fund layer by two years.
  // Widened 2026-08-10: the earlier alternation required "fund " to be followed
  // by one of a fixed list, so "Fund Management and Other Expenses" (the cash
  // flow row) slipped through it. An explicit check below covered that row, so
  // nothing was mis-verified, but the blanket sweep had a hole. Now anything
  // starting with "fund" counts, minus the two pre-fund-layer words that
  // legitimately begin that way.
  const FUND_LABEL = /\bfund\b|hurdle|performance fee|fee earner|distribution waterfall|custody and admin|debt arranging|net of performance/i;
  const NOT_FUND = /^(funding|funded)/i;
  let strayRows = 0; const strays: string[] = [];
  for (const ws of wbOff.worksheets) {
    for (const { row, label } of allLabels(ws)) {
      const words = label.split(/[^A-Za-z]+/).filter(Boolean);
      const fundish = FUND_LABEL.test(label) && !words.every((wd) => NOT_FUND.test(wd) || !/fund/i.test(wd));
      if (fundish) { strayRows++; strays.push(`${ws.name}!${row} ${label}`); }
    }
  }
  check('fund OFF: no fund label on any of the 17 sheets', strayRows === 0, strays.slice(0, 4).join(' | '));
  check('fund OFF: P&L has no Total Fund Management Fee row', rowOf(wbOff.getWorksheet('P&L')!, 'Total Fund Management Fee') < 0);
  check('fund OFF: P&L has no Fund Fee Basis block', rowOf(wbOff.getWorksheet('P&L')!, 'Fund Fee Basis') < 0);
  check('fund OFF: Cash Flow has no Fund Management and Other Expenses row', rowOf(wbOff.getWorksheet('Cash Flow')!, 'Fund Management and Other Expenses') < 0);
  check('fund OFF: Returns has no Fund Layer section',
    !allLabels(wbOff.getWorksheet('Returns')!).some((x) => /^3\. Fund Layer/.test(x.label)));
  check('fund OFF: the Returns sub-TOC does not advertise a Fund Layer section',
    !allLabels(wbOff.getWorksheet('Returns')!).some((x) => /^Covers:/.test(x.label) && /Fund Layer/.test(x.label)));
  // EBITDA still lands immediately after Total Operating Expenses, which is the
  // single most load-bearing consequence of the fee block being absent.
  const plOff = wbOff.getWorksheet('P&L')!;
  check('fund OFF: EBITDA still sits immediately after Total Operating Expenses',
    rowOf(plOff, 'EBITDA') === rowOf(plOff, 'Total Operating Expenses') + 1);

  // ── 2. P&L: the fee lines, the total, and EBITDA struck after it ──────────
  console.log('\n-- 2. P&L: fee lines with basis, Total Fund Management Fee, EBITDA after --');
  const pl = wbOn.getWorksheet('P&L')!;
  const feeLines = snapOn.fundFees.lines;
  check('P&L carries one row per fund fee, in the registry order', (() => {
    const rows = allLabels(pl).filter((x) => feeLines.some((l) => x.label.startsWith(l.label)) && !/basis charged on|fee charged/.test(x.label));
    if (rows.length !== feeLines.length) return false;
    return rows.every((x, i) => x.label.startsWith(feeLines[i].label)) && rows.every((x, i) => i === 0 || x.row > rows[i - 1].row);
  })(), `expected ${feeLines.length}`);
  check('P&L fee labels state the RATE and the BASE inline', (() => {
    const rows = allLabels(pl).filter((x) => feeLines.some((l) => x.label === `${l.label} (flat amount)` || x.label.startsWith(`${l.label} (`)) && !/charged/.test(x.label));
    return rows.length === feeLines.length && rows.every((x) => /\(\d+\.\d\d% of .+\)$/.test(x.label) || /\(flat amount\)$/.test(x.label));
  })());
  // The Excel P&L passes fmt = String so a totalOverride round-trips to a
  // number, which used to leak a raw float into these labels. labelFmt fixes it.
  check('P&L fee labels carry no raw float (labelFmt, not the machine fmt)',
    !allLabels(pl).some((x) => /\d\.\d{3,}/.test(x.label)),
    allLabels(pl).filter((x) => /\d\.\d{3,}/.test(x.label)).map((x) => x.label)[0] ?? '');
  const rTot = rowOf(pl, 'Total Fund Management Fee'), rEbitda = rowOf(pl, 'EBITDA');
  check('P&L: Total Fund Management Fee is present', rTot > 0);
  check('P&L: EBITDA is struck IMMEDIATELY after Total Fund Management Fee', rEbitda === rTot + 1, `total=${rTot} ebitda=${rEbitda}`);
  check('P&L: only ONE EBITDA row in the consolidated statement',
    allLabels(pl).filter((x) => x.label === 'EBITDA' && x.row < rowOf(pl, 'Income Statement (P&L): Phase 1 (to EBITDA)')).length === 1);
  check('P&L: Total Fund Management Fee ties to snapshot.fundFees (negated)',
    near(numAt(pl, rTot, TOTAL), -sum(snapOn.fundFees.totalPerPeriod)),
    `wb=${numAt(pl, rTot, TOTAL)} snap=${-sum(snapOn.fundFees.totalPerPeriod)}`);
  check('P&L: EBITDA ties to snapshot.pl.ebitdaPerPeriod (already net of fees)',
    near(numAt(pl, rEbitda, TOTAL), sum(snapOn.pl.ebitdaPerPeriod.slice(0, N))));
  check('P&L: EBITDA equals pre-fee EBITDA less the fund fee, per period', (() => {
    for (let t = 0; t < N; t++) {
      const before = snapOn.pl.ebitdaBeforeFundFeesPerPeriod?.[t] ?? 0;
      if (!near(numAt(pl, rEbitda, pcol(t)), before - (snapOn.fundFees.totalPerPeriod[t] ?? 0))) return false;
    }
    return true;
  })());
  check('P&L: each fee row ties to its own schedule line, per period', (() => {
    for (const line of feeLines) {
      const hit = allLabels(pl).find((x) => x.label.startsWith(line.label) && !/charged/.test(x.label));
      if (!hit) return false;
      for (let t = 0; t < N; t++) if (!near(numAt(pl, hit.row, pcol(t)), -(line.amountPerPeriod[t] ?? 0))) return false;
    }
    return true;
  })());
  // The Step 5b basis block: base in column B, rate in column C, so the period
  // axis at column F does not shift.
  const rBasis = rowOf(pl, 'Fund Fee Basis');
  check('P&L: the Fund Fee Basis block is present', rBasis > 0);
  check('P&L: the basis block states a Base and a Rate for every fee', (() => {
    for (const line of feeLines) {
      const R = rowOf(pl, `${line.label}: basis charged on`);
      if (R < 0) return false;
      if (!String(pl.getCell(R, META_B).value ?? '').trim()) return false;
      if (!String(pl.getCell(R, META_C).value ?? '').trim()) return false;
      if (!near(numAt(pl, R, TOTAL), sum(line.basisPerPeriod))) return false;
    }
    return true;
  })());
  check('P&L: the period axis still starts at column F', String(pl.getCell(4, pcol(0)).value ?? '') !== '' && pcol(0) === 6);

  // ── 3. Cash Flow: the fee inside operating activities ─────────────────────
  console.log('\n-- 3. Cash Flow: Fund Management and Other Expenses --');
  const cf = wbOn.getWorksheet('Cash Flow')!;
  const rFeeCF = rowOf(cf, 'Fund Management and Other Expenses');
  const rCFO = rowOf(cf, 'Cash Flow from Operations');
  check('Cash Flow: the fee row is present', rFeeCF > 0);
  check('Cash Flow: it sits INSIDE operating activities, above Cash Flow from Operations', rFeeCF > 0 && rFeeCF < rCFO);
  check('Cash Flow: the fee row ties to directCF.fundFeesPaidPerPeriod, per period', (() => {
    const paid = (snapOn.directCF as any).fundFeesPaidPerPeriod ?? [];
    for (let t = 0; t < N; t++) if (!near(numAt(cf, rFeeCF, pcol(t)), paid[t] ?? 0)) return false;
    return true;
  })());
  check('Cash Flow: it carries the P&L fee line negated (same money, two statements)',
    near(numAt(cf, rFeeCF, TOTAL), numAt(pl, rTot, TOTAL)));
  // The fee is a cash expense already inside PAT, so the Indirect method needs
  // no add-back. Its absence there is the check, not an oversight.
  check('Cash Flow: the Indirect section carries NO fund fee add-back', (() => {
    const rInd = rowOf(cf, 'Cash Flow, Indirect Method: Project');
    const rPhase = allLabels(cf).find((x) => /^Cash Flow: .+ \(Operations \+ Investing\)$/.test(x.label))?.row ?? Number.MAX_SAFE_INTEGER;
    return !allLabels(cf).some((x) => x.row > rInd && x.row < rPhase && /fund/i.test(x.label));
  })());

  // ── 4. Returns: the waterfall, in the reference row order ─────────────────
  console.log('\n-- 4. Returns: the distribution waterfall --');
  const ret = wbOn.getWorksheet('Returns')!;
  const w = rsOn.waterfall;
  check('Returns: the Fund Layer section exists', allLabels(ret).some((x) => /^3\. Fund Layer/.test(x.label)));
  check('Returns: the section is registered for the Cover ToC and the sub-TOC',
    allLabels(ret).some((x) => /^Covers:/.test(x.label) && /Fund Layer/.test(x.label)));
  const REFERENCE_ORDER = [
    'Equity Drawn',
    'Unpaid Hurdle Balance BoP',
    'Hurdle Accrued',
    'Total Hurdle Owed',
    'Hurdle Paid',
    'Unpaid Hurdle Balance EoP',
    'Excess Distributions',
    'Performance Fee',
    'Distributions Net of Performance Fee',
    'Memo: Distributions (gross, before fee)',
  ];
  const wfRows = REFERENCE_ORDER.map((l) => rowOf(ret, l));
  check('Returns: all ten waterfall rows are present', wfRows.every((R) => R > 0), REFERENCE_ORDER.filter((_l, i) => wfRows[i] < 0).join(', '));
  check('Returns: they appear in the REFERENCE order, contiguously',
    wfRows.every((R, i) => i === 0 || R === wfRows[i - 1] + 1), wfRows.join(','));
  // Balances do not sum. Three rows must carry no lifetime total.
  const BALANCES = ['Unpaid Hurdle Balance BoP', 'Total Hurdle Owed', 'Unpaid Hurdle Balance EoP'];
  check('Returns: the three BALANCE rows carry no lifetime total',
    BALANCES.every((l) => isBlank(ret, rowOf(ret, l), TOTAL)),
    BALANCES.filter((l) => !isBlank(ret, rowOf(ret, l), TOTAL)).join(', '));
  check('Returns: the FLOW rows do carry a lifetime total',
    REFERENCE_ORDER.filter((l) => !BALANCES.includes(l)).every((l) => Number.isFinite(totalAt(ret, l))));
  // Every row against the engine, per period and in total.
  const tie = (label: string, series: number[], total?: number): void => {
    const got = streamAt(ret, label, N);
    let ok = got.length === series.length || got.length >= series.length;
    for (let i = 0; i < series.length && ok; i++) ok = near(got[i] ?? 0, series[i] ?? 0);
    if (ok && total !== undefined) ok = near(totalAt(ret, label), total);
    check(`Returns: "${label}" ties to the engine, per period${total !== undefined ? ' and in total' : ''}`, ok);
  };
  tie('Equity Drawn', w.equityDrawnPerPeriod, w.totalEquityDrawn);
  tie('Unpaid Hurdle Balance BoP', w.periods.map((p) => p.openingUnpaidHurdle));
  tie('Hurdle Accrued', w.hurdleAccruedPerPeriod, w.totalHurdleAccrued);
  tie('Total Hurdle Owed', w.totalHurdleOwedPerPeriod);
  tie('Hurdle Paid', w.hurdlePaidPerPeriod, w.totalHurdlePaid);
  tie('Unpaid Hurdle Balance EoP', w.unpaidHurdlePerPeriod);
  tie('Excess Distributions', w.excessDistributionsPerPeriod, w.totalExcessDistributions);
  tie('Performance Fee', w.performanceFeePerPeriod, w.totalPerformanceFee);
  tie('Distributions Net of Performance Fee', w.netDistributionPerPeriod, w.totalNetDistributions);
  tie('Memo: Distributions (gross, before fee)', w.distributionPerPeriod, w.totalDistributions);
  // The terms the waterfall was run on, so the rows above can be checked by eye.
  check('Returns: the hurdle rate applied is stated', near(totalAt(ret, 'Hurdle rate (preferred return)'), w.hurdleRate, 1e-12));
  check('Returns: the performance fee percentage applied is stated', near(totalAt(ret, 'Performance fee on the excess'), w.performanceFeePct, 1e-12));
  check('Returns: the Fund Manager is named', String(ret.getCell(rowOf(ret, 'Fund Manager'), TOTAL).value ?? '') === TERMS.fundManagerName);

  // ── 5. Returns: gross vs post-fee IRR and MOIC ────────────────────────────
  console.log('\n-- 5. Returns: gross vs post-fee IRR and MOIC --');
  check('Returns: the gross vs net comparison is present',
    rowOf(ret, 'Excluding fund fees (gross)') > 0 && rowOf(ret, 'Net of performance fee') > 0);
  check('Returns: the net row sits directly under the gross row',
    rowOf(ret, 'Net of performance fee') === rowOf(ret, 'Excluding fund fees (gross)') + 1);
  const gridCell = (label: string, i: number): string => String(ret.getCell(rowOf(ret, label), OPEN + i).value ?? '');
  const pctStr = (v: number | null): string => (v != null && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/a');
  const multStr = (v: number | null): string => (v != null && Number.isFinite(v) ? `${v.toFixed(2)}x` : 'n/a');
  check('Returns: the gross row renders result.dividends (the unchanged headline)',
    gridCell('Excluding fund fees (gross)', 0) === pctStr(rsOn.result.dividends.irr) &&
    gridCell('Excluding fund fees (gross)', 1) === multStr(rsOn.result.dividends.moic));
  check('Returns: the net row renders resultNetDividends (after the fee)',
    gridCell('Net of performance fee', 0) === pctStr(rsOn.resultNetDividends.irr) &&
    gridCell('Net of performance fee', 1) === multStr(rsOn.resultNetDividends.moic));
  check('Returns: the gross vs net KPI tiles are present', (() => {
    const kpis = allLabels(ret).map((x) => x.label);
    return ['Fund Returns, Gross vs Net'].every((l) => kpis.includes(l));
  })());

  // ── 6. Returns: the Fund Fee Income section ───────────────────────────────
  console.log('\n-- 6. Returns: Fund Fee Income for the Fund Manager --');
  const fe = rsOn.feeEarners;
  check('Returns: the fee income section is present', rowOf(ret, 'Fund Fee Income by Earner') > 0);
  check('Returns: the Fund Manager appears as an earner', rowOf(ret, TERMS.fundManagerName) > 0);
  check('Returns: fee earners sit BESIDE the equity partners, not inside them', (() => {
    const rPartners = rowOf(ret, 'Equity Partners');
    const rEarners = rowOf(ret, 'Fund Fee Income by Earner');
    // The Fund Manager must not appear in the partner grid.
    if (rPartners < 0) return rEarners > 0;
    const partnerNames = rsOn.partners.partners.map((p: any) => p.name);
    return rEarners > rPartners && !partnerNames.includes(TERMS.fundManagerName);
  })());
  const FEE_INCOME_ROWS = [...feeLines.map((l) => l.label), '= Total Management Fees', 'Performance Fee', '= Total Fee Income'];
  check('Returns: the per-period fee income block lists every fee then the two totals', (() => {
    const rStart = rowOf(ret, 'Fee Income by Period');
    if (rStart < 0) return false;
    const after = allLabels(ret).filter((x) => x.row > rStart).slice(0, FEE_INCOME_ROWS.length).map((x) => x.label);
    return after.join('|') === FEE_INCOME_ROWS.join('|');
  })());
  check('Returns: Total Management Fees ties to the fee earners snapshot',
    near(totalAt(ret, '= Total Management Fees'), fe.totalManagementFee));
  check('Returns: Total Fee Income ties to the fee earners snapshot',
    near(totalAt(ret, '= Total Fee Income'), fe.totalFeeIncome));
  check('Returns: the management fees earned equal the fees CHARGED in the P&L',
    near(fe.totalManagementFee, sum(snapOn.fundFees.totalPerPeriod)) &&
    near(totalAt(ret, '= Total Management Fees'), -numAt(pl, rTot, TOTAL)));
  check('Returns: the fee income basis block repeats the shared builder', (() => {
    const R = rowOf(ret, 'Fund Fee Basis (what each fee is charged on)');
    if (R < 0) return false;
    return String(ret.getCell(R, META_B).value) === 'Base' && String(ret.getCell(R, META_C).value) === 'Rate';
  })());

  // ── 7. Palette, geometry and the hardcoded-snapshot contract ──────────────
  console.log('\n-- 7. Palette, geometry, hardcoded contract --');
  const badFills: string[] = [];
  for (const ws of wbOn.worksheets) {
    ws.eachRow((row, R) => row.eachCell((c, C) => {
      const f: any = c.fill;
      const argb = f && f.type === 'pattern' && f.fgColor ? f.fgColor.argb : null;
      if (argb && !ALLOWED_FILLS.has(argb)) badFills.push(`${ws.name}!${R},${C}=${argb}`);
    }));
  }
  check('every fill in the fund-ON workbook is in the locked palette', badFills.length === 0, badFills.slice(0, 3).join(' | '));
  let formulaCells = 0;
  for (const ws of wbOn.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (c.value && typeof c.value === 'object' && 'formula' in (c.value as any)) formulaCells++; }));
  check('the fund-ON workbook is still fully hardcoded (zero formula cells)', formulaCells === 0, `formulaCells=${formulaCells}`);
  check('Returns keeps its frozen 4-row header and A-D pane', (() => {
    const v: any = (ret.views ?? [])[0];
    return v && v.state === 'frozen' && v.ySplit === 4 && v.xSplit === 4;
  })());
  check('the fund block did not shift the Returns period axis', (() => {
    // Row 4 is the period index header; period 0 must still be column F.
    for (let t = 0; t < N; t++) if (!Number.isFinite(numAt(ret, 4, pcol(t)))) return false;
    return true;
  })());
  check('the workbook still has its 17 sheets in module order',
    wbOn.worksheets.map((s) => s.name).join('>') === ['Cover', 'Guide', 'Summary', 'Inputs', 'Timeline', 'Land & Area', 'Capex', 'Financing', 'Revenue', 'Opex', 'Schedules', 'P&L', 'Cash Flow', 'Balance Sheet', 'Returns', 'Scenarios', 'Checks'].join('>'));

  // ── 8. Behavioural: the rows MOVE with the terms ──────────────────────────
  // A hardcoded or dead presentation layer passes every check above. These two
  // do not pass unless the rows really are driven by the engine.
  console.log('\n-- 8. Behavioural: the rows follow the terms --');
  const stateNoFee = fundState({ hurdle: 0, perfFee: 0 });
  const stateFee = fundState({ hurdle: 0, perfFee: 0.3 });
  const retNoFee = build(stateNoFee).getWorksheet('Returns')!;
  const retFee = build(stateFee).getWorksheet('Returns')!;
  const rsFee = computeReturnsSnapshot(computeFinancialsSnapshot(stateFee), stateFee.project);
  check('a hurdle of zero lets the project clear it and earn a fee (fixture is exercised)',
    rsFee.waterfall.totalPerformanceFee > 0, `fee=${rsFee.waterfall.totalPerformanceFee}`);
  check('raising the performance fee MOVES the Performance Fee row',
    !near(totalAt(retFee, 'Performance Fee'), totalAt(retNoFee, 'Performance Fee')));
  check('raising the performance fee MOVES the net distributions row',
    totalAt(retFee, 'Distributions Net of Performance Fee') < totalAt(retNoFee, 'Distributions Net of Performance Fee'));
  check('raising the performance fee leaves the GROSS distributions memo unchanged',
    near(totalAt(retFee, 'Memo: Distributions (gross, before fee)'), totalAt(retNoFee, 'Memo: Distributions (gross, before fee)')));
  check('the net IRR falls below the gross IRR once a fee is charged', (() => {
    const g = String(retFee.getCell(rowOf(retFee, 'Excluding fund fees (gross)'), OPEN).value ?? '');
    const n = String(retFee.getCell(rowOf(retFee, 'Net of performance fee'), OPEN).value ?? '');
    return g !== n && parseFloat(n) < parseFloat(g);
  })());
  // The distribution matrix splits the fee; it must not touch the waterfall.
  const stateMatrix = fundState({ hurdle: 0, perfFee: 0.3, matrix: [{ partyId: '__fund_manager__', sharePct: 0.6 }] });
  const wbMatrix = build(stateMatrix);
  const retMatrix = wbMatrix.getWorksheet('Returns')!;
  check('changing the distribution matrix leaves the WATERFALL byte-identical',
    REFERENCE_ORDER.every((l) => {
      const a = streamAt(retFee, l, N), b = streamAt(retMatrix, l, N);
      return a.every((v, i) => near(v, b[i] ?? 0));
    }));
  check('an unallocated performance-fee remainder is SHOWN, never absorbed', (() => {
    const rsM = computeReturnsSnapshot(computeFinancialsSnapshot(stateMatrix), stateMatrix.project);
    if (!(rsM.feeEarners.unallocatedPerformanceFee > 0)) return false;
    return rowOf(retMatrix, 'Unallocated') > 0;
  })());

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
