/**
 * module1-store.ts
 *
 * Zustand store for REFM Module 1 state, introduced in Phase M1.R.
 *
 * Replaces the 30+ useState hooks previously declared in
 * RealEstatePlatform.tsx. Lives at lib/state/ per Architecture sheet
 * section 14 ("REFM internal structure ... lib/state/ (Zustand store
 * after refactor)").
 *
 * Wiring is staged across the M1.R commits:
 *   - Commit 1 (this commit): types + store skeleton, NOT yet consumed
 *     by the React component. Snapshot diff stays bit-identical because
 *     no behavior changes.
 *   - Commit 4: RealEstatePlatform.tsx replaces useState hooks with
 *     selector subscriptions to this store.
 *
 * Selectors are deliberately small: each one returns a single primitive
 * or a stable-reference slice. Components subscribe to the slices they
 * read so re-renders stay localized.
 */

import { create } from 'zustand';
import type {
  ModelType,
  ProjectType,
  CostInputMode,
  FinancingMode,
  RepaymentMethod,
  LandParcel,
} from '@core/types/project.types';
import type { AssetClass, Phase, CostLine, MasterHolding, SubProject, SubUnit } from './module1-types';
import {
  DEFAULT_SUB_PROJECT_ID,
  DEFAULT_PHASE_ID,
  makeDefaultPhase,
  makeDefaultSubProject,
  makeDefaultMasterHolding,
} from './module1-types';

// ── Store shape ─────────────────────────────────────────────────────────────
export interface Module1Store {
  // Project metadata
  projectName: string;
  projectType: ProjectType;
  country: string;
  currency: string;
  modelType: ModelType;
  projectStart: string;

  // ── 5-layer hierarchy (Phase M1.5; Architecture sheet section 1) ──
  // Master Holding is optional (singleton). enabled=false hides the
  // Hierarchy panel for it. Single-project users keep this disabled.
  masterHolding: MasterHolding;
  // Sub-Projects: 1..N. Default new project has 1; Hierarchy tab adds
  // more for fund-style projects. Currency is per-sub-project (v1
  // currency rule from Architecture section 3).
  subProjects: SubProject[];
  // Sub-Units: per-asset inventory. Empty until user populates from
  // the Hierarchy tab.
  subUnits: SubUnit[];
  // Active selectors: which sub-project + phase the non-Hierarchy tabs
  // operate on. UI-only state (not part of HydrateSnapshot below;
  // never persisted to disk so opening a saved project resets to the
  // first available sub-project + phase).
  activeSubProjectId: string;
  activePhaseId: string;

  // Phases (replaces single constructionPeriods / operationsPeriods / overlapPeriods)
  phases: Phase[];

  // Land
  landParcels: LandParcel[];
  projectRoadsPct: number;
  projectFAR: number;
  projectNonEnclosedPct: number;

  // Assets (replaces the 3 hardcoded asset scalars + show flags)
  assets: AssetClass[];

  // Costs (flat list, keyed by assetId; replaces 3 parallel cost arrays)
  costs: CostLine[];
  costInputMode: CostInputMode;
  nextCostId: number;

  // V14 stage / scope / dev-fee maps (keyed by cost.id, kept global per
  // legacy semantics — see RealEstatePlatform.tsx commentary on cost id
  // collisions across assets being intentional in V14).
  costStage: Record<number, number>;
  costScope: Record<number, string>;
  costDevFeeMode: Record<number, string>;
  allocBasis: 'direct_cost' | 'gfa';

  // Financing
  interestRate: number;
  financingMode: FinancingMode;
  globalDebtPct: number;
  capitalizeInterest: boolean;
  repaymentPeriods: number;
  repaymentMethod: RepaymentMethod;
  lineRatios: Record<string, number>;

  // Bulk setters
  setProjectMeta: (patch: Partial<Pick<Module1Store,
    'projectName' | 'projectType' | 'country' | 'currency' | 'modelType' | 'projectStart'>>) => void;
  setLand: (patch: Partial<Pick<Module1Store,
    'landParcels' | 'projectRoadsPct' | 'projectFAR' | 'projectNonEnclosedPct'>>) => void;
  setFinancing: (patch: Partial<Pick<Module1Store,
    'interestRate' | 'financingMode' | 'globalDebtPct' | 'capitalizeInterest' |
    'repaymentPeriods' | 'repaymentMethod' | 'lineRatios'>>) => void;

  // Asset actions
  setAssets: (assets: AssetClass[]) => void;
  updateAsset: (id: string, patch: Partial<AssetClass>) => void;
  addAsset: (asset: AssetClass) => void;
  removeAsset: (id: string) => void;

