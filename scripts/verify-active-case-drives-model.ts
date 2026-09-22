/**
 * verify-active-case-drives-model.ts
 *
 * Architectural regression guard. The selected case must drive the ENTIRE model
 * and every export, not just the Module 6 comparison. This verifier drives the
 * REAL store (hydrate -> addCase -> setActiveCase -> setCaseFieldValue ->
 * setUseScenarios) on the committed existing-operations fixture and asserts:
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
 * The fixture is scripts/fixtures/existingOperationsProject.json, committed, so
 * this runs on every machine (2026-09-21).
 *
 * Run: npx tsx scripts/verify-active-case-drives-model.ts
 */
import { readFileSync } from 'node:fs';
import { useModule1Store, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { baseCaseId } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import { buildExistingOperationsState, EXISTING_OPS_LABEL } from './fixtures/existingOperationsState';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

// THE FIXTURE IS COMMITTED (2026-09-21). This read a gitignored local copy of
// a project that has since been soft-deleted, and skipped itself when the file
// was absent, so it was green here and absent everywhere else: a verifier that
// is red on a clean clone is not a pass, and one that skips is not either. It
// now reads the committed capture of the same shape, so it runs on every
// machine and cannot be skipped.
const snap: any = buildExistingOperationsState();
const store = useModule1Store;
console.log(`=== Active case drives whole model + exports (${EXISTING_OPS_LABEL}) ===\n`);

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
// THE RULE IS "AN EXPORT FOLLOWS THE LIVE ACTIVE CASE", NOT "THE VERSION
// DEFAULT IS THE WORKING DRAFT" (2026-09-22). The 2026-06-17 defect was that
// the modal stays mounted, so BOTH its pickers froze at mount time and an
// export after a case switch rendered a stale case from a stale version. The
// fix that mattered was the case re-sync above; flipping the version default to
// CURRENT came along with it and was pinned as though it were the rule.
//
// The founder's call is that the default should be the latest SAVED version: a
// project opens read-only and stays so until the edit lock is taken, so for most
// sessions "current working draft" is the saved model wearing a label saying it
// might not be, which is the wrong thing to hand someone exporting to send out.
//
// That does NOT reopen 2026-06-17, and these checks are what hold that: the case
// is still synced on open, and the SAVED-VERSION path resolves that same case
// inside the chosen version rather than taking the version's own active case.
// So the case follows the user whichever version is picked.
check('ExportModal defaults the version to the LATEST SAVED one, once the list lands',
  /if \(!versionPickedByUser\.current && list\.length > 0\) setSelectedVersionId\(list\[0\]\.id\)/.test(exportSrc));
check('...and never overwrites a version the user picked while the list was loading',
  /versionPickedByUser\.current = true; setSelectedVersionId\(e\.target\.value\)/.test(exportSrc)
  && /versionPickedByUser\.current = false;/.test(exportSrc));
check('a saved-version export still resolves the LIVE ACTIVE CASE inside that version (the 2026-06-17 defect cannot return)',
  /const chosen = vCases\.find\(\(c\) => c\.id === selectedCaseId\)/.test(exportSrc));
check('unsaved edits are SAID so, since the default is no longer the working draft',
  /hasUnsaved && selectedVersionId !== CURRENT/.test(exportSrc)
  && exportSrc.includes('export-unsaved-hint'));
check('ExportModal export state is pickModel(store) = the live merged active-case model',
  /function liveModelFromStore\(\)[\s\S]{0,120}pickModel\(useModule1Store\.getState\(\)/.test(exportSrc));

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
