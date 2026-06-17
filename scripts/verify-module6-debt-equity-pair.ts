/**
 * verify-module6-debt-equity-pair.ts
 *
 * Guards the Module 6 debt/equity paired override. A funding method's debt % and
 * equity % are one split summing to 100, and the engine normalizes by
 * (debt + equity). So a scenario override that writes only debt % leaves equity %
 * stale and the change is muted, or (when equity % is 0, as on FMP RE HUB)
 * renormalized away entirely so the override does nothing. The fix auto-derives
 * the paired half (equity % = 100 - debt %) on every override + reset.
 *
 * Drives the REAL store on the LIVE FMP RE HUB snapshot and asserts:
 *   1. Overriding debt % auto-updates equity % to 100 - debt % in the merged model.
 *   2. The comparison KPIs (financing cost, equity IRR) move with the override.
 *   3. The base / Management split is never mutated.
 *   4. The override map stores BOTH halves (a consistent split).
 *   5. Resetting debt % reverts BOTH halves (no inconsistent split left behind).
 *   6. Regression pin: the OLD unpaired override (debt only) is inert on this
 *      project (equity 0 -> engine renormalizes to 100% debt), proving the pair
 *      is what makes the lever drive the model.
 *   7. Only the ACTIVE funding method's split is a live lever; inactive methods
 *      are gated with a reason (not silent dead levers).
 *
 * The fixture is gitignored live project data; skip-with-notice when absent
 * (refresh: npx tsx scripts/fetch-fmp-re-hub.ts).
 *
 * Run: npx tsx scripts/verify-module6-debt-equity-pair.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { useModule1Store, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { applyOverrides, baseCaseId } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { inactiveLeverReason } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

const FIXTURE = 'scripts/fmpReHubSnapshot.json';
if (!existsSync(FIXTURE)) {
  console.log(`[SKIP] ${FIXTURE} not present (live project data, gitignored).`);
  console.log('       Refresh it with: npx tsx scripts/fetch-fmp-re-hub.ts');
  console.log('=== Result: skipped (no fixture) ===');
  process.exit(0);
}
const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const snap = doc.snapshot as any;
const store = useModule1Store;
const method = snap.project?.financing?.fundingMethod;
console.log(`=== Module 6 debt/equity paired override (LIVE "${doc.projectName}" v${doc.versionNumber}, funding method ${method}) ===\n`);

// The active method's split config key.
const CFG_KEY = method === 1 ? 'fixedRatio' : method === 2 ? 'netFundingConfig' : method === 3 ? 'cashDeficitConfig' : 'fixedAmountConfig';
const debtPath = `project.financing.${CFG_KEY}.debtPct`;
const eqPath = `project.financing.${CFG_KEY}.equityPct`;

function kpis(): { finCost: number; eqIrr: number | null } {
  const s: any = store.getState();
  const rs = computeReturnsSnapshot(computeFinancialsSnapshot(pickModel(s) as any), s.project);
  return { finCost: Math.round(rs.developmentEconomics.totalFinancingCost), eqIrr: rs.result.fcfe.irr };
}
const split = () => {
  const cfg = (store.getState().project as any)?.financing?.[CFG_KEY] ?? {};
  return { debt: Number(cfg.debtPct), eq: Number(cfg.equityPct) };
};
const moved = (a: number, b: number) => Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));

// ── Load the live project ────────────────────────────────────────────────────
store.getState().hydrate(snap);
const baseId = baseCaseId(store.getState().cases);
const baseSplit = split();
const baseKpis = kpis();
console.log(`base split: debt ${baseSplit.debt} / equity ${baseSplit.eq}; finCost ${baseKpis.finCost}\n`);

// ── 7. Gating: active method editable; inactive methods gated ────────────────
check('active funding method debt % is a live lever (not gated)', inactiveLeverReason(debtPath, store.getState() as any) === null,
  `${debtPath} -> ${inactiveLeverReason(debtPath, store.getState() as any)}`);
for (const k of ['fixedRatio', 'netFundingConfig', 'cashDeficitConfig', 'fixedAmountConfig'].filter((x) => x !== CFG_KEY)) {
  const reason = inactiveLeverReason(`project.financing.${k}.debtPct`, store.getState() as any);
  check(`inactive method "${k}" debt % is gated with a reason (not silent)`, !!reason, `got ${reason}`);
}

// ── Add a scenario + override debt % on the active method ────────────────────
store.getState().addCase('Probe DE');
const scenId = store.getState().cases.find((c) => c.name === 'Probe DE')!.id;
store.getState().setActiveCase(scenId);
const newDebt = baseSplit.debt >= 60 ? 50 : 80; // a clear swing away from base
store.getState().setCaseFieldValue(scenId, debtPath, newDebt);

// 1. Equity auto-derives to 100 - debt.
const afterSplit = split();
check('overriding debt % auto-derives equity % = 100 - debt %', afterSplit.debt === newDebt && Math.abs(afterSplit.eq - (100 - newDebt)) < 1e-9,
  `debt=${afterSplit.debt} equity=${afterSplit.eq} (want ${newDebt}/${100 - newDebt})`);

// 2. KPIs move with the override (no manual Financing-tab edit).
const scenKpis = kpis();
check('paired debt % override moves the financing cost', moved(scenKpis.finCost, baseKpis.finCost),
  `base=${baseKpis.finCost} scen=${scenKpis.finCost}`);
check('paired debt % override moves the levered Equity IRR', baseKpis.eqIrr == null || scenKpis.eqIrr == null || moved(scenKpis.eqIrr, baseKpis.eqIrr),
  `base=${baseKpis.eqIrr} scen=${scenKpis.eqIrr}`);

// 4. The override map stores BOTH halves (consistent split).
const ov: any = store.getState().cases.find((c) => c.id === scenId)?.overrides ?? {};
check('the override map stores both debt % and equity % (consistent split)', Number(ov[debtPath]) === newDebt && Number(ov[eqPath]) === 100 - newDebt,
  JSON.stringify({ [debtPath]: ov[debtPath], [eqPath]: ov[eqPath] }));

// 3. Base / Management split never mutated.
const persisted: any = store.getState().extractPersistSnapshot();
const persistedCfg = persisted.project?.financing?.[CFG_KEY] ?? {};
check('base / Management split is NOT mutated', Number(persistedCfg.debtPct) === baseSplit.debt && Number(persistedCfg.equityPct) === baseSplit.eq,
  `persisted base ${persistedCfg.debtPct}/${persistedCfg.equityPct} vs base ${baseSplit.debt}/${baseSplit.eq}`);

// 5. Reset reverts BOTH halves.
store.getState().resetCaseFieldValue(scenId, debtPath);
const resetSplit = split();
const resetOv: any = store.getState().cases.find((c) => c.id === scenId)?.overrides ?? {};
check('resetting debt % reverts BOTH halves to base (no inconsistent split)',
  resetSplit.debt === baseSplit.debt && resetSplit.eq === baseSplit.eq && resetOv[debtPath] === undefined && resetOv[eqPath] === undefined,
  `split ${resetSplit.debt}/${resetSplit.eq}`);
check('reset restores the base financing cost exactly', kpis().finCost === baseKpis.finCost);

// 6. Regression pin: the OLD unpaired override (debt only) is muted / inert.
//    On FMP RE HUB base equity is 0, so debt-only renormalizes to 100% debt.
const unpaired = applyOverrides(snap, { [debtPath]: newDebt }); // equity stays at base
const unpairedRs = computeReturnsSnapshot(computeFinancialsSnapshot(unpaired), (unpaired as any).project);
const unpairedFin = Math.round(unpairedRs.developmentEconomics.totalFinancingCost);
const paired = applyOverrides(snap, { [debtPath]: newDebt, [eqPath]: 100 - newDebt });
const pairedRs = computeReturnsSnapshot(computeFinancialsSnapshot(paired), (paired as any).project);
const pairedFin = Math.round(pairedRs.developmentEconomics.totalFinancingCost);
check('UNPAIRED debt-only override moves the model strictly LESS than the paired one (the bug)',
  Math.abs(unpairedFin - baseKpis.finCost) < Math.abs(pairedFin - baseKpis.finCost),
  `base=${baseKpis.finCost} unpaired=${unpairedFin} paired=${pairedFin}`);
console.log(`\n  (mechanism: base ${baseSplit.debt}/${baseSplit.eq}, debt->${newDebt}: unpaired effective debt = ${(newDebt / (newDebt + baseSplit.eq) * 100).toFixed(1)}%, paired = ${newDebt}.0%)`);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