  // Phase actions
  setPhases: (phases: Phase[]) => void;
  updatePhase: (id: string, patch: Partial<Phase>) => void;
  addPhase: (phase: Phase) => void;
  removePhase: (id: string) => void;

  // Master Holding actions (singleton — toggle enabled to show / hide)
  setMasterHolding: (mh: MasterHolding) => void;
  updateMasterHolding: (patch: Partial<MasterHolding>) => void;

  // Sub-Project actions
  setSubProjects: (subProjects: SubProject[]) => void;
  addSubProject: (subProject: SubProject) => void;
  updateSubProject: (id: string, patch: Partial<SubProject>) => void;
  removeSubProject: (id: string) => void;

  // Sub-Unit actions
  setSubUnits: (subUnits: SubUnit[]) => void;
  addSubUnit: (subUnit: SubUnit) => void;
  updateSubUnit: (id: string, patch: Partial<SubUnit>) => void;
  removeSubUnit: (id: string) => void;

  // Active-selection actions (UI-only; not persisted)
  setActiveSubProjectId: (id: string) => void;
  setActivePhaseId: (id: string) => void;

  // Cost actions
  setCosts: (costs: CostLine[]) => void;
  setCostsForAsset: (assetId: string, costs: CostLine[]) => void;
  setCostInputMode: (mode: CostInputMode) => void;
  setNextCostId: (n: number) => void;
  setCostStage: (m: Record<number, number>) => void;
  setCostScope: (m: Record<number, string>) => void;
  setCostDevFeeMode: (m: Record<number, string>) => void;
  setAllocBasis: (b: 'direct_cost' | 'gfa') => void;

  // Wholesale replacement (used by load-version + migrator)
  hydrate: (snapshot: HydrateSnapshot) => void;
}

// ── Hydration shape ────────────────────────────────────────────────────────
// The project-state slice of the store. Persisted to disk on save and
// restored on load. activeSubProjectId / activePhaseId are intentionally
// excluded — they are UI-only and reset to the first available
// sub-project / phase whenever a snapshot loads.
export type HydrateSnapshot = Pick<Module1Store,
  | 'projectName' | 'projectType' | 'country' | 'currency' | 'modelType' | 'projectStart'
  | 'masterHolding' | 'subProjects' | 'subUnits'
  | 'phases' | 'landParcels' | 'projectRoadsPct' | 'projectFAR' | 'projectNonEnclosedPct'
  | 'assets' | 'costs' | 'costInputMode' | 'nextCostId'
  | 'costStage' | 'costScope' | 'costDevFeeMode' | 'allocBasis'
  | 'interestRate' | 'financingMode' | 'globalDebtPct' | 'capitalizeInterest'
  | 'repaymentPeriods' | 'repaymentMethod' | 'lineRatios'
>;

// ── Defaults ────────────────────────────────────────────────────────────────
// Brand-new project defaults (post Phase M1.5/5): 1 SubProject + 1
// Phase + ZERO assets. The legacy 3-asset seed is gone — the Hierarchy
// tab is now the canonical place to add the project's first assets, and
// RealEstatePlatform routes new projects (assets.length === 0) onto it
// as the default landing tab. Existing v2 / v3 snapshots still
// hydrate with their preserved 3-asset shape via the migrator.
export const DEFAULT_MODULE1_STATE: HydrateSnapshot = {
  projectName: 'Skyline',
  projectType: 'mixed-use',
  country: 'Saudi Arabia',
  currency: 'SAR',
  modelType: 'annual',
  projectStart: '2025-01-01',

  masterHolding: makeDefaultMasterHolding(),
  subProjects:   [makeDefaultSubProject('Skyline', 'SAR')],
  subUnits:      [],

  phases: [makeDefaultPhase(DEFAULT_SUB_PROJECT_ID, 4, 5, 0)],

  landParcels: [
    { id: 1, name: 'Land 1', area: 100000, rate: 500, cashPct: 60, inKindPct: 40 },
  ],
  projectRoadsPct: 10,
  projectFAR: 1.5,
  projectNonEnclosedPct: 0,

  assets: [],
  costs: [],
  costInputMode: 'separate',
  nextCostId: 100,

  costStage: {},
  costScope: {},
  costDevFeeMode: {},
  allocBasis: 'direct_cost',

  interestRate: 7.5,
  financingMode: 'fixed',
  globalDebtPct: 60,
  capitalizeInterest: false,
  repaymentPeriods: 5,
  repaymentMethod: 'fixed',
  lineRatios: {},
};

