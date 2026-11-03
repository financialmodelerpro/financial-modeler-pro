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
import { CHECK_REL_TOL, PHASE_EBITDA_CHECK_LABEL } from '../../reports/checksReport';
import { PHASE_RECON, PHASE_RECON_LINE } from '../../reports/m4Reports';
import { accT } from './excelText';
import { NUMFMT } from '../styles';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { LOOP_PBT_CHECK } from '../buildModelWorkbook';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';

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
    const finLabels = getFinancialLabels(ctx.opts.state.project.financialTerminology ?? defaultTerminologyForCountry(ctx.opts.state.project.country));
    const pbtLabel = finLabels.pbt;
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
      { label: 'Balance sheet balances (Assets = L + E)', a: 'bs|__all__||Balance check', b: null, mag: 'bs|__all__||TOTAL ASSETS' },
      { label: 'Cash flow closing == balance sheet cash', a: 'cf|direct||Closing cash', b: 'bs|__all__||Cash', mag: 'bs|__all__||Cash' },
      { label: 'Direct cash flow == Indirect cash flow', a: 'cf|direct||Cash Flow from Operations', b: 'cf|indirect||Cash Flow from Operations', mag: 'cf|direct||Cash Flow from Operations' },
      // The financing loop solves its tax on its own profit before tax: it must be the P&L's, every year.
      { label: LOOP_PBT_CHECK, a: 'fl:pbt', b: `pl|__all__||${pbtLabel}`, mag: `pl|__all__||${pbtLabel}` },
      // The phases foot to the project EBITDA (2026-10-25): the reconciliation under the phase P&Ls.
      { label: PHASE_EBITDA_CHECK_LABEL, a: `pl|${PHASE_RECON_LINE}||${PHASE_RECON.sum}`, b: `pl|__all__||${finLabels.ebitda}`, mag: `pl|__all__||${finLabels.ebitda}` },
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
      // The detail: the verdict and the peak (never the float residue), the worst year where it fails.
      // The loop's own check states its rule in words with no figure; every other states its verdict live.
      if (id.label !== LOOP_PBT_CHECK) {
        const det = { sheet: CHK, row: res.row, col: res.col + 1 };
        const was = String(w.platformValue(det) ?? '');
        const tail = was.includes('. ') && !/^every year: nothing/.test(was) ? was.slice(was.indexOf('. ') + 1) : (/^every year: nothing to reconcile\./.test(was) ? was.slice('every year: nothing to reconcile.'.length) : '');
        const W = tail ? `&".${tail.replace(/"/g, '""')}"` : '';
        const absDiff = `INDEX(ABS(${diff}),0)`;
        const a0 = w.addr(id.a);
        const years = w.rangeA(a0.sheet, 3, pc(0), pc(N - 1));
        const st = w.refA({ sheet: CHK, row: res.row, col: res.col - 1 });
        // One line (2026-10-20): the verdict, and where it fails the residue; the worst year beside it.
        void W;
        w.fA(det, `IF(${peak}=0,"Nothing to reconcile",IF(${st}="OK","Within tolerance","Out by "&${accT(`ABS(${w.refA(res)})`, 'millions', 1)}))`);
        w.fA({ sheet: CHK, row: res.row, col: res.col + 2 }, `IF(OR(${peak}=0,${st}="OK"),"",INDEX(${years},MATCH(MAX(${absDiff}),${absDiff},0)))`, { numFmt: '0' });
      }
      liveIds.push(id.label);
    }

    // ── The headline returns: links to the one IRR and MOIC per stream on Returns (2026-11-03) ──
    const D0 = PERIOD_COLS.TOTAL_COL;
    const live = (key: string, col: number): boolean => has(`${key}|${col}`) && isFormula(RET, w.addr(`${key}|${col}`).row, col);
    const pair = (label: string, src: string): boolean => {
      const key = `chk|ret|${label}`;
      if (!has(key)) return true;
      if (!live(src, D0) || !live(src, D0 + 1)) return false;
      const a = w.addr(key);
      w.reset(); w.fA(a, w.refA(w.addr(`${src}|${D0}`), CHK), { numFmt: NUMFMT.pct2 });
      w.reset(); w.fA({ sheet: CHK, row: a.row, col: a.col + 1 }, w.refA(w.addr(`${src}|${D0 + 1}`), CHK), { numFmt: NUMFMT.mult });
      return true;
    };
    const retOk: boolean[] = [];
    retOk.push(pair('Project IRR (FCFF)', 'ret|h|fcff'));
    retOk.push(pair('Equity IRR (FCFE)', 'ret|h|fcfe'));
    retOk.push(pair('Distributed Equity IRR', 'ret|h|ddm'));
    retOk.push(pair('Distributed Equity IRR (gross)', 'ret|h|ddm'));
    // Net of the performance fee where one is charged, the gross stream where none is (distributedReturnPair).
    {
      const key = 'chk|ret|Distributed Equity IRR (net of performance fee)';
      if (has(key)) {
        const ok = live('ret|h|net', D0) && live('ret|h|ddm', D0) && has('rs|wf:fee');
        retOk.push(ok);
        if (ok) {
          const fee = `SUM(${w.rangeA(RET, w.addr('rs|wf:fee').row, OPEN_COL, OPEN_COL + N)})`;
          const a = w.addr(key);
          const pick = (col: number): string => `IF(${fee}>0,${w.refA(w.addr(`ret|h|net|${col}`), CHK)},${w.refA(w.addr(`ret|h|ddm|${col}`), CHK)})`;
          w.reset(); w.fA(a, pick(D0), { numFmt: NUMFMT.pct2 });
          w.reset(); w.fA({ sheet: CHK, row: a.row, col: a.col + 1 }, pick(D0 + 1), { numFmt: NUMFMT.mult });
        }
      }
    }
    const returnsLive = retOk.every(Boolean);

    // ── The performance fee no earner takes, from Returns' split by the shares on Inputs ──
    if (has('chk|note|perf') && has('ret|fe|un|5') && has('rs|fee:perf')) {
      const a = w.addr('chk|note|perf');
      const un = w.refA(w.addr('ret|fe|un|5'), CHK);
      const tot = `SUM(${w.rangeA(RET, w.addr('rs|fee:perf').row, OPEN_COL + 1, OPEN_COL + N)})`;
      w.reset(); w.fA(a, un);
      w.reset(); w.fA({ sheet: CHK, row: a.row, col: a.col + 1 }, `TEXT(IF(${tot}>0,${un}/${tot},0),"0.0%")&" of the performance fee goes to no earner"`);
    }

    if (!liveIds.length && !returnsLive) {
      return [{ sheet: CHK, status: 'values' as const, formulas: 0, note: 'The Checks sheet stays the platform\'s values: the statements it reconciles are not live for this model.' }];
    }
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
      note: `${parts.join(', and ')}. Each Detail sentence states the verdict and the peak live (the worst year where an identity fails), and the performance fee note follows the live fee and the earners' shares.${stays.length ? ` Also the platform's values: ${stays.join('; ')}.` : ''}`,
    }];
  },
};
