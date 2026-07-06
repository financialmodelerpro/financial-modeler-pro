/**
 * verify-view-mode-lock.ts
 *
 * Behavioral guard for the REFM view-mode lock. View mode must block ONLY the
 * controls that change model numbers (the model-mutating store setters) and
 * allow ALL view/navigation. This drives the real store (not a source scan):
 *
 *   viewLocked = true  -> model-mutating setters are NO-OPS (setProject, addPhase,
 *                         updateAsset, updateFinancingTranche, setOverridePath, ...)
 *                      -> navigation setters STILL WORK (setActivePhaseId /
 *                         setActiveAssetId / setActiveCase)
 *                      -> hydrate STILL WORKS (the load path is never gated)
 *   viewLocked = false -> every setter works (edit mode, unchanged behavior)
 *
 * Run:  npx tsx scripts/verify-view-mode-lock.ts
 *
 * No em dashes in this file.
 */
import { useModule1Store } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

const s = () => useModule1Store.getState();

// ── Baseline: edit mode (viewLocked false) ──────────────────────────────────
s().setViewLocked(false);
s().setProject({ name: 'EDIT_BASELINE' });
check('edit mode: setProject applies', s().project.name === 'EDIT_BASELINE');

const phasesBefore = s().phases.length;
const clonePhase = { ...s().phases[0], id: 'vm-test-phase' };
s().addPhase(clonePhase);
check('edit mode: addPhase applies', s().phases.length === phasesBefore + 1);
s().removePhase('vm-test-phase');
check('edit mode: removePhase applies', s().phases.length === phasesBefore);

// ── View mode: model-mutating setters must NO-OP ────────────────────────────
s().setViewLocked(true);

s().setProject({ name: 'VIEW_BLOCKED' });
check('view mode: setProject is a no-op', s().project.name === 'EDIT_BASELINE',
  `name=${s().project.name}`);

const phasesLocked = s().phases.length;
s().addPhase({ ...s().phases[0], id: 'vm-test-phase-2' });
check('view mode: addPhase is a no-op', s().phases.length === phasesLocked);

// updateAsset carries the project-type change; test it when an asset is seeded
// (clone-based, so no fragile object construction).
const firstAsset = s().assets[0];
if (firstAsset) {
  const beforeName = firstAsset.name;
  s().updateAsset(firstAsset.id, { name: 'VIEW_ASSET_BLOCKED' });
  check('view mode: updateAsset is a no-op', s().assets[0].name === beforeName);
}

// addFinancingTranche (debt) is tested by cloning a seeded tranche when present.
const firstTranche = s().financingTranches[0];
if (firstTranche) {
  const tranchesLocked = s().financingTranches.length;
  s().addFinancingTranche({ ...firstTranche, id: 'vm-test-tranche' });
  check('view mode: addFinancingTranche is a no-op', s().financingTranches.length === tranchesLocked);
}

const casesLocked = s().cases.length;
s().addCase('view-blocked-case');
check('view mode: addCase is a no-op', s().cases.length === casesLocked);

s().setOverridePath('project.name', 'VIEW_OVERRIDE_BLOCKED');
check('view mode: setOverridePath is a no-op', s().project.name === 'EDIT_BASELINE');

// ── View mode: navigation setters must STILL WORK ───────────────────────────
const targetPhase = s().phases[0]?.id ?? 'p1';
s().setActivePhaseId(targetPhase);
check('view mode: setActivePhaseId WORKS (navigation)', s().activePhaseId === targetPhase);

s().setActiveAssetId('vm-nav-asset');
check('view mode: setActiveAssetId WORKS (navigation)', s().activeAssetId === 'vm-nav-asset');

const baseCase = s().cases.find((c) => c.role === 'base') ?? s().cases[0];
if (baseCase) {
  s().setActiveCase(baseCase.id);
  check('view mode: setActiveCase WORKS (viewing a scenario)', s().activeCaseId === baseCase.id);
}

// ── View mode: hydrate (load path) must STILL WORK ──────────────────────────
const snap = s().extractPersistSnapshot();
s().hydrate({ ...snap, project: { ...snap.project, name: 'HYDRATED_IN_VIEW' } });
check('view mode: hydrate WORKS (load path never gated)', s().project.name === 'HYDRATED_IN_VIEW');

// ── Back to edit mode: setters work again ───────────────────────────────────
s().setViewLocked(false);
s().setProject({ name: 'EDIT_AGAIN' });
check('edit mode restored: setProject applies again', s().project.name === 'EDIT_AGAIN');

console.log(`\n[verify-view-mode-lock] ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