// ── Store factory ──────────────────────────────────────────────────────────
// Exposed as a factory rather than a singleton so unit tests can mint a
// fresh store per assertion. Production code reads `useModule1Store`.
export function createModule1Store() {
  return create<Module1Store>((set) => ({
    ...DEFAULT_MODULE1_STATE,

    // UI-only active selectors (not part of HydrateSnapshot).
    activeSubProjectId: DEFAULT_SUB_PROJECT_ID,
    activePhaseId:      DEFAULT_PHASE_ID,

    setProjectMeta: (patch) => set(patch),
    setLand:        (patch) => set(patch),
    setFinancing:   (patch) => set(patch),

    setAssets:    (assets) => set({ assets }),
    updateAsset:  (id, patch) => set((s) => ({
      assets: s.assets.map(a => (a.id === id ? { ...a, ...patch } : a)),
    })),
    addAsset:     (asset) => set((s) => ({ assets: [...s.assets, asset] })),
    removeAsset:  (id) => set((s) => ({
      assets:   s.assets.filter(a => a.id !== id),
      costs:    s.costs.filter(c => c.assetId !== id),
      subUnits: s.subUnits.filter(u => u.assetId !== id),
    })),

    setPhases:    (phases) => set({ phases }),
    updatePhase:  (id, patch) => set((s) => ({
      phases: s.phases.map(p => (p.id === id ? { ...p, ...patch } : p)),
    })),
    addPhase:     (phase) => set((s) => ({ phases: [...s.phases, phase] })),
    removePhase:  (id) => set((s) => ({
      phases: s.phases.filter(p => p.id !== id),
      // Cascading cleanup: assets bound to the deleted phase are
      // dropped (and their costs with them); costs that referenced
      // the phase via phaseId become global to the sub-project (the
      // phaseId is cleared rather than the line being deleted, so
      // phase-removal preserves cost data the user has entered).
      assets: s.assets.filter(a => a.phaseId !== id),
      costs:  s.costs
        .filter(c => !s.assets.some(a => a.id === c.assetId && a.phaseId === id))
        .map(c => (c.phaseId === id ? { ...c, phaseId: undefined } : c)),
    })),

    setMasterHolding:    (mh) => set({ masterHolding: mh }),
    updateMasterHolding: (patch) => set((s) => ({ masterHolding: { ...s.masterHolding, ...patch } })),

    setSubProjects:   (subProjects) => set({ subProjects }),
    addSubProject:    (subProject) => set((s) => ({ subProjects: [...s.subProjects, subProject] })),
    updateSubProject: (id, patch) => set((s) => ({
      subProjects: s.subProjects.map(sp => (sp.id === id ? { ...sp, ...patch } : sp)),
    })),
    removeSubProject: (id) => set((s) => ({
      subProjects: s.subProjects.filter(sp => sp.id !== id),
      // Cascade: drop phases / assets / costs / sub-units owned by
      // the removed sub-project. Active selectors that pointed into
      // the removed sub-project get reset to the first remaining one
      // (or the default ids if no sub-projects remain — UI must
      // render an empty-state in that case).
      phases:   s.phases.filter(p => p.subProjectId !== id),
      assets:   s.assets.filter(a => a.subProjectId !== id),
      costs:    s.costs.filter(c => c.subProjectId !== id),
      subUnits: s.subUnits.filter(u => {
        const owningAsset = s.assets.find(a => a.id === u.assetId);
        return owningAsset ? owningAsset.subProjectId !== id : true;
      }),
      activeSubProjectId: s.activeSubProjectId === id
        ? (s.subProjects.find(sp => sp.id !== id)?.id ?? DEFAULT_SUB_PROJECT_ID)
        : s.activeSubProjectId,
    })),

    setSubUnits:    (subUnits) => set({ subUnits }),
    addSubUnit:     (subUnit) => set((s) => ({ subUnits: [...s.subUnits, subUnit] })),
    updateSubUnit:  (id, patch) => set((s) => ({
      subUnits: s.subUnits.map(u => (u.id === id ? { ...u, ...patch } : u)),
    })),
    removeSubUnit:  (id) => set((s) => ({ subUnits: s.subUnits.filter(u => u.id !== id) })),

    setActiveSubProjectId: (id) => set({ activeSubProjectId: id }),
    setActivePhaseId:      (id) => set({ activePhaseId: id }),

    setCosts:           (costs) => set({ costs }),
    setCostsForAsset:   (assetId, costs) => set((s) => ({
      costs: [...s.costs.filter(c => c.assetId !== assetId), ...costs],
    })),
    setCostInputMode:   (mode) => set({ costInputMode: mode }),
    setNextCostId:      (n) => set({ nextCostId: n }),
    setCostStage:       (m) => set({ costStage: m }),
    setCostScope:       (m) => set({ costScope: m }),
    setCostDevFeeMode:  (m) => set({ costDevFeeMode: m }),
    setAllocBasis:      (b) => set({ allocBasis: b }),

    hydrate: (snapshot) => set(snapshot),
  }));
}

