/* eslint-disable no-console */
/**
 * verify-m20M-pass2.ts (M2.0M Pass 2, 2026-05-11)
 *
 * 13 Tab 4 Financing cleanup fixes.
 *
 * Sections:
 *   1. Schema additions (Fix 5, 6, 10): RepaymentMethod enum extended,
 *      ProjectFinancingConfig.minimumCashReserve + phaseFilter, sub-mode
 *      + cash-sweep config on FinancingTranche.
 *   2. Migration (Fix 5/6/7/8/10) mapping all 5 concerns.
 *   3. Calc (Fix 1): computeFunding shape across 4 methods.
 *   4. Calc (Fix 11): computeEquity output.
 *   5. UI source markers (Fix 2/3/4/7/8/9/10/11/12).
 *   6. Auto IDC line verify (Fix 13).
 *   7. Em-dash sweep.
 *
 * Usage: npx tsx scripts/verify-m20M-pass2.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type FundingMethodId,
  type ProjectFinancingConfig,
  type Project,
  type RepaymentMethod,
  REPAYMENT_METHODS_USER,
  REPAYMENT_METHOD_LABELS,
  EQUAL_REPAYMENT_SUB_METHODS,
  PHASE_FILTER_ALL,
  makeDefaultProject,
  makeDefaultPhase,
  makeDefaultFinancingTranche,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  hydrationFromAnySnapshotChecked,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  computeFunding,
  computeEquity,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };

const FIN_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx'), 'utf8');
const TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'), 'utf8');
const CALC_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/calculations/index.ts'), 'utf8');

// ── Section 1: schema additions ─────────────────────────────────────────
console.log('\n[1/7] Schema additions');
{
  if (REPAYMENT_METHODS_USER.length === 3 && REPAYMENT_METHODS_USER.includes('equal_repayment') && REPAYMENT_METHODS_USER.includes('year_on_year_pct') && REPAYMENT_METHODS_USER.includes('cash_sweep')) {
    pass('REPAYMENT_METHODS_USER has the 3 user-facing methods');
  } else fail('REPAYMENT_METHODS_USER', `got ${JSON.stringify(REPAYMENT_METHODS_USER)}`);

  if (EQUAL_REPAYMENT_SUB_METHODS.length === 2) pass('EQUAL_REPAYMENT_SUB_METHODS has 2 entries');
  else fail('EQUAL_REPAYMENT_SUB_METHODS', `got ${EQUAL_REPAYMENT_SUB_METHODS.length}`);

  if (REPAYMENT_METHOD_LABELS.equal_repayment === 'Equal Repayment') pass('Label equal_repayment OK');
  else fail('Label equal_repayment', REPAYMENT_METHOD_LABELS.equal_repayment);

  if (PHASE_FILTER_ALL === '__all__') pass('PHASE_FILTER_ALL = __all__');
  else fail('PHASE_FILTER_ALL', `got ${PHASE_FILTER_ALL}`);

  const fresh = makeDefaultProject();
  if (fresh.financing?.minimumCashReserve === 0) pass('makeDefaultProject seeds minimumCashReserve=0');
  else fail('default minCash', `got ${fresh.financing?.minimumCashReserve}`);
  if (fresh.financing?.phaseFilter === PHASE_FILTER_ALL) pass('makeDefaultProject seeds phaseFilter=__all__');
  else fail('default phaseFilter', `got ${fresh.financing?.phaseFilter}`);
}

// ── Section 2: migration ────────────────────────────────────────────────
console.log('\n[2/7] Migration mapping');
{
  // Build a legacy snapshot with:
  //   Project.financing.cashDeficitConfig.minimumCashReserve = 50000 (Fix 6 lift)
  //   3 tranches with different legacy repayment methods (Fix 5 remap)
  //   One tranche with idcTreatment='mixed' (Fix 7 fold)
  //   One tranche with scope='asset' (Fix 8 rewrite)
  const phase = makeDefaultPhase();
  const fresh = makeDefaultProject();
  const tranches = [
    {
      id: 'tr-straight', phaseId: phase.id, name: 'Straight Line',
      ltvPct: 70, interestRatePct: 7.5,
      drawdownMethod: 'capex_basis',
      repaymentMethod: 'straight_line',
      repaymentPeriods: 60,
      idcCapitalize: true,
    },
    {
      id: 'tr-bullet', phaseId: phase.id, name: 'Bullet',
      ltvPct: 60, interestRatePct: 8,
      drawdownMethod: 'capex_basis',
      repaymentMethod: 'bullet',
      repaymentPeriods: 36,
      idcCapitalize: true,
    },
    {
      id: 'tr-sweep', phaseId: phase.id, name: 'Sweep continuous',
      ltvPct: 50, interestRatePct: 6,
      drawdownMethod: 'capex_basis',
      repaymentMethod: 'cashsweep_continuous',
      repaymentPeriods: 60,
      idcCapitalize: true,
      sweepStartPeriod: 5, sweepRatio: 80,
    },
    {
      id: 'tr-mixed', phaseId: phase.id, name: 'Mixed IDC',
      ltvPct: 65, interestRatePct: 7,
      drawdownMethod: 'capex_basis',
      repaymentMethod: 'equal_periodic_amortization',
      repaymentPeriods: 48,
      idcCapitalize: true,
      idcTreatment: 'mixed',
    },
    {
      id: 'tr-asset-scope', phaseId: phase.id, name: 'Asset-Scoped',
      ltvPct: 75, interestRatePct: 7.25,
      drawdownMethod: 'capex_basis',
      repaymentMethod: 'manual',
      repaymentPeriods: 60,
      idcCapitalize: true,
      scope: 'asset', scopeId: 'asset_1',
    },
  ];
  const legacySnap = {
    version: 8 as const,
    savedAt: new Date().toISOString(),
    project: {
      ...fresh,
      financing: {
        ...(fresh.financing as ProjectFinancingConfig),
        minimumCashReserve: undefined,
        phaseFilter: undefined,
        cashDeficitConfig: { initialCash: 0, minimumCashReserve: 50000, debtPct: 70, equityPct: 30 },
      },
    },
    phases: [phase],
    parcels: [],
    landAllocationMode: 'autoByBua' as const,
    assets: [{ id: 'asset_1', phaseId: phase.id, name: 'A', type: '', strategy: 'Sell' as const, visible: true, gfaSqm: 0, buaSqm: 1000, sellableBuaSqm: 800, parkingBaysRequired: 0 }],
    subUnits: [],
    costLines: [],
    costOverrides: [],
    financingTranches: tranches as never,
    equityContributions: [],
  };
  const r = hydrationFromAnySnapshotChecked(legacySnap);
  const proj = r.snapshot.project as Project;
  const tr = r.snapshot.financingTranches as Array<{ id: string; repaymentMethod: RepaymentMethod; equalRepaymentSubMethod?: string; cashSweepConfig?: { startingYear: number; sweepRatio: number }; idcTreatment?: string; scope?: string; scopeId?: string; phaseId: string; yearOnYearPctSchedule?: number[] }>;

  if (proj.financing?.minimumCashReserve === 50000) pass('Fix 6 migration: cashDeficitConfig.minimumCashReserve -> top-level');
  else fail('Fix 6 migration', `expected 50000, got ${proj.financing?.minimumCashReserve}`);
  if (proj.financing?.phaseFilter === PHASE_FILTER_ALL) pass('Fix 10 migration: phaseFilter defaults to __all__');
  else fail('Fix 10 migration', `got ${proj.financing?.phaseFilter}`);

  const findT = (id: string) => tr.find((t) => t.id === id);
  const t1 = findT('tr-straight');
  if (t1?.repaymentMethod === 'equal_repayment' && t1?.equalRepaymentSubMethod === 'equal_principal') {
    pass('Fix 5 migration: straight_line -> equal_repayment + equal_principal');
  } else fail('straight_line migration', JSON.stringify(t1));
  const t2 = findT('tr-bullet');
  if (t2?.repaymentMethod === 'equal_repayment' && t2?.equalRepaymentSubMethod === 'equal_total') {
    pass('Fix 5 migration: bullet -> equal_repayment + equal_total');
  } else fail('bullet migration', JSON.stringify(t2));
  const t3 = findT('tr-sweep');
  if (t3?.repaymentMethod === 'cash_sweep' && t3?.cashSweepConfig?.startingYear === 5 && t3?.cashSweepConfig?.sweepRatio === 80) {
    pass('Fix 5 migration: cashsweep_continuous -> cash_sweep + carries sweepStartPeriod/sweepRatio');
  } else fail('sweep migration', JSON.stringify(t3));
  const t4 = findT('tr-mixed');
  if (t4?.idcTreatment === 'capitalize') pass('Fix 7 migration: idcTreatment mixed -> capitalize');
  else fail('mixed migration', `got ${t4?.idcTreatment}`);
  if (t4?.repaymentMethod === 'equal_repayment' && t4?.equalRepaymentSubMethod === 'equal_total') {
    pass('Fix 5 migration: equal_periodic_amortization -> equal_repayment + equal_total');
  } else fail('equal_periodic migration', JSON.stringify(t4));
  const t5 = findT('tr-asset-scope');
  if (t5?.scope === 'phase' && t5?.scopeId === phase.id) {
    pass('Fix 8 migration: scope=asset -> scope=phase with parent phase id');
  } else fail('asset-scope migration', JSON.stringify(t5));
  if (t5?.repaymentMethod === 'year_on_year_pct') {
    pass('Fix 5 migration: manual -> year_on_year_pct');
  } else fail('manual migration', `got ${t5?.repaymentMethod}`);

  // Idempotency: re-feeding the migrated snapshot results in no further mutation.
  const reSnap = { version: 8 as const, savedAt: new Date().toISOString(), ...r.snapshot };
  const r2 = hydrationFromAnySnapshotChecked(reSnap);
  if (JSON.stringify(r2.snapshot.project) === JSON.stringify(proj)) pass('Idempotent: re-hydration is no-op on project');
  else fail('idempotent project', 'project mutated on 2nd hydrate');
  if (JSON.stringify(r2.snapshot.financingTranches) === JSON.stringify(r.snapshot.financingTranches)) pass('Idempotent: re-hydration is no-op on tranches');
  else fail('idempotent tranches', 'tranches mutated on 2nd hydrate');
}

// ── Section 3: computeFunding uniform shape ─────────────────────────────
console.log('\n[3/7] Uniform funding pipeline');
{
  const fresh = makeDefaultProject();
  const cfg = fresh.financing as ProjectFinancingConfig;
  const capex = [10_000_000, 20_000_000, 20_000_000, 10_000_000];
  for (const method of [1, 2, 3, 4] as FundingMethodId[]) {
    const f = computeFunding({ method, financing: cfg, capexPerPeriod: capex });
    if (f.method === method && Array.isArray(f.periodArray) && f.periodArray.length === capex.length) {
      pass(`Method ${method}: uniform output shape (totalNeed, periodArray, debtEquitySplit)`);
    } else fail(`Method ${method} shape`, JSON.stringify(f));
    if (f.debtEquitySplit.debt.length === capex.length && f.debtEquitySplit.equity.length === capex.length) {
      pass(`Method ${method}: debt + equity arrays match periodArray length`);
    } else fail(`Method ${method} split length`, '');
  }

  // Method 1 totalNeed = sum capex.
  const m1 = computeFunding({ method: 1, financing: cfg, capexPerPeriod: capex });
  if (Math.abs(m1.totalNeed - 60_000_000) < 1) pass('Method 1 totalNeed = sum(capex) = 60M');
  else fail('Method 1 totalNeed', `got ${m1.totalNeed}`);

  // Method 3 with existingCash + minCash.
  const m3cfg: ProjectFinancingConfig = {
    ...cfg,
    fundingMethod: 3,
    netFundingConfig: { existingCash: 5_000_000, debtPct: 70, equityPct: 30 },
    minimumCashReserve: 3_000_000,
  };
  const m3 = computeFunding({ method: 3, financing: m3cfg, capexPerPeriod: capex });
  // sum capex - 0 presales - 0 ocf - 5M existing + 3M minCash = 58M.
  if (Math.abs(m3.totalNeed - 58_000_000) < 1) pass('Method 3 totalNeed = capex - existingCash + minCash');
  else fail('Method 3 totalNeed', `expected 58M, got ${m3.totalNeed}`);

  // Method 4 enforces min cash floor (deficit fills the gap).
  const m4cfg: ProjectFinancingConfig = {
    ...cfg,
    fundingMethod: 4,
    cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 70, equityPct: 30 },
    minimumCashReserve: 2_000_000,
  };
  const m4 = computeFunding({ method: 4, financing: m4cfg, capexPerPeriod: capex });
  // initial=0, minCash=2M, capex 10/20/20/10. Each period required draw = capex + minCash top-up.
  // Period 0: cash 0 - 10M + draw = at least 2M -> draw 12M. After draw, cash=2M.
  // Period 1: cash 2M - 20M + draw = 2M -> draw 20M. cash=2M.
  // Period 2: 2M - 20M + 20M = 2M. cash=2M.
  // Period 3: 2M - 10M + 10M = 2M. cash=2M.
  // Total draws = 12 + 20 + 20 + 10 = 62M.
  if (Math.abs(m4.totalNeed - 62_000_000) < 1) pass(`Method 4 totalNeed enforces minCash floor (got ${m4.totalNeed})`);
  else fail('Method 4 totalNeed', `expected 62M, got ${m4.totalNeed}`);
}

// ── Section 4: computeEquity ─────────────────────────────────────────────
console.log('\n[4/7] Equity computation');
{
  const fresh = makeDefaultProject();
  const cfg = fresh.financing as ProjectFinancingConfig;
  const f = computeFunding({ method: 1, financing: cfg, capexPerPeriod: [25_000_000, 25_000_000, 25_000_000, 25_000_000] });
  // totalNeed 100M, debt=70%, equity=30%. With landInKind=10M -> cash equity=20M.
  const eq = computeEquity(cfg, f, 10_000_000);
  if (Math.abs(eq.totalEquityNeed - 30_000_000) < 1) pass(`totalEquityNeed = 100M * 30% = 30M (got ${eq.totalEquityNeed})`);
  else fail('totalEquityNeed', `${eq.totalEquityNeed}`);
  if (Math.abs(eq.inKindContribution - 10_000_000) < 1) pass('inKindContribution = land in-kind value');
  else fail('inKindContribution', `${eq.inKindContribution}`);
  if (Math.abs(eq.cashContribution - 20_000_000) < 1) pass('cashContribution = total equity - in-kind = 20M');
  else fail('cashContribution', `${eq.cashContribution}`);
  if (eq.cashPerPeriod.length === 4 && eq.inKindPerPeriod.length === 4 && eq.closingPerPeriod.length === 4) {
    pass('Period arrays length = 4');
  } else fail('arrays length', '');
  // Sum of cashPerPeriod should equal cashContribution (within rounding).
  const cashSum = eq.cashPerPeriod.reduce((s, v) => s + v, 0);
  if (Math.abs(cashSum - eq.cashContribution) < 1) pass('Sum(cashPerPeriod) = cashContribution');
  else fail('cashPerPeriod sum', `${cashSum} vs ${eq.cashContribution}`);
  // closingPerPeriod[last] should equal totalEquityNeed.
  if (Math.abs(eq.closingPerPeriod[3] - eq.totalEquityNeed) < 1) pass('Closing equity ends at totalEquityNeed');
  else fail('closing equity', `${eq.closingPerPeriod[3]}`);
}

// ── Section 5: UI source markers ────────────────────────────────────────
console.log('\n[5/7] UI source markers');
{
  // Fix 4: no MAAD in any user-facing label.
  if (!TYPES_SRC.includes("(MAAD)")) pass('No (MAAD) suffix in label catalogs');
  else fail('MAAD label sweep', 'TYPES_SRC still contains "(MAAD)"');

  // Fix 2: "LTV %" input label replaced.
  if (FIN_SRC.includes('>Debt %<')) pass('Fix 2: "Debt %" input label present');
  else fail('Fix 2 Debt %', 'not found');

  // Fix 3: facility-type dropdown gone (test-id removed).
  if (!FIN_SRC.includes('-facility-type"')) pass('Fix 3: facility-type dropdown removed');
  else fail('Fix 3 facility-type', 'test-id still present');

  // Fix 7: only 2 IDC options in the <select>.
  const idcMatch = FIN_SRC.match(/data-testid={`tranche-\$\{tranche\.id\}-idc-treatment`}[\s\S]{0,500}<\/select>/);
  if (idcMatch && idcMatch[0].includes('value="capitalize"') && idcMatch[0].includes('value="expense"') && !idcMatch[0].includes('value="mixed"')) {
    pass('Fix 7: IDC dropdown has capitalize + expense only');
  } else fail('Fix 7 IDC dropdown', 'unexpected option set');

  // Fix 8: per-asset scope dropdown gone.
  if (!FIN_SRC.includes('-asset"\n')) pass('Fix 8: per-asset scope test-id absent');
  else fail('Fix 8 asset scope', 'test-id still present');

  // Fix 9: schedules use formatScaledForExport.
  if (FIN_SRC.includes('formatScaledForExport')) pass('Fix 9: formatScaledForExport imported into Financing');
  else fail('Fix 9 formatter', 'not imported');

  // Fix 10: Phase Filter All option.
  if (FIN_SRC.includes('financing-phase-filter-all')) pass('Fix 10: All Phases option test-id present');
  else fail('Fix 10 all phases', 'test-id missing');

  // Fix 11: Capital Stack sources table + Equity Schedule.
  if (FIN_SRC.includes('cap-stack-sources-table')) pass('Fix 11: Capital Stack sources table marker');
  else fail('cap stack sources', 'missing');
  if (FIN_SRC.includes('cap-stack-source-equity-cash')) pass('Fix 11: Equity Cash row in stack');
  else fail('equity cash row', 'missing');
  if (FIN_SRC.includes('cap-stack-source-equity-inkind')) pass('Fix 11: Equity In-Kind row in stack');
  else fail('equity in-kind row', 'missing');
  if (FIN_SRC.includes('dataTestid="equity-schedule"')) pass('Fix 11: Equity Schedule table present');
  else fail('equity schedule', 'missing');

  // Fix 12: ScheduleTable renders Total column 2nd position.
  if (FIN_SRC.includes('<th style={{ padding: \'4px 6px\', textAlign: \'right\', textTransform: \'uppercase\', letterSpacing: \'0.05em\' }}>Total</th>')) {
    pass('Fix 12: ScheduleTable header has Total column');
  } else fail('Fix 12 Total header', 'not found');
  if (FIN_SRC.includes('-row-${ri}-total')) pass('Fix 12: per-row Total cell test-id present');
  else fail('per-row Total test-id', 'missing');

  // Fix 6: min cash input at top of Inputs.
  if (FIN_SRC.includes('financing-min-cash-reserve')) pass('Fix 6: project-level Minimum Cash Reserve input present');
  else fail('Fix 6 min-cash', 'missing');
}

// ── Section 6: auto IDC line (Fix 13) ───────────────────────────────────
console.log('\n[6/7] Auto IDC cost line (Fix 13)');
{
  // Verify the calc engine still skips only on 'expense'; capitalize + legacy mixed both emit.
  if (CALC_SRC.includes("if (treatment === 'expense') continue;")) pass('applyIdcToCapex skips on expense only');
  else fail('Fix 13 auto-line', 'expense-skip line missing');
}

// ── Section 7: em-dash sweep ────────────────────────────────────────────
console.log('\n[7/7] Em-dash sweep on new files');
{
  const EM = String.fromCharCode(0x2014);
  const targets = [
    'docs/m20M-pass2-cleanup.md',
    'scripts/verify-m20M-pass2.ts',
  ];
  let clean = 0;
  for (const f of targets) {
    const p = resolve(REPO_ROOT, f);
    if (!existsSync(p)) { fail(`em-dash ${f}`, 'file missing'); continue; }
    const txt = readFileSync(p, 'utf8');
    if (txt.includes(EM)) fail(`em-dash ${f}`, 'contains em-dash');
    else clean++;
  }
  if (clean === targets.length) pass(`em-dash sweep: all ${targets.length} new files clean`);
}

// ── Tally ───────────────────────────────────────────────────────────────
console.log('');
console.log('=======================================================');
console.log(`  verify-m20M-pass2.ts  ${passed} pass / ${failed} fail`);
console.log('=======================================================');
process.exit(failed === 0 ? 0 : 1);
