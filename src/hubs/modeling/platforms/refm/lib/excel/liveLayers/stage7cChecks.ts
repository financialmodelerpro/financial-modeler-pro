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
import { CHECK_REL_TOL, PHASE_EBITDA_CHECK_LABEL, buildEmptyInputAdvisories, isEmptyCheckEligible } from '../../reports/checksReport';
import { PHASE_RECON, PHASE_RECON_LINE } from '../../reports/m4Reports';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { LOOP_PBT_CHECK, SOURCES_USES_CHECK } from '../buildModelWorkbook';
import { resolveFundTerms } from '../../fundTerms';
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

    // ── The identities (2026-11-03): each that can fail; status, residue, scale and one short line ──
    // The cash tie went: the live Balance Sheet links the Cash Flow's closing cash, so it could not fail.
    const ids: Array<{ label: string; a: string; b: string | null; mag: string }> = [
      { label: 'Balance sheet balances (Assets = L + E)', a: 'bs|__all__||Balance check', b: null, mag: 'bs|__all__||TOTAL ASSETS' },
      { label: 'Direct cash flow == Indirect cash flow', a: 'cf|direct||Cash Flow from Operations', b: 'cf|indirect||Cash Flow from Operations', mag: 'cf|direct||Cash Flow from Operations' },
      // The financing loop solves its tax on its own profit before tax: it must be the P&L's, every year.
      { label: LOOP_PBT_CHECK, a: 'fl:pbt', b: `pl|__all__||${pbtLabel}`, mag: `pl|__all__||${pbtLabel}` },
      // The phases foot to the project EBITDA (2026-10-25): the reconciliation under the phase P&Ls.
      { label: PHASE_EBITDA_CHECK_LABEL, a: `pl|${PHASE_RECON_LINE}||${PHASE_RECON.sum}`, b: `pl|__all__||${finLabels.ebitda}`, mag: `pl|__all__||${finLabels.ebitda}` },
    ];
    const tol = CHECK_REL_TOL.toExponential().toUpperCase().replace('E+', 'E');
    const liveIds: string[] = [], valueIds: string[] = [];
    /** Status from the residue and the scale beside it; one line of detail. */
    const finish = (res: { sheet: string; row: number; col: number }): void => {
      const C = w.refA(res, CHK), Dc = w.refA({ ...res, col: res.col + 1 }, CHK), St = w.refA({ ...res, col: res.col - 1 }, CHK);
      w.reset(); w.fA({ ...res, col: res.col - 1 }, `IF(ABS(${C})<=MAX(0.000001,${Dc}*${tol}),"OK","CHECK")`);
      w.reset(); w.fA({ ...res, col: res.col + 2 }, `IF(${Dc}=0,"Nothing to reconcile",IF(${St}="OK","Within tolerance","Out by "&TEXT(ABS(${C})/1000000,"#,##0.0")&" m"))`);
    };
    for (const id of ids) {
      const key = `chk|id|${id.label}`;
      if (!has(key)) continue;
      w.reset();
      const A = liveRow(id.a), B = id.b ? liveRow(id.b) : '0', M = liveRow(id.mag);
      if (!A || !B || !M) { valueIds.push(id.label); w.reset(); continue; }
      // SUMPRODUCT evaluates its argument as an array in every Excel version: the worst signed year.
      const diff = id.b ? `(${A}-${B})` : A;
      const hi = `SUMPRODUCT(MAX(${diff}))`, lo = `SUMPRODUCT(MIN(${diff}))`;
      const res = w.addr(key);
      w.fA(res, `IF(ABS(${hi})>=ABS(${lo}),${hi},${lo})`);
      w.reset(); w.fA({ ...res, col: res.col + 1 }, `MAX(MAX(${M}),-MIN(${M}))`);
      finish(res);
      liveIds.push(id.label);
    }
    // Sources equal uses: Returns' two totals, each the sum of its own rows.
    {
      const key = `chk|id|${SOURCES_USES_CHECK}`;
      if (has(key) && has('ret|S&U check') && has('ret|Total Sources')) {
        const res = w.addr(key);
        w.reset(); w.fA(res, w.one('ret|S&U check'));
        w.reset(); w.fA({ ...res, col: res.col + 1 }, `ABS(${w.one('ret|Total Sources')})`);
        finish(res);
        liveIds.push(SOURCES_USES_CHECK);
      }
    }
    // An input left at zero: the residue counts the lines still at zero, so the note reads OK only
    // once every line has a rate (buildEmptyInputAdvisories: a NOTE while any line leaves it at zero).
    for (const a of buildEmptyInputAdvisories(ctx.opts.state)) {
      const key = `chk|zero|${a.item}`;
      if (!has(key)) continue;
      const cells: string[] = [];
      for (const as of ctx.opts.state.assets) {
        if (as.visible === false || (as.strategy !== 'Operate' && as.strategy !== 'Lease')) continue;
        (as.opex?.lines ?? []).forEach((ln, i) => { if (ln.name === a.item && isEmptyCheckEligible(ln) && has(`oxv|${as.id}|${i}`)) cells.push(w.ref(`oxv|${as.id}|${i}`, 5)); });
      }
      (ctx.opts.state.project.hqOpex?.lines ?? []).forEach((ln, i) => { if (ln.name === a.item && isEmptyCheckEligible(ln) && has(`oxv|hq|${i}`)) cells.push(w.ref(`oxv|hq|${i}`, 4)); });
      if (!cells.length) continue;
      const res = w.addr(key);
      w.reset(); w.fA(res, cells.map((c) => `IF(${c}<=0,1,0)`).join('+'));
      const C = w.refA(res, CHK);
      w.reset(); w.fA({ ...res, col: res.col - 1 }, `IF(${C}>0,"NOTE","OK")`);
      w.reset(); w.fA({ ...res, col: res.col + 2 }, `IF(${C}>0,"Left at zero; the model charges nothing for it","A rate is typed")`);
    }
    // Performance fee shares total no more than 100%: the shares typed on Inputs, over 100%.
    if (has('chk|perfshares')) {
      const rowsFd = resolveFundTerms(ctx.opts.state.project).feeDistribution;
      const shares = rowsFd.map((_r, i) => `ftm:${i}:perf`).filter(has).map((k) => w.ref(k));
      if (shares.length === rowsFd.length) {
        const res = w.addr('chk|perfshares');
        w.reset(); w.fA(res, `MAX(0,SUM(${shares.join(',')})-1)`);
        const C = w.refA(res, CHK);
        w.reset(); w.fA({ ...res, col: res.col - 1 }, `IF(${C}>0.000001,"CHECK","OK")`);
        w.reset(); w.fA({ ...res, col: res.col + 2 }, `IF(${C}>0.000001,"Shares total "&TEXT(1+${C},"0.0%")&"; lower a share on Inputs","Within 100%")`);
        liveIds.push('perf shares');
      }
    }
    const returnsLive = true;

    // ── The performance fee no earner takes, from Returns' split by the shares on Inputs ──
    if (has('chk|note|perf') && has('ret|fe|un|5') && has('rs|fee:perf')) {
      const a = w.addr('chk|note|perf');
      const un = w.refA(w.addr('ret|fe|un|5'), CHK);
      const tot = `SUM(${w.rangeA(RET, w.addr('rs|fee:perf').row, OPEN_COL + 1, OPEN_COL + N)})`;
      w.reset(); w.fA(a, un);
      w.reset(); w.fA({ sheet: CHK, row: a.row, col: a.col + 2 }, `TEXT(IF(${tot}>0,${un}/${tot},0),"0.0%")&" of the performance fee goes to no earner"`);
    }

    void returnsLive;
    if (!liveIds.length) {
      return [{ sheet: CHK, status: 'values' as const, formulas: 0, note: 'The Checks sheet stays the platform\'s values: the statements it reconciles are not live for this model.' }];
    }
    return [{
      sheet: CHK, status: valueIds.length ? 'partial' as const : 'live' as const, formulas: w.formulas.get(CHK) ?? 0,
      note: `Live: every check reconciles rows of this workbook (the residue is the worst year's difference, the scale the peak of what it reconciles, and the status reads CHECK once the residue passes the relative tolerance of the scale); the notes read their inputs.${valueIds.length ? ` The platform's values: ${valueIds.join(', ')} (its rows are not live for this model).` : ''}`,
    }];
  },
};
