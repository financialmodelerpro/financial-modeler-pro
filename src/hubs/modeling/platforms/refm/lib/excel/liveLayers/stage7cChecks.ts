/**
 * stage7cChecks.ts (2026-09-28)
 *
 * STAGE 7c: THE CHECKS SHEET, LIVE. The platform's integrity identities are
 * recomputed from the live statements of this workbook, by the rules of
 * lib/reports/checksReport.ts:
 *
 *   - each identity is the WORST SIGNED DIVERGENCE across the years between
 *     its two live rows (worstDivergence), judged against the PEAK of its own
 *     quantity on the relative tolerance (relativeCheckOk: the larger of 1e-6
 *     and CHECK_REL_TOL times the peak), so a status reads CHECK the moment an
 *     input breaks an identity in Excel;
 *   - the bridge check reads the live "Unexplained (must be 0)" row of the
 *     Balance Sheet, against peak total assets;
 *   - the headline returns are IRR and MOIC over the live stream rows of the
 *     Returns sheet, by the same rules the Returns cards use.
 *
 * A check whose rows are not live keeps the platform's values, and the sheet
 * says which. The Detail sentences quote the platform's residue in words and
 * stay as of export (a sentence cannot quote Excel's float residue honestly),
 * and so do the NOTE advisories and the legend.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { CHECK_REL_TOL } from '../../reports/checksReport';
import { irrOf } from './excelText';
import { NUMFMT } from '../styles';
import { computeFinancialsSnapshot } from '../../financials-resolvers';

const CHK = 'Checks';
const RET = 'Returns';

export const stage7cChecks: LiveLayer = {
  name: 'stage 7c: the checks',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const N = computeFinancialsSnapshot(ctx.opts.state).axisLength;
    const { OPEN_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const isFormula = (sheet: string, row: number, col: number): boolean => {
      const v = wb.getWorksheet(sheet)?.findRow(row)?.findCell(col)?.value as unknown;
      return !!v && typeof v === 'object' && 'formula' in (v as object);
    };
    /** A live period row: its range across the axis, or null where any year is still a value. */
    const liveRow = (key: string): string | null => {
      if (!has(key)) return null;
      const a = w.addr(key);
      for (let t = 0; t < N; t++) if (!isFormula(a.sheet, a.row, pc(t))) return null;
      return w.rangeA(a.sheet, a.row, pc(0), pc(N - 1));
    };

    // ── The identities ─────────────────────────────────────────────────────
    const ids: Array<{ label: string; a: string; b: string | null; mag: string }> = [
      { label: 'Balance sheet balances (Assets = L + E)', a: 'bs|__all__||TOTAL ASSETS', b: 'bs|__all__||TOTAL LIABILITIES + EQUITY', mag: 'bs|__all__||TOTAL ASSETS' },
      { label: 'Cash flow closing == balance sheet cash', a: 'cf|direct||Closing cash', b: 'bs|__all__||Cash', mag: 'bs|__all__||Cash' },
      { label: 'Direct cash flow == Indirect cash flow', a: 'cf|direct||Net Cash Flow', b: 'cf|indirect||Net Cash Flow', mag: 'cf|direct||Net Cash Flow' },
      { label: 'Balance sheet reconciliation bridge, unexplained', a: 'bsr|__all__||Unexplained (must be 0)', b: null, mag: 'bs|__all__||TOTAL ASSETS' },
    ];
    const tol = CHECK_REL_TOL.toExponential().toUpperCase().replace('E+', 'E');
    const liveIds: string[] = [], valueIds: string[] = [];
    for (const id of ids) {
      const key = `chk|id|${id.label}`;
      if (!has(key)) continue;
      w.reset();
      const A = liveRow(id.a), B = id.b ? liveRow(id.b) : '0', M = liveRow(id.mag);
      if (!A || !B || !M) { valueIds.push(id.label); w.reset(); continue; }
      // SUMPRODUCT evaluates its argument as an array in every Excel version, so no
      // array entry is needed for the per-year difference.
      const diff = id.b ? `(${A}-${B})` : A;
      const hi = `SUMPRODUCT(MAX(${diff}))`, lo = `SUMPRODUCT(MIN(${diff}))`;
      const res = w.addr(key);
      w.fA(res, `IF(ABS(${hi})>=ABS(${lo}),${hi},${lo})`);
      // The peak of the absolute value, with no array: ABS(range) inside SUMPRODUCT is
      // implicitly intersected, not evaluated per year (measured in Excel, 2026-09-28).
      const peak = `MAX(MAX(${M}),-MIN(${M}))`;
      w.fA({ sheet: CHK, row: res.row, col: res.col - 1 }, `IF(ABS(${w.refA(res)})<=MAX(0.000001,${peak}*${tol}),"OK","CHECK")`);
      liveIds.push(id.label);
    }

    // ── The headline returns ───────────────────────────────────────────────
    const FCFF = 'retr|FCFF Build-Up (unlevered, to all capital providers)|= FCFF (unlevered project)';
    const FCFE = 'retr|FCFE Build-Up (levered, free cash to equity)|= FCFE (levered equity)';
    const retKeys = reg.keys().filter((k) => k.startsWith('retr|'));
    const DDM = retKeys.find((k) => /^retr\|(Dividend Discount Model \(DDM\), before performance fee|Distributed Equity Build-Up \(Dividend Discount Model\))\|= Net Equity Cash Flow \(dividend basis\)$/.test(k));
    const NET = 'retr|Dividend Discount Model (DDM), after performance fee|= Net Cash Flow (after performance fee)';
    const FEE = retKeys.find((k) => /^retr\|Performance Fee \(hold to .*\|Performance Fee$/.test(k));
    /** A stream row on Returns, inception column included, or null where it is not live. */
    const stream = (key: string | undefined): string | null => {
      if (!key || !has(key)) return null;
      const a = w.addr(key);
      for (let s = 0; s <= N; s++) if (!isFormula(RET, a.row, OPEN_COL + s)) return null;
      return w.rangeA(RET, a.row, OPEN_COL, OPEN_COL + N);
    };
    const moic = (r: string): string => `IF(-SUMIF(${r},"<0")>0,SUMIF(${r},">0")/-SUMIF(${r},"<0"),"n/a")`;
    const pair = (label: string, rng: () => string | null): boolean => {
      const key = `chk|ret|${label}`;
      if (!has(key)) return true;
      w.reset();
      const r = rng();
      if (!r) { w.reset(); return false; }
      const a = w.addr(key);
      w.fA(a, `IFERROR(${irrOf(r)},"n/a")`, { numFmt: NUMFMT.pct2 });
      w.reset();
      const r2 = rng()!;
      w.fA({ sheet: CHK, row: a.row, col: a.col + 1 }, moic(r2), { numFmt: NUMFMT.mult });
      return true;
    };
    const retOk: boolean[] = [];
    retOk.push(pair('Project IRR (FCFF)', () => stream(FCFF)));
    retOk.push(pair('Equity IRR (FCFE)', () => stream(FCFE)));
    retOk.push(pair('Distributed Equity IRR', () => stream(DDM)));
    // Net of the performance fee where one is charged, the gross stream where none
    // is: the rule the Returns card itself follows (distributedReturnPair).
    retOk.push(pair('Distributed Equity IRR (net of performance fee)', () => {
      const net = stream(NET), gross = stream(DDM);
      if (!net || !gross || !FEE || !has(FEE)) return null;
      const f = w.addr(FEE);
      const feeTotal = `SUM(${w.rangeA(RET, f.row, OPEN_COL, OPEN_COL + N)})`;
      return `IF(${feeTotal}>0,${net},${gross})`;
    }));
    retOk.push(pair('Distributed Equity IRR (gross)', () => stream(DDM)));
    const returnsLive = retOk.every(Boolean);

    if (!liveIds.length && !returnsLive) {
      return [{ sheet: CHK, status: 'values' as const, formulas: 0, note: 'The Checks sheet stays the platform\'s values: the statements it reconciles are not live for this model.' }];
    }
    // The section headings said "as of export", which is now true only of the words beside the figures.
    const ws = wb.getWorksheet(CHK)!;
    ws.eachRow((row) => row.eachCell((cell) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      if (cell.value === 'Platform verification snapshot (results as of export)' && liveIds.length) cell.value = 'Verification (recomputed live from the statements in this workbook)';
      if (cell.value === 'Headline returns (platform snapshot)' && returnsLive) cell.value = 'Headline returns (live, over the Returns rows)';
    }));
    const parts = [
      liveIds.length ? `Live: ${liveIds.length === ids.length ? 'every identity' : liveIds.join(', ')} (the residue is the worst signed divergence across the years between the live rows it reconciles, and the status is judged against the peak of that quantity on the relative tolerance, so it reads CHECK the moment an edit breaks it)` : '',
      returnsLive ? 'the headline returns (IRR and MOIC over the live stream rows of the Returns sheet)' : '',
    ].filter(Boolean);
    const stays = [
      valueIds.length ? `${valueIds.join(', ')} (its rows are not live for this model)` : '',
      returnsLive ? '' : 'the headline returns',
    ].filter(Boolean);
    return [{
      sheet: CHK, status: 'partial' as const, formulas: w.formulas.get(CHK) ?? 0,
      note: `${parts.join(', and ')}. The Detail sentences quote the platform's residue in words and stay as of export, and so do the NOTE advisories on revenue basis and downpayments.${stays.length ? ` Also the platform's values: ${stays.join('; ')}.` : ''}`,
    }];
  },
};
