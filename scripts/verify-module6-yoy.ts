/**
 * verify-module6-yoy.ts
 *
 * Guards the Module 6 "Year-on-Year Impact" report builder on the LIVE FMP RE HUB
 * snapshot. Asserts, per changed-input block: the input value per case, every
 * per-period output the input drives (a debt-ratio change shows debt drawdown AND
 * financing cost; an interest-rate change shows financing cost + balance; revenue
 * change shows revenue), per-case actuals + deltas, the flow/stock kind (for the
 * Total column), and the inception (prior) value. Also asserts the axis leads with
 * the prior year (2025 on FMP RE HUB) like the other modules, and that values tie
 * to the existing computed series (no recompute).
 *
 * Fixture is gitignored live data; skip-with-notice when absent
 * (refresh: npx tsx scripts/fetch-fmp-re-hub.ts).
 *
 * Run: npx tsx scripts/verify-module6-yoy.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { buildCaseYoYReport, type YoYBlock, type YoYOutput } from '../src/hubs/modeling/platforms/refm/lib/reports/caseYoYReport';
import { applyOverrides, baseCaseId } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCaseComparisonReport } from '../src/hubs/modeling/platforms/refm/lib/reports/caseComparisonReport';
import { inactiveLeverReason, curatedDefaultFields, nonEconomicLeverReason } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';
import type { ProjectCase } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const seriesEqual = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6 * Math.max(1, Math.abs(b[i])));
const nonZero = (a: number[]) => a.some((v) => Math.abs(v) > 1);

const FIXTURE = 'scripts/fmpReHubSnapshot.json';
if (!existsSync(FIXTURE)) {
  console.log(`[SKIP] ${FIXTURE} not present (live project data, gitignored).`);
  console.log('       Refresh it with: npx tsx scripts/fetch-fmp-re-hub.ts');
  console.log('=== Result: skipped (no fixture) ===');
  process.exit(0);
}
const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const base: any = doc.snapshot;
console.log(`=== Module 6 Year-on-Year Impact (LIVE "${doc.projectName}" v${doc.versionNumber}) ===\n`);

const hasComponents = (t: any) => t.interbankRatePct !== undefined || t.creditSpreadPct !== undefined;
// Prefer an EXISTING facility with components so the stock-balance prior column
// carries a real non-zero opening balance to assert against.
const tranche = (base.financingTranches as any[]).find((t: any) => t.origin === 'existing' && hasComponents(t))
  ?? (base.financingTranches as any[]).find(hasComponents)
  ?? (base.financingTranches as any[])[0];
const ratePath = `financingTranches[id=${tranche.id}].interbankRatePct`;
const baseRate = Number(tranche?.interbankRatePct ?? tranche?.interestRatePct ?? 6);
const sellAssetIds = new Set((base.assets ?? []).filter((a: any) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage').map((a: any) => a.id));
const sellSub = (base.subUnits ?? []).find((u: any) => sellAssetIds.has(u.assetId) && Number(u.unitPrice) > 0);
const unitPath = sellSub ? `subUnits[id=${sellSub.id}].unitPrice` : null;

// Downside: per-facility INTEREST RATE override. Upside: unit price (revenue).
const downside: ProjectCase = { id: 'case_down', name: 'Downside', role: 'scenario', overrides: { [ratePath]: baseRate + 3 } };
const upside: ProjectCase = { id: 'case_up', name: 'Upside', role: 'scenario', overrides: unitPath ? { [unitPath]: Number(sellSub.unitPrice) * 1.2 } : {} };
const cases: ProjectCase[] = [{ id: 'case_management', name: 'Management Case', role: 'base', overrides: {} }, downside, upside];

const report = buildCaseYoYReport({ baseModel: base, cases, activeCaseId: 'case_management' });
const finSnap = computeFinancialsSnapshot(base);
const N = report.yearLabels.length;
console.log(`yearLabels: prior=${report.priorYearLabel}, ${report.yearLabels[0]}..${report.yearLabels[N - 1]} (${N})`);
console.log(`blocks: ${report.blocks.map((b) => `${b.inputLabel} -> [${b.outputs.map((o) => o.key).join(', ')}]`).join(' | ')}\n`);

// ── #5 Axis starts at the prior year (2025), matching other modules ──────────
check('axis leads with the prior/inception year (yearLabels[0] - 1)', report.priorYearLabel === report.yearLabels[0] - 1, `prior=${report.priorYearLabel} first=${report.yearLabels[0]}`);
check('on FMP RE HUB the first column is 2025 (project start 2026 minus one)', report.priorYearLabel === 2025 && report.yearLabels[0] === 2026, `prior=${report.priorYearLabel}`);

const find = (path: string): YoYBlock | undefined => report.blocks.find((b) => b.path === path);
const out = (b: YoYBlock | undefined, pred: (o: YoYOutput) => boolean): YoYOutput | undefined => b?.outputs.find(pred);

// ── Interest-rate block: input row + financing cost (flow) + balance (stock) ──
const rateBlock = find(ratePath);
check('a block exists for the changed interest-rate input', !!rateBlock, report.blocks.map((b) => b.path).join(' ; '));
if (rateBlock) {
  // Input row: value per case. A non-pair block has exactly one input line.
  check('a non-pair input has a single input line', rateBlock.inputs.length === 1, `lines=${rateBlock.inputs.length}`);
  const rateLine = rateBlock.inputs[0];
  const mIn = rateLine.byCase.find((i) => i.role === 'base')!;
  const dIn = rateLine.byCase.find((i) => i.id === 'case_down')!;
  check('input row shows the rate per case (Management base, Downside +3)', Number(mIn.value) === baseRate && Math.abs(Number(dIn.value) - (baseRate + 3)) < 1e-9,
    `mgmt=${mIn.value} down=${dIn.value}`);

  const finCost = out(rateBlock, (o) => o.key.startsWith('financing'));
  check('the rate change drives a Financing cost output (interest + IDC)', !!finCost && /interest \+ IDC/i.test(finCost.label), finCost?.label);
  if (finCost) {
    check('financing cost is a FLOW (summed in Total)', finCost.kind === 'flow');
    const facAccrued = finSnap.financing.facilities.get(tranche.id)!.interestAccrued.slice(0, N);
    check('financing cost Management actuals tie to facility.interestAccrued', seriesEqual(finCost.base.values, facAccrued));
    check('interest-rate override moves financing cost per period', nonZero(finCost.deltas.find((d) => d.id === 'case_down')!.values));
    check('financing cost prior (2025/inception) is 0 for a flow', finCost.base.prior === 0);
  }
  const bal = out(rateBlock, (o) => o.key.startsWith('balance'));
  check('the rate change drives a Debt closing balance output', !!bal, rateBlock.outputs.map((o) => o.key).join(','));
  if (bal) {
    check('debt closing balance is a STOCK (Total left blank by the UI)', bal.kind === 'stock');
    check('balance prior (2025) is the facility opening balance, not 0', Math.abs(bal.base.prior - Number(finSnap.financing.facilities.get(tranche.id)!.openingBalance)) < 1,
      `prior=${Math.round(bal.base.prior)} opening=${Math.round(Number(finSnap.financing.facilities.get(tranche.id)!.openingBalance))}`);
  }
}

// ── Debt/equity SPLIT block: ONE consolidated block (deduped), drawdown excl IDC ─
console.log('\n=== Debt/equity split dedup + drawdown excludes IDC ===');
const debtPath = 'project.financing.cashDeficitConfig.debtPct';
const equityPath = 'project.financing.cashDeficitConfig.equityPct';
const debtCases: ProjectCase[] = [
  { id: 'case_management', name: 'Management Case', role: 'base', overrides: {} },
  // withSplitPair writes BOTH halves; mirror that here.
  { id: 'case_down', name: 'Downside', role: 'scenario', overrides: { [debtPath]: 50, [equityPath]: 50 } },
];
const debtReport = buildCaseYoYReport({ baseModel: base, cases: debtCases, activeCaseId: 'case_management' });

// Dedup: exactly ONE financing-split block, keyed on the debt half; no separate equity block.
const splitBlocks = debtReport.blocks.filter((b) => b.path === debtPath || b.path === equityPath);
check('a debt/equity override produces exactly ONE block (deduped, not two)', splitBlocks.length === 1, `blocks=${debtReport.blocks.map((b) => b.path).join(' ; ')}`);
check('the consolidated block is keyed on the debt half (canonical)', splitBlocks[0]?.path === debtPath, splitBlocks[0]?.path);
check('no standalone Equity % block is emitted', !debtReport.blocks.some((b) => b.path === equityPath));

const debtBlock = debtReport.blocks.find((b) => b.path === debtPath);
check('a Debt/Equity split block exists', !!debtBlock, debtReport.blocks.map((b) => b.path).join(' ; '));
if (debtBlock) {
  check('block heading is the funding split label, not "Debt %"/"Equity %"', /Debt \/ Equity split/i.test(debtBlock.inputLabel), debtBlock.inputLabel);
  // Both halves shown once, as two input lines.
  check('the split block shows TWO input lines (debt % and equity %)', debtBlock.inputs.length === 2, `lines=${debtBlock.inputs.length}`);
  const debtLine = debtBlock.inputs.find((l) => l.path === debtPath);
  const eqLine = debtBlock.inputs.find((l) => l.path === equityPath);
  check('debt % line present: 100 (base) -> 50 (down)', !!debtLine
    && Number(debtLine!.byCase.find((i) => i.role === 'base')!.value) === Number(base.project.financing.cashDeficitConfig.debtPct)
    && Number(debtLine!.byCase.find((i) => i.id === 'case_down')!.value) === 50, debtLine ? `base=${debtLine.byCase.find((i) => i.role === 'base')!.value}` : 'missing');
  check('equity % line present: 50 (down, auto-balanced 100 - 50)', !!eqLine
    && Number(eqLine!.byCase.find((i) => i.id === 'case_down')!.value) === 50, eqLine ? `down=${eqLine.byCase.find((i) => i.id === 'case_down')!.value}` : 'missing');

  // Driven outputs once.
  const hasDrawdown = debtBlock.outputs.some((o) => o.key.startsWith('drawdown') && /drawdown/i.test(o.label));
  const hasFinancing = debtBlock.outputs.some((o) => o.key.startsWith('financing'));
  check('the split block shows BOTH debt drawdown AND financing cost rows (once)', hasDrawdown && hasFinancing,
    debtBlock.outputs.map((o) => o.label).join(' | '));

  // Drawdown is true principal, excluding capitalized IDC.
  const dd = debtBlock.outputs.find((o) => o.key.startsWith('drawdown'))!;
  const combined = computeFinancialsSnapshot(base).financing.combined;
  const span = debtReport.yearLabels.length;
  const totalDraw = combined.totalDrawdown.slice(0, span);
  const totalIdcCap = combined.totalInterestCapitalized.slice(0, span);
  check('debt drawdown ties to combined.totalDrawdown (principal series)', seriesEqual(dd.base.values, totalDraw));
  check('debt drawdown label states it excludes IDC', /excludes idc/i.test(dd.label), dd.label);
  const idcSum = totalIdcCap.reduce((a, b) => a + b, 0);
  if (idcSum > 1) {
    const inclIdc = totalDraw.map((v, i) => v + totalIdcCap[i]);
    check('debt drawdown EXCLUDES capitalized IDC (differs from draw + IDC when IDC > 0)', !seriesEqual(dd.base.values, inclIdc), `idcSum=${Math.round(idcSum)}`);
  } else {
    console.log(`  [NOTE] capitalized IDC ~0 on this fixture (idcSum=${Math.round(idcSum)}); principal-only holds trivially.`);
  }
  // Financing cost keeps IDC (interest + IDC), confirming the two rows differ in meaning.
  const fc = debtBlock.outputs.find((o) => o.key.startsWith('financing'));
  check('financing-cost row still labelled interest + IDC (unchanged)', !!fc && /interest \+ IDC/i.test(fc.label), fc?.label);
}

// ── Revenue block (unit price) ───────────────────────────────────────────────
if (unitPath) {
  const revBlock = find(unitPath);
  check('a Revenue block exists for the unit-price input', !!revBlock, report.blocks.map((b) => b.path).join(' ; '));
  const rev = out(revBlock, (o) => o.key === 'revenue');
  if (rev) {
    const upRev = computeFinancialsSnapshot(applyOverrides(base, upside.overrides)).pl.totalRevenuePerPeriod.slice(0, N);
    check('revenue actuals tie to pl.totalRevenuePerPeriod (Upside)', seriesEqual(rev.scenarios.find((s) => s.id === 'case_up')!.values, upRev));
    check('revenue is a FLOW', rev.kind === 'flow');
  }
}

// ── Endpoint-only lever + empty state ────────────────────────────────────────
const discReport = buildCaseYoYReport({ baseModel: base, cases: [
  { id: 'case_management', name: 'Management Case', role: 'base', overrides: {} },
  { id: 'case_disc', name: 'Disc', role: 'scenario', overrides: { 'project.returns.discountRate': Number(base.project?.returns?.discountRate ?? 0.1) + 0.05 } },
], activeCaseId: 'case_management' });
check('a discount-rate-only scenario produces no per-period block (endpoint lever)', discReport.blocks.length === 0, `blocks=${discReport.blocks.length}`);
const emptyReport = buildCaseYoYReport({ baseModel: base, cases: [
  { id: 'case_management', name: 'Management Case', role: 'base', overrides: {} },
  { id: 'case_empty', name: 'Empty', role: 'scenario', overrides: {} },
], activeCaseId: 'case_management' });
check('no overrides yields no blocks (empty state)', emptyReport.blocks.length === 0);

// ── Interest-rate lever: curated, overridable, flows to the comparison ───────
console.log('\n=== Interest rate lever (per facility) ===');
const curatedPaths = new Set(curatedDefaultFields(base).map((f) => f.path));
check('the effective interest-rate lever (interbank rate) is curated for the facility', curatedPaths.has(ratePath), ratePath);
check('the interest-rate component lever is NOT gated (a live lever)', inactiveLeverReason(ratePath, base) === null && nonEconomicLeverReason(ratePath, 'interbankRatePct') === null);
check('the single interestRatePct is gated when rate components are present', !!inactiveLeverReason(`financingTranches[id=${tranche.id}].interestRatePct`, base));
const cmp = buildCaseComparisonReport({ baseModel: base, cases, activeCaseId: baseCaseId(cases) });
const baseFinCost = cmp.columns.find((c) => c.role === 'base')!.values['Total Financing Cost'];
const downFinCost = cmp.columns.find((c) => c.id === 'case_down')!.values['Total Financing Cost'];
check('the interest-rate override moves Total Financing Cost in the comparison', baseFinCost != null && downFinCost != null && Math.abs(downFinCost - baseFinCost) > 1,
  `base=${Math.round(baseFinCost ?? 0)} down=${Math.round(downFinCost ?? 0)}`);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
