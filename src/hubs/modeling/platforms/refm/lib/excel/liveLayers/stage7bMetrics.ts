/**
 * stage7bMetrics.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 7b: RE METRICS.
 *
 * The Returns sheet's second sub-tab, over the streams stage 7a built and the
 * statements, by the same rules the screen reads (`lib/covenants.ts`,
 * `returns/metrics.ts`, `returns/analytics.ts`, `exitYearAnalysis`,
 * `buildOperatingKpis`):
 *   - the covenant series per year (DSCR on SCHEDULED debt service in operating
 *     years, interest cover, debt yield, LTV at peak debt over GDV), their worst,
 *     average and pass or breach against the shaded thresholds;
 *   - the exit-year analysis: each candidate exit's FCFF and FCFE rebuilt from
 *     the same rows with that year's terminal value (the platform does not re-run
 *     the model for it either), solved by Excel's IRR;
 *   - every card: equity multiple, yield on cost (held NOI over the held assets'
 *     cost), profit margin, coverage, cash on cash, development economics, the
 *     income and exit profile, the funding mix and the operating KPIs.
 * One card stays the platform's value: the residential average price per sqm,
 * whose area is a stored asset field the workbook does not carry.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { irrOf, pctT, irrT, multT, moicOf, moneyT as moneyWords, ratioT, seriesT } from './excelText';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { computeReturnsSnapshot, resolveReturnsConfig } from '../../returns-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { METRIC_CAPTIONS } from '../../reports/metricCaptions';
import { DEFAULT_COVENANTS, type Phase } from '../../state/module1-types';

const RET = 'Returns';
const CALC = 'Returns Calc';

export const stage7bMetrics: LiveLayer = {
  name: 'stage 7b: RE metrics',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const cs = wb.getWorksheet(CALC);
    if (!cs || !has('rtc:noi')) return []; // stage 7a did not make the returns live: nothing to build on
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const project = state.project;
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const rs = computeReturnsSnapshot(snap, project);
    const cfg = resolveReturnsConfig(project, N);
    const X = cfg.exitYearOffset;
    const M = cfg.terminalValueBasis === 'exit_year' ? X : Math.max(0, X - 1);
    const cur = project.currency || 'SAR';
    const moneyT = moneyWords(cur);
    const phases = state.phases as Phase[];

    // ── Working rows (appended to the Returns working sheet) ─────────────────
    let cr = cs.rowCount + 2;
    const cT = (t: number): number => 4 + t;
    const C = (r: number, c: number) => ({ sheet: CALC, row: r, col: c });
    const rtc = (key: string, t: number): string => w.refA(C(w.addr(key).row, cT(t)));
    const rtc3 = (key: string): string => w.refA(C(w.addr(key).row, 3));
    const at = (r: number, t: number): string => w.refA(C(r, cT(t)));
    const sc3 = (r: number): string => w.refA(C(r, 3));
    const rngA = (r: number): string => w.rangeA(CALC, r, cT(0), cT(N - 1));
    const rowA = (key: string, label: string, f: (t: number) => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      for (let t = 0; t < N; t++) w.fA(C(r, cT(t)), f(t), { cached: 0 });
      return r;
    };
    const cellS = (key: string, label: string, f: () => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      w.fA(C(r, 3), f(), { cached: 0 });
      return r;
    };
    const vis = (sheet: string, key: string, t: number): string => w.refA({ sheet, row: w.addr(key).row, col: pc(t) });
    const fnc = (key: string, t: number): string => w.refA({ sheet: 'Financing Calc', row: w.addr(key).row, col: 4 + t });
    const plKey = (re: RegExp): string | undefined => w.reg.keys().find((k) => k.startsWith('pl|__all__||') && re.test(k.slice('pl|__all__||'.length)));
    const patKey = plKey(/^Profit after /), ebitdaKey = plKey(/^EBITDA$/);
    const missing: string[] = [];
    if (!patKey || !ebitdaKey) missing.push('the P&L profit after tax and EBITDA rows');
    for (const p of phases) if (!has(`phase:${p.id}:oStart`) || !has(`phase:${p.id}:oEnd`)) missing.push(`${p.name}: the operations window`);
    if (missing.length) return [{ sheet: RET, status: 'partial' as const, formulas: 0, note: `2. RE Metrics stays the platform's values: ${missing.join('; ')}.` }];

    const noi = w.addr('rtc:noi').row, debt = w.addr('rtc:debt').row, div = w.addr('rtc:div').row;
    const AX = (): string => w.ref('project:axisYear');
    const op = rowA('rtm:op', 'operating year (any phase in its operations window)', (t) =>
      `IF(OR(${phases.map((p) => `AND(${AX()}+${t}>=YEAR(${w.ref(`phase:${p.id}:oStart`)}),${AX()}+${t}<=YEAR(${w.ref(`phase:${p.id}:oEnd`)}))`).join(',')}),1,0)`);
    const ebitda = rowA('rtm:ebitda', 'EBITDA (P&L)', (t) => vis('P&L', ebitdaKey!, t));
    const rev = rowA('rtm:rev', 'revenue (P&L)', (t) => vis('P&L', 'pl|__all__||Total Revenue', t));
    const pat = rowA('rtm:pat', 'profit after tax (P&L)', (t) => vis('P&L', patKey!, t));
    const intExp = rowA('rtm:int', 'interest expensed', (t) => `ABS(${fnc('fnc:main:intexp', t)})`);
    // THE COVENANT DENOMINATOR: scheduled service, interest plus contractual principal (the exit repayment), the sweep excluded.
    const ds = rowA('rtm:ds', 'scheduled debt service (sweep excluded)', (t) => `${fnc('fnc:main:interest', t)}+${fnc('fnc:main:exitrepay', t)}`);
    const gdv = cellS('rtm:gdv', 'gross development value (revenue over the hold)', () => `SUM(${w.rangeA('P&L', w.addr('pl|__all__||Total Revenue').row, pc(0), pc(X))})`);
    const measured = (v: string): string => `IF(ABS(${v})<0.000000001,"-",${v})`;
    const dscr = rowA('rtm:dscr', 'DSCR', (t) => `IF(AND(${at(op, t)}=1,${at(ds, t)}>0.000001),${measured(`${at(ebitda, t)}/${at(ds, t)}`)},"-")`);
    const icr = rowA('rtm:icr', 'interest cover', (t) => `IF(${at(intExp, t)}>0.000001,${measured(`${at(ebitda, t)}/${at(intExp, t)}`)},"-")`);
    const dy = rowA('rtm:dy', 'debt yield', (t) => `IF(AND(${at(debt, t)}>0.000000001,${at(noi, t)}>0.000000001),${at(noi, t)}/${at(debt, t)},"-")`);
    const ltv = rowA('rtm:ltv', 'LTV on GDV', (t) => `IF(AND(${sc3(gdv)}>0.000000001,${at(debt, t)}>0.000000001),${at(debt, t)}/${sc3(gdv)},"-")`);
    const cumEq = rowA('rtm:cumeq', 'cumulative equity invested', (t) => `SUM(${w.rangeA(CALC, w.addr('rtc:eqcash').row, cT(0), cT(t))})+SUM(${w.rangeA(CALC, w.addr('rtc:inkind').row, cT(0), cT(t))})`);
    // Averaged over the years that paid a distribution (cashOnCashSeries), so a year with none is left out.
    const coc = rowA('rtm:coc', 'cash on cash (years with a distribution)', (t) => `IF(AND(${at(cumEq, t)}>0.000001,${at(div, t)}>0),${at(div, t)}/${at(cumEq, t)},"")`);
    const ev = rtc3('rtc:ev'), tvEq = rtc3('rtc:tveq');
    const ltvExit = cellS('rtm:ltvexit', 'LTV at the exit (debt over the exit value)', () => `IF(${ev}>0,MAX(0,${at(debt, X)})/${ev},"-")`);
    // The held assets' cost (Operate and Lease, the per-asset rows' test), full cost incl. land.
    const P0 = w.addr('cxc:P0').col;
    const heldIds = [...snap.perAssetPL.values()].filter((p) => p.strategy === 'Operate' || p.strategy === 'Lease').map((p) => p.assetId);
    const heldCost = cellS('rtm:heldcost', 'held assets\' cost (Operate and Lease)', () => heldIds.map((id) => {
      const ks = w.reg.keys().filter((k) => k.startsWith(`cxc:${id}:`) && k.split(':').length === 3);
      return ks.length ? `MAX(0,${ks.map((k) => `SUM(${w.rangeA('Capex Calc', w.addr(k).row, P0, P0 + N - 1)})`).join('+')})` : '0';
    }).join('+') || '0');
    const stab = (): string => at(noi, M);
    const yoc = (): string => `${stab()}/${sc3(heldCost)}`;
    const tdc = (): string => `SUM(${w.rangeA('Financing Calc', w.addr('fnc:capexall').row, 4, 4 + N - 1)})`;
    const tfc = (): string => `SUM(${w.rangeA('Financing Calc', w.addr('fnc:main:interest').row, 4, 4 + N - 1)})`;
    const revX = (): string => `SUM(${w.rangeA(CALC, rev, cT(0), cT(X))})`;
    const patX = (): string => `SUM(${w.rangeA(CALC, pat, cT(0), cT(X))})`;

    // ── Visible cells ────────────────────────────────────────────────────────
    const writes: Array<() => void> = [];
    const kpi = (sec: string, label: string, value: () => string, sub?: () => string): void => {
      const key = `retk|${sec}|${label}`;
      if (!has(key)) { missing.push(key); return; }
      const a = w.addr(key);
      writes.push(() => w.fA(a, value()));
      if (sub) { const sk = `retks|${sec}|${label}`; if (has(sk)) { const b = w.addr(sk); writes.push(() => w.fA(b, sub())); } }
    };
    const gridCell = (rowKey: string, i: number, f: () => string): void => {
      const key = `${rowKey}|${i}`;
      if (!has(key)) { missing.push(key); return; }
      const a = w.addr(key);
      writes.push(() => w.fA(a, f()));
    };
    const retRow = (key: string): number => w.addr(key).row;
    const FCFE = (): string => w.rangeA(RET, retRow('retr|FCFE Build-Up (levered, free cash to equity)|= FCFE (levered equity)'), OPEN_COL, pc(N - 1));
    const MS = '2. RE Metrics';
    const covenants = project.covenants ?? DEFAULT_COVENANTS;
    const seriesOf: Record<string, number> = { dscr, icr, debt_yield: dy, ltv };
    // The threshold a card compares with: the first covenant on that metric, its shaded cell.
    const thrOf = (metric: string, dflt: number): string => {
      const c = covenants.find((x) => x.metric === metric);
      return c && has(`retg|Lender Covenants|${c.label}|2`) ? `N(${w.ref(`retg|Lender Covenants|${c.label}|2`)})` : String(dflt);
    };
    const dscrMin = (): string => `MIN(${rngA(dscr)})`;
    const ltvHero = (): string => `IF(COUNT(${rngA(ltv)})>0,MAX(${rngA(ltv)}),${sc3(ltvExit)})`;
    const hasLtv = (): string => `OR(COUNT(${rngA(ltv)})>0,ISNUMBER(${sc3(ltvExit)}))`;
    kpi(MS, 'Equity Multiple (FCFE)', () => multT(moicOf(FCFE())));
    kpi(MS, 'Yield on Cost', () => ratioT(stab(), sc3(heldCost)));
    kpi(MS, 'Profit Margin', () => ratioT(patX(), revX()));
    kpi(MS, 'Min DSCR', () => seriesT('MIN', rngA(dscr), multT),
      () => `"${METRIC_CAPTIONS.dscrMin} · vs "&${multT(thrOf('dscr', 1.2))}&IF(COUNT(${rngA(dscr)})=0,"",IF(${dscrMin()}>=${thrOf('dscr', 1.2)}," · Pass"," · Breach"))`);
    kpi(MS, 'Peak Equity', () => moneyT(`MAX(0,MAX(${rngA(cumEq)}))`));
    const ltvLabel = w.reg.keys().find((k) => k.startsWith(`retk|${MS}|LTV`))?.split('|')[2];
    if (ltvLabel) kpi(MS, ltvLabel, () => `IF(${hasLtv()},${pctT(ltvHero())},"n/a")`,
      () => `"${ltvLabel === 'LTV (peak debt)' ? 'peak debt / GDV' : 'debt / exit value'} · vs "&${pctT(thrOf('ltv', 0.6), 0)}&IF(${hasLtv()},IF(${ltvHero()}<=${thrOf('ltv', 0.6)}," · Pass"," · Breach"),"")`);

    // Lender covenants: worst, average and status; the thresholds stay the shaded inputs.
    for (const cov of covenants) {
      const rk = `retg|Lender Covenants|${cov.label}`;
      const sr = seriesOf[cov.metric];
      if (sr === undefined) continue; // a custom covenant has no series: it stays as printed
      const rng = rngA(sr), fn = cov.operator === 'min' ? 'MIN' : 'MAX';
      const unit = (e: string): string => e; // numbers, formatted by the cell
      const worst = (): string => (cov.metric === 'ltv' ? `IF(COUNT(${rng})=0,${sc3(ltvExit)},${fn}(${rng}))` : `IF(COUNT(${rng})=0,"-",${fn}(${rng}))`);
      const avg = (): string => (cov.metric === 'ltv' ? `IF(COUNT(${rng})=0,${sc3(ltvExit)},AVERAGE(${rng}))` : `IF(COUNT(${rng})=0,"-",AVERAGE(${rng}))`);
      const thr = (): string => `N(${w.ref(`${rk}|2`)})`;
      gridCell(rk, 3, () => unit(worst()));
      gridCell(rk, 4, () => unit(avg()));
      gridCell(rk, 5, () => `IF(ISNUMBER(${worst()}),IF(${worst()}${cov.operator === 'min' ? '>=' : '<='}${thr()},"Pass","Breach"),"n/a")`);
      const byYear = `retc|${cov.label}`;
      if (has(byYear)) { const r = retRow(byYear); writes.push(() => { for (let t = 0; t < N; t++) w.fA({ sheet: RET, row: r, col: pc(t) }, at(sr, t)); }); }
    }

    // Exit-year analysis: each candidate's streams, rebuilt from the same rows with its own terminal value.
    const sbFf = w.addr('rtc:s:ffpre').row, sbFe = w.addr('rtc:s:fepre').row, level = w.addr('rtc:trapLevel').row;
    const capRef = (): string => `N(${w.ref('ret|Exit Cap Rate (%)', TOTAL_COL)})`;
    const EY = 'retg|Exit-Year Analysis (hold vs sell timing)|';
    for (const x of rs.exitYears) {
      const e = x.exitIdx;
      const rk = `${EY}${x.exitYearLabel}${x.isSelected ? '  ◀ selected' : ''}`;
      if (!has(`${rk}|0`)) { missing.push(rk); continue; }
      const m = cfg.terminalValueBasis === 'exit_year' ? e : Math.max(0, e - 1);
      const evE = cellS(`rtm:x:${e}:ev`, `exit ${x.exitYearLabel}: enterprise value`, () => `IF(${capRef()}<=0.000000001,0,MAX(0,${at(noi, m)}/${capRef()}))`);
      const eqE = cellS(`rtm:x:${e}:eq`, `exit ${x.exitYearLabel}: equity value`, () => `MAX(0,${sc3(evE)}-MAX(0,${at(debt, e)}))`);
      const s = (key: string, label: string, base: number, add: () => string): number => {
        const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
        for (let k = 0; k <= e + 1; k++) w.fA(C(r, 4 + k), `${w.refA(C(base, 4 + k))}${k === e + 1 ? `+${add()}` : ''}`, { cached: 0 });
        return r;
      };
      const ff = s(`rtm:x:${e}:ff`, `exit ${x.exitYearLabel}: FCFF`, sbFf, () => sc3(evE));
      const fe = s(`rtm:x:${e}:fe`, `exit ${x.exitYearLabel}: FCFE`, sbFe, () => `${sc3(eqE)}+${at(level, e)}`);
      const rngF = (): string => w.rangeA(CALC, ff, 4, 4 + e + 1), rngE = (): string => w.rangeA(CALC, fe, 4, 4 + e + 1);
      gridCell(rk, 0, () => sc3(evE));
      gridCell(rk, 1, () => sc3(eqE));
      gridCell(rk, 2, () => irrT(rngF()));
      gridCell(rk, 3, () => irrT(rngE()));
      gridCell(rk, 4, () => multT(moicOf(rngE())));
    }

    // Coverage and profitability.
    const CP = 'Coverage and profitability detail';
    const cumF = cellS('rtm:maxneg', 'largest cumulative FCFE shortfall', () => {
      const n = N + 1;
      // The running sum at each column, its lowest point, as a positive figure.
      return `MAX(0,-MIN(${Array.from({ length: n }, (_, k) => `SUM(${w.rangeA(RET, retRow('retr|FCFE Build-Up (levered, free cash to equity)|= FCFE (levered equity)'), OPEN_COL, OPEN_COL + k)})`).join(',')}))`;
    });
    kpi(CP, 'Avg DSCR', () => seriesT('AVERAGE', rngA(dscr), multT));
    kpi(CP, 'Min Interest Cover', () => seriesT('MIN', rngA(icr), multT));
    kpi(CP, 'Debt Yield', () => seriesT('MIN', rngA(dy), (e) => pctT(e)));
    kpi(CP, 'Avg Cash-on-Cash', () => seriesT('AVERAGE', rngA(coc), (e) => pctT(e)));
    kpi(CP, 'Cap Rate at Exit', () => ratioT(stab(), ev));
    kpi(CP, 'Profit on Cost', () => ratioT(`${revX()}-${tdc()}`, tdc()));
    kpi(CP, 'Development Spread', () => `IF(AND(${sc3(heldCost)}>0,${ev}>0),${pctT(`${yoc()}-${stab()}/${ev}`)},"n/a")`);
    kpi(CP, 'Max Negative Cash Flow', () => moneyT(sc3(cumF)));

    // Development economics.
    const DE = 'Development economics';
    const g = (): string => sc3(gdv);
    kpi(DE, 'Gross Development Value', () => moneyT(g()));
    kpi(DE, 'Total Development Cost', () => moneyT(tdc()));
    kpi(DE, 'Total Financing Cost', () => moneyT(tfc()));
    kpi(DE, 'Profit before Financing', () => moneyT(`(${g()}-${tdc()})`));
    kpi(DE, 'Profit after Financing', () => moneyT(`(${g()}-${tdc()}-${tfc()})`));
    kpi(DE, 'Development Margin', () => ratioT(`${g()}-${tdc()}-${tfc()}`, g()));
    kpi(DE, 'Cost to Value', () => ratioT(tdc(), g()));

    // Income and exit profile.
    const IE = 'Income and exit profile';
    kpi(IE, 'Stabilised NOI', () => moneyT(stab()));
    kpi(IE, 'Exit NOI', () => moneyT(at(noi, X)));
    kpi(IE, 'Stabilisation Year', () => `IF(AND(COUNTIF(${rngA(noi)},">0")>0,${stab()}>0),IFERROR(TEXT(${AX()}+MATCH(TRUE,INDEX(${rngA(noi)}>=${stab()}*0.95,0),0)-1,"0"),"n/a"),"n/a")`);
    kpi(IE, 'Stabilised Yield on Cost', () => ratioT(stab(), sc3(heldCost)));
    kpi(IE, 'Exit Cap Rate', () => ratioT(stab(), ev));
    kpi(IE, 'Terminal Enterprise Value', () => moneyT(ev));
    kpi(IE, 'Terminal Equity Value', () => moneyT(tvEq));

    // Funding mix, off the sources and uses the Returns tab prints.
    const su = (label: string): string => w.ref(`ret|${label}`, TOTAL_COL);
    const FM = 'Funding mix';
    kpi(FM, 'Debt', () => ratioT(`${su('Existing Debt')}+${su('New Debt (incl. capitalised IDC)')}`, su('Total Sources')));
    kpi(FM, 'Cash Equity', () => ratioT(`${su('Existing Equity')}+${su('New Equity (cash)')}`, su('Total Sources')));
    kpi(FM, 'In-Kind Equity', () => ratioT(su('In-Kind Equity (land)'), su('Total Sources')));
    kpi(FM, 'Customer Funding', () => ratioT(su('Customer Collections / Pre-Sales'), su('Total Sources')));

    // Operating KPIs, from the Revenue working sheet's own rows, per line.
    {
      const lines = planRevenueLines(state.assets, state.subUnits, state.phases, project);
      const rv = (k: string): string => `SUM(${w.rangeA('Revenue Calc', w.addr(k).row, 4, 4 + N - 1)})`;
      const lineKeys = (suffix: string): string[] => [...new Set(lines.map((l) => l.key))].filter((k) => has(`rvc:${k}:${suffix}`));
      const sumOf = (suffix: string): string => lineKeys(suffix).map((k) => rv(`rvc:${k}:${suffix}`)).join('+') || '0';
      const intT = (e: string): string => `TEXT(ROUND(${e},0),"#,##0")`;
      const rateT = (num: string, den: string): string => `IF(${den}>0,${intT(`(${num})/(${den})`)},"n/a")`;
      // The three blocks sit under one heading (their own titles are text lines, not tables).
      const OK = 'Operating KPIs (hospitality / residential / lease)';
      const hk = lineKeys('arn');
      if (hk.length && has(`retk|${OK}|Occupancy`)) {
        const HS = OK;
        const avail = (): string => sumOf('arn'), occ = (): string => sumOf('orn'), rooms = (): string => sumOf('rooms');
        kpi(HS, 'Occupancy', () => ratioT(occ(), avail()));
        kpi(HS, 'ADR', () => rateT(rooms(), occ()));
        kpi(HS, 'RevPAR', () => rateT(rooms(), avail()));
        kpi(HS, 'Rooms Revenue', () => moneyT(`(${rooms()})`));
        kpi(HS, 'F&B Revenue', () => moneyT(`(${sumOf('fb')})`));
        kpi(HS, 'Other Revenue', () => moneyT(`(${sumOf('other')})`));
        kpi(HS, 'Total Hospitality Revenue', () => moneyT(`(${sumOf('total')})`));
        kpi(HS, 'Available Room Nights', () => intT(avail()));
      }
      // Residential: the sale passes' units and revenue, pre and post, summed over every row.
      const sellKeys = w.reg.keys().filter((k) => /^rvc:.+:(pre|post):(units|rev)$/.test(k));
      if (sellKeys.length && w.reg.keys().some((k) => k.startsWith(`retk|${OK}|Residential GDV`))) {
        const RS = OK;
        const pick = (kind: 'pre' | 'post' | '', nm: 'units' | 'rev'): string => sellKeys.filter((k) => k.endsWith(`:${nm}`) && (!kind || k.includes(`:${kind}:`))).map(rv).join('+') || '0';
        // Revenue split at each line's handover, as the engine files it (a sale signed after handover is a sale after handover).
        const units = (): string => `(${pick('', 'units')})`;
        const pre = (): string => `(${sumOf('preRev')})`, sale = (): string => `(${sumOf('preRev')}+${sumOf('postRev')})`;
        // The years any unit sold, across every row: velocity is units over those years.
        const unitRows = sellKeys.filter((k) => k.endsWith(':units')).map((k) => w.rangeA('Revenue Calc', w.addr(k).row, 4, 4 + N - 1));
        const active = (): string => `SUMPRODUCT(--((${unitRows.join('+')})>0))`;
        kpi(RS, 'Residential GDV', () => moneyT(sale()));
        kpi(RS, 'Units Sold', () => intT(units()));
        kpi(RS, 'Avg Sale Price / Unit', () => rateT(sale(), units()));
        kpi(RS, 'Pre-Sales %', () => ratioT(pre(), sale()));
        kpi(RS, 'Sales Velocity', () => rateT(units(), active()));
      }
      const lk = lineKeys('rev').filter((k) => has(`rvc:${k}:gla`) && has(`rvc:${k}:occupied`));
      if (lk.length && w.reg.keys().some((k) => k.startsWith(`retk|${OK}|Total GLA`))) {
        const LS = OK;
        const glaCell = (k: string): string => w.refA({ sheet: 'Revenue Calc', row: w.addr(`rvc:${k}:gla`).row, col: 3 });
        const occRng = (k: string): string => w.rangeA('Revenue Calc', w.addr(`rvc:${k}:occupied`).row, 4, 4 + N - 1);
        const glaYears = (): string => lk.map((k) => `${glaCell(k)}*COUNTIF(${occRng(k)},">0")`).join('+');
        const occ = (): string => `(${lk.map((k) => `SUM(${occRng(k)})`).join('+')})`;
        const revL = (): string => `(${lk.map((k) => rv(`rvc:${k}:rev`)).join('+')})`;
        kpi(LS, 'Total GLA', () => intT(lk.map(glaCell).join('+')));
        kpi(LS, 'Avg Occupancy', () => ratioT(occ(), `(${glaYears()})`));
        kpi(LS, 'Rent per Leased sqm', () => rateT(revL(), occ()));
        kpi(LS, 'Total Lease Revenue', () => moneyT(revL()));
      }
      void lineForAsset; void irrOf;
    }

    if (missing.length) return [{ sheet: RET, status: 'partial' as const, formulas: 0, note: `2. RE Metrics stays the platform's values: no rule for ${missing.slice(0, 5).join('; ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}.` }];
    for (const fn of writes) fn();
    return [{
      sheet: RET, status: 'partial' as const, formulas: w.formulas.get(RET) ?? 0,
      note: 'Live: 2. RE Metrics (the covenant series, worst, average and pass or breach against the shaded thresholds, the exit-year analysis rebuilt per candidate exit, every card and the operating KPIs), except the residential average price per sqm, whose area is a stored asset field. 3. Case Comparison is the platform\'s values by design: a live workbook models the case that was exported.',
    }];
  },
};
