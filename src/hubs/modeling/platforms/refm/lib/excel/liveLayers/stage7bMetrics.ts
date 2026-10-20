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
 * The residential average price per sqm divides by the NSA used on Inputs Table 2
 * of every Sell asset that sold anything (2026-09-28: it read a stored asset field
 * the workbook did not carry, by a second area rule, until the platform moved to one).
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LOOP_NEGATIVE } from './stage6Loop';
import { LiveWriter } from './writer';
import { irrOf, pctT, irrT, multT, moicOf, moneyT as moneyWords, ratioT, seriesT } from './excelText';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { terminalValueFormula } from './terminal';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { computeReturnsSnapshot, resolveReturnsConfig } from '../../returns-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { METRIC_CAPTIONS, METRIC_LABELS } from '../../reports/metricCaptions';
import { DEFAULT_COVENANTS, type Phase } from '../../state/module1-types';
import { STABILISATION_GROWTH_TOLERANCE } from '@/src/core/calculations/returns/analytics';

const RET = 'Returns';

export const stage7bMetrics: LiveLayer = {
  name: 'stage 7b: RE metrics',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const cs = wb.getWorksheet(RET);
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

    // ── Working rows: below 7a's workings on the Returns sheet, one formula across each row ──
    let cr = cs.rowCount + 2;
    const C = (r: number, c: number) => ({ sheet: RET, row: r, col: c });
    const at = (r: number, t: number): string => w.refP(C(r, pc(t)), RET);
    const atA = (r: number, t: number): string => w.refA(C(r, pc(t)), RET);
    const sc3 = (r: number): string => w.refA(C(r, TOTAL_COL), RET);
    const rtc3 = (key: string): string => sc3(w.addr(key).row);
    const rngA = (r: number): string => w.rangeA(RET, r, pc(0), pc(N - 1));
    /** This year's Timeline year (column relative), and a fixed year's. */
    const TY = (c: number): string => w.refP({ sheet: 'Timeline', row: 3, col: c }, RET);
    const TYA = (t: number): string => w.refA({ sheet: 'Timeline', row: 3, col: pc(t) }, RET);
    /** Year 0 to year t of a row on this sheet: $F$r:F$r. */
    const toNow = (r: number, t: number): string => { w.refP(C(r, pc(t)), RET); return `$${colL(pc(0))}$${r}:${colL(pc(t))}$${r}`; };
    const rowA = (key: string, label: string, f: (t: number) => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, RET, r, 1);
      for (let t = 0; t < N; t++) w.fA(C(r, pc(t)), f(t), { cached: 0 });
      return r;
    };
    const cellS = (key: string, label: string, f: () => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, RET, r, 1);
      w.fA(C(r, TOTAL_COL), f(), { cached: 0 });
      return r;
    };
    const vis = (sheet: string, key: string, t: number): string => w.refP({ sheet, row: w.addr(key).row, col: pc(t) }, RET);
    const fnc = (key: string, t: number): string => { const a = w.addr(key); const r = w.refP({ sheet: a.sheet, row: a.row, col: pc(t) }, RET); return LOOP_NEGATIVE.has(key) ? `(-${r})` : r; };
    const plKey = (re: RegExp): string | undefined => w.reg.keys().find((k) => k.startsWith('pl|__all__||') && re.test(k.slice('pl|__all__||'.length)));
    const patKey = plKey(/^Profit after /), ebitdaKey = plKey(/^EBITDA$/);
    const missing: string[] = [];
    if (!patKey || !ebitdaKey) missing.push('the P&L profit after tax and EBITDA rows');
    for (const p of phases) if (!has(`phase:${p.id}:oStart`) || !has(`phase:${p.id}:oEnd`)) missing.push(`${p.name}: the operations window`);
    if (missing.length) return [{ sheet: RET, status: 'partial' as const, formulas: 0, note: `2. RE Metrics stays the platform's values: ${missing.join('; ')}.` }];

    const noi = w.addr('rtc:noi').row, debt = w.addr('rtc:debt').row, div = w.addr('rtc:div').row;
    const AX = (): string => w.ref('project:axisYear');
    const op = rowA('rtm:op', 'operating year (any phase in its operations window)', (t) =>
      `IF(OR(${phases.map((p) => `AND(${TY(pc(t))}>=YEAR(${w.ref(`phase:${p.id}:oStart`)}),${TY(pc(t))}<=YEAR(${w.ref(`phase:${p.id}:oEnd`)}))`).join(',')}),1,0)`);
    const ebitda = rowA('rtm:ebitda', 'EBITDA (P&L)', (t) => vis('P&L', ebitdaKey!, t));
    const rev = rowA('rtm:rev', 'revenue (P&L)', (t) => vis('P&L', 'pl|__all__||Total Revenue', t));
    const pat = rowA('rtm:pat', 'profit after tax (P&L)', (t) => vis('P&L', patKey!, t));
    const intExp = rowA('rtm:int', 'interest expensed', (t) => `ABS(${fnc('fnc:main:intexp', t)})`);
    // THE COVENANT DENOMINATOR: scheduled service, interest plus contractual principal (the exit repayment), the sweep excluded.
    const ds = rowA('rtm:ds', 'scheduled debt service (sweep excluded)', (t) => `${fnc('fnc:main:interest', t)}+${fnc('fnc:main:sched', t)}+${fnc('fnc:main:exitrepay', t)}`);
    const gdv = cellS('rtm:gdv', 'gross development value (revenue over the hold)', () => `SUM(${w.rangeA('P&L', w.addr('pl|__all__||Total Revenue').row, pc(0), pc(X))})`);
    const measured = (v: string): string => `IF(ABS(${v})<0.000000001,"-",${v})`;
    const dscr = rowA('rtm:dscr', 'DSCR', (t) => `IF(AND(${at(op, t)}=1,${at(ds, t)}>0.000001),${measured(`${at(ebitda, t)}/${at(ds, t)}`)},"-")`);
    const icr = rowA('rtm:icr', 'interest cover', (t) => `IF(${at(intExp, t)}>0.000001,${measured(`${at(ebitda, t)}/${at(intExp, t)}`)},"-")`);
    const dy = rowA('rtm:dy', 'debt yield', (t) => `IF(AND(${at(debt, t)}>0.000000001,${at(noi, t)}>0.000000001),${at(noi, t)}/${at(debt, t)},"-")`);
    const ltv = rowA('rtm:ltv', 'LTV on GDV', (t) => `IF(AND(${sc3(gdv)}>0.000000001,${at(debt, t)}>0.000000001),${at(debt, t)}/${sc3(gdv)},"-")`);
    const cumEq = rowA('rtm:cumeq', 'cumulative equity invested', (t) => `SUM(${toNow(w.addr('rtc:eqcash').row, t)})+SUM(${toNow(w.addr('rtc:inkind').row, t)})`);
    // Averaged over the years that paid a distribution (cashOnCashSeries), so a year with none is left out.
    const coc = rowA('rtm:coc', 'cash on cash (years with a distribution)', (t) => `IF(AND(${at(cumEq, t)}>0.000001,${at(div, t)}>0),${at(div, t)}/${at(cumEq, t)},"")`);
    const ev = rtc3('rtc:ev'), tvEq = rtc3('rtc:tveq');
    const ltvExit = cellS('rtm:ltvexit', 'LTV at the exit (debt over the exit value)', () => `IF(${ev}>0,MAX(0,${atA(debt, X)})/${ev},"-")`);
    // The held assets' cost (Operate and Lease, the per-asset rows' test), full cost incl. land.
    const heldIds = [...snap.perAssetPL.values()].filter((p) => p.strategy === 'Operate' || p.strategy === 'Lease').map((p) => p.assetId);
    const heldCost = cellS('rtm:heldcost', 'held assets\' cost (Operate and Lease)', () => heldIds.map((id) => {
      const ks = w.reg.keys().filter((k) => k.startsWith(`cxc:${id}:`) && k.split(':').length === 3);
      return ks.length ? `MAX(0,${ks.map((k) => `SUM(${w.perRange(k, N)})`).join('+')})` : '0';
    }).join('+') || '0');
    const stab = (): string => atA(noi, M);
    // THE STABILISATION YEAR, the engine's rule (stabilizationMetrics, 2026-10-05):
    // walking back from the capitalised year M while the year before has NOI and
    // the year's growth is at most the growth into M plus the tolerance. A pass
    // row, a run of consecutive passes, and M less the run ending at M. Where M
    // has no year with NOI before it there is no growth to read, and the first
    // year at 95% of the capitalised NOI is the fallback, as in the engine.
    const steadyG = (): string => `${atA(noi, M)}/${atA(noi, M - 1)}-1+${STABILISATION_GROWTH_TOLERANCE}`;
    const stabPass = M > 0 ? rowA('rtm:stabpass', 'stabilisation: growth at most the steady growth', (t) => `IF(AND(${TY(pc(t))}<=${TYA(M)},N(${at(noi, t - 1)})>0,${atA(noi, M - 1)}>0),IF(${at(noi, t)}/${at(noi, t - 1)}-1<=${steadyG()},1,0),0)`) : -1;
    const runRow = cr;
    const stabRun = M > 0 ? rowA('rtm:stabrun', 'stabilisation: consecutive years at the steady growth', (t) => `IF(${at(stabPass, t)}=1,N(${at(runRow, t - 1)})+1,0)`) : -1;
    const stab95 = (): string => `IFERROR(TEXT(${AX()}+MATCH(TRUE,INDEX(${rngA(noi)}>=${stab()}*0.95,0),0)-1,"0"),"n/a")`;
    const stabYear = (): string => (M > 0
      ? `IF(${atA(noi, M - 1)}>0,TEXT(${TYA(M)}-${atA(stabRun, M)},"0"),${stab95()})`
      : stab95());
    const yoc = (): string => `${stab()}/${sc3(heldCost)}`;
    const tdc = (): string => `SUM(${w.perRange('fnc:capexall', N)})`;
    // The operating expenses over the same years as the GDV (2026-10-08): the P&L row is printed negative.
    const opx = (): string => `(-SUM(${w.rangeA('P&L', w.addr('pl|__all__||Total Operating Expenses').row, pc(0), pc(X))}))`;
    const tfc = (): string => `SUM(${w.perRange('fnc:main:interest', N)})`;
    const revX = (): string => `SUM(${w.rangeA(RET, rev, pc(0), pc(X))})`;
    const patX = (): string => `SUM(${w.rangeA(RET, pat, pc(0), pc(X))})`;

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
    const EY = 'retg|Exit-Year Analysis (hold vs sell timing)|';
    for (const x of rs.exitYears) {
      const e = x.exitIdx;
      const rk = `${EY}${x.exitYearLabel}${x.isSelected ? '  ◀ selected' : ''}`;
      if (!has(`${rk}|0`)) { missing.push(rk); continue; }
      const m = cfg.terminalValueBasis === 'exit_year' ? e : Math.max(0, e - 1);
      const evE = cellS(`rtm:x:${e}:ev`, `exit ${x.exitYearLabel}: enterprise value`, () => terminalValueFormula(w, cfg, atA(noi, m)));
      const eqE = cellS(`rtm:x:${e}:eq`, `exit ${x.exitYearLabel}: equity value`, () => `MAX(0,${sc3(evE)}-MAX(0,${atA(debt, e)}))`);
      const s = (key: string, label: string, base: number, add: () => string): number => {
        const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, RET, r, 1);
        for (let k = 0; k <= e + 1; k++) w.fA(C(r, OPEN_COL + k), `${w.refP(C(base, OPEN_COL + k), RET)}+(${TY(OPEN_COL + k)}=${TYA(e)})*(${add()})`, { cached: 0 });
        return r;
      };
      const ff = s(`rtm:x:${e}:ff`, `exit ${x.exitYearLabel}: FCFF`, sbFf, () => sc3(evE));
      const fe = s(`rtm:x:${e}:fe`, `exit ${x.exitYearLabel}: FCFE`, sbFe, () => `${sc3(eqE)}+${atA(level, e)}`);
      const rngF = (): string => w.rangeA(RET, ff, OPEN_COL, OPEN_COL + e + 1), rngE = (): string => w.rangeA(RET, fe, OPEN_COL, OPEN_COL + e + 1);
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
    kpi(DE, METRIC_LABELS.operatingExpenses, () => moneyT(opx()));
    kpi(DE, 'Total Financing Cost', () => moneyT(tfc()));
    kpi(DE, METRIC_LABELS.developmentSurplusBefore, () => moneyT(`(${g()}-${tdc()}-${opx()})`));
    kpi(DE, METRIC_LABELS.developmentSurplusAfter, () => moneyT(`(${g()}-${tdc()}-${opx()}-${tfc()})`));
    kpi(DE, 'Development Margin', () => ratioT(`${g()}-${tdc()}-${opx()}-${tfc()}`, g()));
    kpi(DE, 'Cost to Value', () => ratioT(tdc(), g()));

    // Income and exit profile.
    const IE = 'Income and exit profile';
    kpi(IE, 'Stabilised NOI', () => moneyT(stab()));
    kpi(IE, 'Exit NOI', () => moneyT(atA(noi, X)));
    kpi(IE, 'Stabilisation Year', () => `IF(AND(COUNTIF(${rngA(noi)},">0")>0,${stab()}>0),${stabYear()},"n/a")`);
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
      const rv = (k: string): string => `SUM(${w.perRange(k, N)})`;
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
        const unitRows = sellKeys.filter((k) => k.endsWith(':units')).map((k) => w.perRange(k, N));
        // No unit rows (every line sells by sqm) means no year sold a unit.
        const active = (): string => (unitRows.length ? `SUMPRODUCT(--((${unitRows.join('+')})>0))` : '0');
        kpi(RS, 'Residential GDV', () => moneyT(sale()));
        kpi(RS, 'Units Sold', () => intT(units()));
        kpi(RS, 'Avg Sale Price / Unit', () => rateT(sale(), units()));
        // PRICE PER SQM OVER THE NSA USED (2026-09-28, founder: one area rule): each
        // Sell asset that sold anything, by units OR by area, adds the NSA used cell on
        // Inputs Table 2 (buildOperatingKpis). An asset whose rows or NSA cell are not
        // on the sheet leaves the card the platform's value.
        const sellAssets = [...snap.revenue.bySellAsset.keys()];
        const soldOf = (id: string): string | null => {
          const ks = (state.subUnits as Array<{ id: string; assetId: string }>).filter((u) => u.assetId === id)
            .flatMap((u) => w.reg.keys().filter((k) => k.startsWith('rvc:') && k.includes(`:${u.id}:`) && /:(pre|post):(area|units)$/.test(k)));
          return ks.length ? ks.map(rv).join('+') : null;
        };
        if (sellAssets.length && sellAssets.every((id) => has(`entry:${id}:nsaUsed`))) {
          // An asset with no sale rows on the sheet sold nothing, so it adds nothing.
          const area = (): string => `(${sellAssets.map((id) => { const s = soldOf(id); return s ? `IF((${s})>0,N(${w.ref(`entry:${id}:nsaUsed`)}),0)` : '0'; }).join('+')})`;
          kpi(RS, 'Avg Sale Price / sqm', () => rateT(sale(), area()));
        }
        kpi(RS, 'Pre-Sales %', () => ratioT(pre(), sale()));
        kpi(RS, 'Sales Velocity', () => rateT(units(), active()));
      }
      const lk = lineKeys('rev').filter((k) => has(`rvc:${k}:gla`) && has(`rvc:${k}:occupied`));
      if (lk.length && w.reg.keys().some((k) => k.startsWith(`retk|${OK}|Total GLA`))) {
        const LS = OK;
        const glaCell = (k: string): string => w.one(`rvc:${k}:gla`);
        const occRng = (k: string): string => w.perRange(`rvc:${k}:occupied`, N);
        const glaYears = (): string => lk.map((k) => `${glaCell(k)}*COUNTIF(${occRng(k)},">0")`).join('+');
        const occ = (): string => `(${lk.map((k) => `SUM(${occRng(k)})`).join('+')})`;
        const revL = (): string => `(${lk.map((k) => rv(`rvc:${k}:rev`)).join('+')})`;
        kpi(LS, 'Total GLA', () => intT(lk.map(glaCell).join('+')));
        // The area-years let and the area-years available, working cells (2026-10-20), so the card stays short.
        const occW = cellS('rtm:lease:occ', 'Area let, sqm-years', occ), glaW = cellS('rtm:lease:gla', 'Area available while letting, sqm-years', glaYears);
        kpi(LS, 'Avg Occupancy', () => ratioT(w.refA(C(occW, TOTAL_COL), RET), w.refA(C(glaW, TOTAL_COL), RET)));
        kpi(LS, 'Rent per Leased sqm', () => rateT(revL(), occ()));
        kpi(LS, 'Total Lease Revenue', () => moneyT(revL()));
      }
      void lineForAsset; void irrOf;
    }

    if (missing.length) return [{ sheet: RET, status: 'partial' as const, formulas: 0, note: `2. RE Metrics stays the platform's values: no rule for ${missing.slice(0, 5).join('; ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}.` }];
    for (const fn of writes) fn();
    return [{
      sheet: RET, status: 'partial' as const, formulas: w.formulas.get(RET) ?? 0,
      note: 'Live: 2. RE Metrics (the covenant series, worst, average and pass or breach against the shaded thresholds, the exit-year analysis rebuilt per candidate exit, every card and the operating KPIs, the residential price per sqm over the NSA used on Inputs Table 2). 3. Case Comparison is the platform\'s values by design: a live workbook models the case that was exported.',
    }];
  },
};

function colL(c: number): string { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
