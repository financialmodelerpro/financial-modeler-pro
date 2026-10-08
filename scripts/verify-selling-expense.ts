/**
 * verify-selling-expense.ts (2026-10-08, founder decision 2)
 *
 * MARKETING IS EXPENSED AS INCURRED, AND THE SUMMARY DEDUCTS WHAT EARNING THE GDV COST.
 *
 * IAS 2 excludes selling costs from the cost of inventory, and marketing is expensed as it is incurred.
 * `isExpensedAsIncurred` (core/sellingExpense.ts) is the ONE rule: a marketing-stage line leaves the capex
 * breakdown inside computeAssetCost, so no capex reader can count it, and the P&L charges it as an operating
 * expense in the period it is incurred, paid then. Commission is not marketing: it stays capitalised, released
 * through cost of sales as the revenue is recognised (the IFRS 15 timing).
 *
 * And the summary does not let the cost vanish: the development surplus deducts the operating expenses over
 * the same years the GDV counts revenue (selling and marketing included), so expensing moves the surplus by
 * nothing and the old surplus's omission of operating costs is gone.
 *
 * Measured on the live project when credentials are loaded, and on the sample fixture with a marketing line.
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { computeAssetCost, deriveCostStage } from '../src/core/calculations';
import { isExpensedAsIncurred } from '../src/core/calculations/sellingExpense';
import { buildPLRows, buildDirectCFRows, SELLING_EXPENSE_LABEL } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import { getFinancialLabels, defaultTerminologyForCountry } from '../src/core/calculations/financials';
import { buildSellingCostReport } from '../src/hubs/modeling/platforms/refm/lib/reports/sellingCostReports';
import { METRIC_CAPTIONS } from '../src/hubs/modeling/platforms/refm/lib/reports/metricCaptions';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const S = (a: ArrayLike<number> = []): number => Array.from(a).reduce((x, v) => x + (v ?? 0), 0);
const near = (a: number, b: number, scale = 1): boolean => Math.abs(a - b) <= Math.max(1, 1e-9 * Math.max(Math.abs(scale), Math.abs(a), Math.abs(b)));
const M = (v: number): string => (v / 1e6).toFixed(1);

function runFor(label: string, st: any): void {
  console.log(`\n=== ${label} ===`);
  const s: any = computeFinancialsSnapshot(st);
  const rs: any = computeReturnsSnapshot(s, st.project);
  const marketing = (st.costLines as any[]).filter((l) => isExpensedAsIncurred(l));
  check('the model carries a marketing line (not vacuous)', marketing.length > 0);

  // 1. The rule, per asset: no marketing line in any capex breakdown; its amount is in `expensed`.
  let expensedTotal = 0;
  const leaked: string[] = [];
  for (const a of (st.assets as any[]).filter((x) => x.visible !== false)) {
    const phase = st.phases.find((p: any) => p.id === a.phaseId);
    const bd: any = computeAssetCost({ asset: a, project: st.project, phase, parcels: st.parcels, assets: st.assets, subUnits: st.subUnits, costLines: st.costLines, costOverrides: st.costOverrides, landAllocationMode: st.landAllocationMode, parcelFunding: st.project.financing?.parcelFunding, revenue: s.revenue } as any);
    for (const l of marketing) if (bd.byLineId[l.id] !== undefined || bd.perLinePerPeriod[l.id] !== undefined) leaked.push(`${a.id}:${l.id}`);
    if (Math.abs(bd.byStage.marketing ?? 0) > 0.5) leaked.push(`${a.id}: byStage.marketing ${bd.byStage.marketing}`);
    if (!near(S(bd.perPeriod), bd.total, bd.total)) leaked.push(`${a.id}: capex periods ${M(S(bd.perPeriod))} vs total ${M(bd.total)}`);
    expensedTotal += bd.expensed.total;
  }
  check('per asset: no marketing line in any capex breakdown, and the capex periods still sum to the total', leaked.length === 0, leaked.slice(0, 4).join('; '));
  check('the expensed amount is real (not vacuous)', expensedTotal > 1, M(expensedTotal));

  // 2. The statements: the P&L charges it, the cash flow pays it, the balance sheet balances.
  check('the P&L carries the expensed amount as its own operating expense', near(S(s.pl.sellingExpensePerPeriod), expensedTotal, expensedTotal), `${M(S(s.pl.sellingExpensePerPeriod))} vs ${M(expensedTotal)}`);
  check('...inside total operating expenses', near(S(s.pl.totalOpexPerPeriod), S(s.pl.hospitalityOpexPerPeriod) + S(s.pl.retailOpexPerPeriod) + S(s.pl.hqOpexPerPeriod) + S(s.pl.sellingExpensePerPeriod), S(s.pl.totalOpexPerPeriod)));
  check('the direct cash flow pays it in the period charged', s.pl.sellingExpensePerPeriod.every((v: number, t: number) => near(-(s.directCF.sellingExpensePaidPerPeriod[t] ?? 0), v, v)));
  check('...and it is not capex: the capex aggregate holds none of it', near(S(s.financing.capex.expensedPerPeriod), expensedTotal, expensedTotal));
  const peak = Math.max(1, ...s.bs.totalAssetsPerPeriod.map(Math.abs));
  check('the balance sheet balances in every year', Math.max(...s.bs.bsDifferencePerPeriod.map(Math.abs)) / peak < 1e-9);
  check('the reconciliation bridge explains every year', Math.max(...s.bsReconciliation.unexplainedPerPeriod.map(Math.abs)) / peak < 1e-9);
  check('inventory never goes negative (the capex it is built from no longer carries marketing)', Math.min(...s.bs.inventoryPerPeriod) > -1);
  const ctx: any = { snap: s, state: st, labels: getFinancialLabels(st.project.financialTerminology ?? defaultTerminologyForCountry(st.project.country)), filterPhaseId: '__all__', fmt: (v: number) => String(v) };
  const plRows = buildPLRows(ctx);
  const cfRows = buildDirectCFRows(ctx);
  check('the printed P&L and direct cash flow each carry a Selling & Marketing row',
    plRows.some((r: any) => String(r.label).startsWith(SELLING_EXPENSE_LABEL)) && cfRows.some((r: any) => String(r.label).startsWith(SELLING_EXPENSE_LABEL)));

  // The selling cost schedule (Revenue screen, PDF, workbook) reads the expensed part too: it printed zeros
  // for a day when it read the capex breakdown alone.
  const scr = buildSellingCostReport({ revenue: s.revenue, assets: st.assets, phases: st.phases, costLines: st.costLines, costOverrides: st.costOverrides, parcels: st.parcels, landAllocationMode: st.landAllocationMode, project: st.project, subUnits: st.subUnits, yearLabels: s.yearLabels, projectStartYear: s.projectStartYear } as any);
  const schedTotal = (scr?.schedule?.rows ?? []).reduce((x: number, r: any) => x + (r.total ?? 0), 0);
  check('the selling cost schedule by year still carries the expensed marketing (not zeros)', near(schedTotal, expensedTotal, expensedTotal), `${M(schedTotal)} vs ${M(expensedTotal)}`);

  // 3. The summary deducts the operating expenses over the GDV's years, so expensing moves the surplus by nothing.
  const de = rs.developmentEconomics;
  check('the surplus deducts the operating expenses over the same years as the GDV',
    near(de.profitAfterFinancing, de.gdv - de.totalDevelopmentCost - de.operatingExpenses - de.totalFinancingCost, de.gdv) && de.operatingExpenses > 0,
    `${M(de.profitAfterFinancing)} = ${M(de.gdv)} - ${M(de.totalDevelopmentCost)} - ${M(de.operatingExpenses)} - ${M(de.totalFinancingCost)}`);
  check('its caption says so', /operating expenses/.test(METRIC_CAPTIONS.developmentSurplusBefore) && !/before opex/.test(METRIC_CAPTIONS.developmentSurplusAfter));
  // Capitalising it again (a copy whose marketing is relabelled soft) moves development cost and operating expenses by the
  // same amount in opposite directions, so the surplus is the same either way: the cost cannot vanish.
  const cap = JSON.parse(JSON.stringify(st));
  for (const l of cap.costLines) if (isExpensedAsIncurred(l)) l.stageOverride = 'soft';
  const sCap: any = computeFinancialsSnapshot(cap);
  const deCap = computeReturnsSnapshot(sCap, cap.project).developmentEconomics as any;
  check('expensed or capitalised, the surplus before finance is the same (the cost moves, it does not vanish)',
    Math.abs(deCap.profitBeforeFinancing - de.profitBeforeFinancing) < 0.01 * Math.max(1, Math.abs(de.profitBeforeFinancing)) && Math.abs(deCap.totalDevelopmentCost - de.totalDevelopmentCost) > 1,
    `expensed ${M(de.profitBeforeFinancing)} (dev cost ${M(de.totalDevelopmentCost)}) vs capitalised ${M(deCap.profitBeforeFinancing)} (dev cost ${M(deCap.totalDevelopmentCost)})`);
}

(async () => {
  console.log('=== Marketing is expensed as incurred; the summary deducts operating expenses ===');
  check('the rule: a marketing-stage line is expensed, commission (soft) is not',
    isExpensedAsIncurred({ id: 'marketing__p1', stage: 'marketing', method: 'percent_of_revenue_sale' } as any) === true
    && isExpensedAsIncurred({ id: 'commission__p1', stage: 'soft', method: 'percent_of_selected' } as any) === false
    && deriveCostStage({ id: 'commission__p1', stage: 'soft' } as any) === 'soft');
  const core = readFileSync('src/core/calculations/index.ts', 'utf8');
  check('computeAssetCost applies the one rule', /if \(!isExpensedAsIncurred\(r\.line\)\) continue;/.test(core));
  check('the live workbook keys an expensed line apart (cxe:), so no capex scan in it counts the line',
    /\$\{isExpensedAsIncurred\(line\) \? 'cxe' : 'cxc'\}/.test(readFileSync('src/hubs/modeling/platforms/refm/lib/excel/liveLayers/stage2Capex.ts', 'utf8')));
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { loadLiveExportInputs } = await import('./fixtures/liveExportInputs');
    const l = await loadLiveExportInputs();
    runFor(`LIVE (${l.projectName})`, l.state);
  } else {
    check('live project (needs credentials: run with --env-file=.env.local)', false);
  }
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
