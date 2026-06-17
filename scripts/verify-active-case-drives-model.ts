/**
 * verify-active-case-drives-model.ts
 *
 * Architectural regression guard. The selected case must drive the ENTIRE model
 * and every export, not just the Module 6 comparison. This verifier drives the
 * REAL store (hydrate -> addCase -> setActiveCase -> setCaseFieldValue ->
 * setUseScenarios) on the LIVE "FMP RE HUB" project snapshot and asserts:
 *
 *   1. A MODULE OUTSIDE Module 6 (Returns / Overview, via the same
 *      computeFinancialsSnapshot -> computeReturnsSnapshot pipeline they render
 *      from) changes when a case with a real override is made active.
 *   2. The EXPORT path (the exact model ExportModal hands to the Excel and PDF
 *      generators: pickModel(store) = liveModelFromStore) reflects the active
 *      case, so Excel / PDF compute the case's numbers.
 *   3. Switching back to Management restores the base numbers EXACTLY.
 *   4. Use Scenarios = Off forces Management across the model and exports.
 *   5. The base model is never mutated: extractPersistSnapshot keeps the base
 *      fields at their base values and stores the override in the cases registry.
 *
 * A future change where the active case stops driving the live model (e.g. a
 * module or export reads baseSnapshot directly, or setActiveCase stops spreading
 * the merged model) flips one of these red.
 *
 * The fixture (scripts/fmpReHubSnapshot.json) is live project data, gitignored.
 * Skip-with-notice when absent; refresh via: npx tsx scripts/fetch-fmp-re-hub.ts
 *
 * Run: npx tsx scripts/verify-active-case-drives-model.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { useModule1Store, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { baseCaseId } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';

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
console.log(`=== Active case drives whole model + exports (LIVE "${doc.projectName}" v${doc.versionNumber}) ===\n`);

// A "module outside Module 6" reads the live store and runs the shared pipeline.
// This is exactly what Module5Returns.tsx + Overview.tsx do.
function moduleKpis(): { npv: number | null; eqIrr: number | null } {
  const s: any = store.getState();
  const rs = computeReturnsSnapshot(computeFinancialsSnapshot(pickModel(s) as any), s.project);
  return { npv: rs.result.fcff.npv, eqIrr: rs.result.fcfe.irr };
}
// The EXPORT path: the exact model ExportModal builds (liveModelFromStore =
// pickModel(store)) and hands to generateModelWorkbookBuffer / generateProjectPdf.
function exportStateKpis(): { npv: number | null; disc: number | undefined } {
  const exportState: any = pickModel(store.getState() as any); // identical to ExportModal.liveModelFromStore()
  const rs = computeReturnsSnapshot(computeFinancialsSnapshot(exportState), exportState.project);
  return { npv: rs.result.fcff.npv, disc: exportState.project?.returns?.discountRate };
}
const moved = (a: number | null, b: number | null) =>
  a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));

// ── Load the live project into the real store ────────────────────────────────
store.getState().hydrate(snap);
const baseId = baseCaseId(store.getState().cases);
const baseDisc = Number(store.getState().project?.returns?.discountRate ?? 0.1);
check('project loads with a base (Management) case active', store.getState().activeCaseId === baseId);

const baseModuleKpis = moduleKpis();
const baseExport = exportStateKpis();
check('base model computes a finite headline (NPV)', baseModuleKpis.npv != null && Number.isFinite(baseModuleKpis.npv), `npv=${baseModuleKpis.npv}`);

// ── Create a scenario with a real override (discount rate, a proven mover) ────
store.getState().addCase('Probe Case');
const scenId = store.getState().cases.find((c) => c.name === 'Probe Case')!.id;
store.getState().setActiveCase(scenId);
store.getState().setCaseFieldValue(scenId, 'project.returns.discountRate', baseDisc + 0.05);

const scenModuleKpis = moduleKpis();
const scenExport = exportStateKpis();

// 1. A module OUTSIDE Module 6 reflects the active case.
check('a non-Module-6 module (Returns/Overview) reflects the active case', moved(scenModuleKpis.npv, baseModuleKpis.npv),
  `baseNPV=${Math.round(baseModuleKpis.npv ?? 0)} scenNPV=${Math.round(scenModuleKpis.npv ?? 0)}`);
check('the same case also moves the levered Equity IRR', moved(scenModuleKpis.eqIrr, baseModuleKpis.eqIrr),
  `base=${baseModuleKpis.eqIrr} scen=${scenModuleKpis.eqIrr}`);

// 2. The EXPORT path (Excel / PDF model) reflects the active case.
check('the export model carries the active case override (discount rate)', Math.abs((scenExport.disc ?? 0) - (baseDisc + 0.05)) < 1e-9,
  `exportDisc=${scenExport.disc} want=${baseDisc + 0.05}`);
check('the export model computes the case numbers (NPV differs from base)', moved(scenExport.npv, baseExport.npv),
  `baseNPV=${Math.round(baseExport.npv ?? 0)} scenNPV=${Math.round(scenExport.npv ?? 0)}`);

// 5. Base is never mutated: extractPersistSnapshot keeps base at base values and
//    stores the override in the cases registry.
const persisted: any = store.getState().extractPersistSnapshot();
check('base model is NOT mutated (persisted base keeps the base discount rate)', Math.abs(Number(persisted.project?.returns?.discountRate) - baseDisc) < 1e-9,
  `persistedBaseDisc=${persisted.project?.returns?.discountRate} base=${baseDisc}`);
check('the override is stored in the cases registry (not the base)', Number((persisted.cases.find((c: any) => c.id === scenId)?.overrides ?? {})['project.returns.discountRate']) === baseDisc + 0.05);

// 3. Switching back to Management restores the base numbers EXACTLY.
store.getState().setActiveCase(baseId);
const backKpis = moduleKpis();
check('switching back to Management restores the base numbers exactly', backKpis.npv === baseModuleKpis.npv && backKpis.eqIrr === baseModuleKpis.eqIrr,
  `base=${baseModuleKpis.npv} back=${backKpis.npv}`);

// 4. Use Scenarios = Off forces Management across the model + exports.
store.getState().setActiveCase(scenId);
check('precondition: scenario is active before turning scenarios off', store.getState().activeCaseId === scenId);
store.getState().setUseScenarios(false);
check('Use Scenarios = Off forces the Management (base) case active', store.getState().activeCaseId === baseId);
const offKpis = moduleKpis();
const offExport = exportStateKpis();
check('Off: the model reverts to Management numbers', offKpis.npv === baseModuleKpis.npv,
  `base=${baseModuleKpis.npv} off=${offKpis.npv}`);
check('Off: the export model is the Management base (base discount rate)', Math.abs((offExport.disc ?? 0) - baseDisc) < 1e-9,
  `offDisc=${offExport.disc} base=${baseDisc}`);
check('Off: scenario overrides are preserved (not deleted)', Number((store.getState().cases.find((c) => c.id === scenId)?.overrides ?? {})['project.returns.discountRate']) === baseDisc + 0.05);

// ── Source guards: the Export modal must DEFAULT to the live active case ──────
// The modal stays mounted, so without an on-open sync its case / version picks
// freeze at mount-time and an export after a case switch would render the wrong
// case. These markers fail red if that sync is removed.
console.log('\n=== Export modal default follows the live active case (source markers) ===');
const exportSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx', 'utf8');
check('ExportModal syncs the selected case to the live active case on open',
  /setSelectedCaseId\(\s*useModule1Store\.getState\(\)\.activeCaseId\s*\)/.test(exportSrc));
check('ExportModal defaults the export to the current working draft on open (not a stale saved version)',
  /if \(!open\) return;[\s\S]{0,200}setSelectedVersionId\(CURRENT\)/.test(exportSrc));
check('ExportModal no longer force-defaults to the latest saved version',
  !/setSelectedVersionId\(list\.length \? list\[0\]\.id : CURRENT\)/.test(exportSrc));
check('ExportModal export state is pickModel(store) = the live merged active-case model',
  /function liveModelFromStore\(\)[\s\S]{0,120}pickModel\(useModule1Store\.getState\(\)/.test(exportSrc));

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