export const useModule1Store = createModule1Store();

// ── Selectors ──────────────────────────────────────────────────────────────
// Use these from components instead of pulling the whole store, so that
// re-renders stay scoped to the slice the component actually reads.
export const selectVisibleAssets = (s: Module1Store): AssetClass[] =>
  s.assets.filter(a => a.visible);

export const selectAssetById = (id: string) => (s: Module1Store): AssetClass | undefined =>
  s.assets.find(a => a.id === id);

export const selectCostsForAsset = (assetId: string) => (s: Module1Store): CostLine[] =>
  s.costs.filter(c => c.assetId === assetId);

export const selectCostsForAssetAndPhase = (assetId: string, phaseId?: string) => (s: Module1Store): CostLine[] =>
  s.costs.filter(c => c.assetId === assetId && (phaseId === undefined || c.phaseId === undefined || c.phaseId === phaseId));

export const selectActivePhase = (s: Module1Store): Phase | undefined => s.phases[0];

// Single-phase scalars. Until Module1Timeline gains a multi-phase editor
// the legacy code path relies on phase[0]'s scalars; multi-phase totals
// will need their own selectors when phases[].length > 1.
export const selectActiveConstructionPeriods = (s: Module1Store): number =>
  s.phases[0]?.constructionPeriods ?? 0;

export const selectActiveOperationsPeriods = (s: Module1Store): number =>
  s.phases[0]?.operationsPeriods ?? 0;

export const selectActiveOverlapPeriods = (s: Module1Store): number =>
  s.phases[0]?.overlapPeriods ?? 0;

// ── Multi-asset rendering selectors ────────────────────────────────────────
// Used by Module1Costs / Module1Financing once they migrate from
// hardcoded 3-asset rendering to data-driven iteration over visible
// assets. Until that tab refactor lands, RealEstatePlatform.tsx still
// derives per-asset slices manually for backward-compat with the tab
// prop interfaces.

// Returns visible assets in store order (insertion order). Stable
// reference per render; pair with useShallow if components subscribe
// to derived shapes that change frequently.
export const selectVisibleAssetsOrdered = (s: Module1Store): AssetClass[] =>
  s.assets.filter((a) => a.visible);

// Returns a Record mapping asset id to its filtered cost lines. Useful
// for tabs that need O(1) per-asset lookups while iterating
// visibleAssets.
export const selectCostsByAsset = (s: Module1Store): Record<string, CostLine[]> => {
  const out: Record<string, CostLine[]> = {};
  for (const c of s.costs) {
    (out[c.assetId] ??= []).push(c);
  }
  return out;
};

// ── Hierarchy selectors (Phase M1.5) ───────────────────────────────────────
export const selectActiveSubProject = (s: Module1Store): SubProject | undefined =>
  s.subProjects.find(sp => sp.id === s.activeSubProjectId);

export const selectPhasesForSubProject = (subProjectId: string) => (s: Module1Store): Phase[] =>
  s.phases.filter(p => p.subProjectId === subProjectId);

export const selectAssetsForPhase = (phaseId: string) => (s: Module1Store): AssetClass[] =>
  s.assets.filter(a => a.phaseId === phaseId);

export const selectAssetsForSubProject = (subProjectId: string) => (s: Module1Store): AssetClass[] =>
  s.assets.filter(a => a.subProjectId === subProjectId);

export const selectSubUnitsForAsset = (assetId: string) => (s: Module1Store): SubUnit[] =>
  s.subUnits.filter(u => u.assetId === assetId);

// Costs scoped to the active phase: includes phase-specific costs (phaseId
// matches) AND sub-project-global costs (phaseId undefined). Used by the
// non-Hierarchy tabs once they migrate to phase context (M1.5/11).
export const selectCostsForActivePhase = (s: Module1Store): CostLine[] => {
  const subProjectAssetIds = new Set(
    s.assets.filter(a => a.subProjectId === s.activeSubProjectId).map(a => a.id)
  );
  return s.costs.filter(c =>
    subProjectAssetIds.has(c.assetId) &&
    (c.phaseId === undefined || c.phaseId === s.activePhaseId)
  );
};
