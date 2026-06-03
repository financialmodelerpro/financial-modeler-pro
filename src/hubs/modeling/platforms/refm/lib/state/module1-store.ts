/**
 * module1-store.ts (v6 schema)
 *
 * Phase M2.0 (2026-05-06): v5 spec rebuild (flat hierarchy).
 * Phase M2.0c (2026-05-06): cost-line catalog opens up + financing
 * matrix expands; the store API switches from `(key, phaseId)` lookup
 * to `(lineId)` lookup since lineIds are now globally unique.
 *
 * Flat hierarchy:
 *   project + phases[] + parcels[] + assets[] + subUnits[] +
 *   costLines[] + costOverrides[] + financingTranches[] +
 *   equityContributions[] + landAllocationMode
 *
 * Selectors live alongside the store. Cascade rules on remove* are
 * enforced here so callers never have to remember which children a
 * parent owns.
 */

import { create } from 'zustand';
import type {
  Project,
  Phase,
  Parcel,
  Asset,
  SubUnit,
  CostLine,
  CostOverride,
  FinancingTranche,
  EquityContribution,
  LandAllocationMode,
  ProjectCase,
} from './module1-types';
import {
  DEFAULT_PHASE_ID,
  makeDefaultProject,
  makeDefaultPhase,
  makeDefaultParcel,
  makeDefaultCostLines,
  makeCompanionAsset,
  makeCompanionSubUnit,
  makeDefaultFinancingTranche,
} from './module1-types';
import {
  applyOverrides,
  buildOverrides,
  seedCases,
  baseCaseId,
  normaliseCases,
} from '../cases/applyOverrides';

// ── Project-axis array shift helpers ────────────────────────────────────────
// REMOVED 2026-05-20: the per-phase-date-change cascade was disabled because
// it caused two data-corruption bugs:
//   (1) lossy shifts clobbered the first N entries of axis-indexed arrays;
//   (2) opex line YoY rates + opex defaultIndexation + Pass 2a apDaysOverride
//       were never covered by the shift, so they ended up half-aligned to
//       the old axis origin while the rest of the model aligned to the new.
// The cascade helpers (shiftArray / shiftIfArray / shiftAssetPerPeriodArrays)
// have been deleted along with the cascade call site in updatePhase below.
// User inputs are now preserved verbatim on phase-date change; if a future
// pass adds a "Re-align inputs to new calendar" feature, it should be an
// explicit opt-in (button + diff preview), not an implicit setter cascade.

// ── Store shape ─────────────────────────────────────────────────────────────
export interface Module1Store {
  // Project meta
  project: Project;

  // Phases
  phases: Phase[];

  // Land
  parcels: Parcel[];
  landAllocationMode: LandAllocationMode;

  // Assets + sub-units
  assets: Asset[];
  subUnits: SubUnit[];

  // Costs (per-phase project-level lines + per-asset overrides)
  costLines: CostLine[];
  costOverrides: CostOverride[];

  // Financing
  financingTranches: FinancingTranche[];
  equityContributions: EquityContribution[];

  // Pass 43 (2026-05-14): keys of one-shot migrations already applied
  // to this snapshot. resolveBanner() short-circuits any banner whose
  // key is in this list, so a migration notice fires exactly once
  // per project across reloads (assuming user saves at least once).
  migrationsApplied: string[];

  // ── Scenario / case management (2026-06-03) ──
  // The top-level model fields above always hold the ACTIVE case's effective
  // (merged) model, so every component + setter is case-agnostic. `cases` is
  // the registry (Management base + scenario cases), `activeCaseId` the one
  // being viewed/edited, and `baseSnapshot` the Management/base model that
  // scenario overrides are applied to. Persistence flushes the active case
  // into the registry via extractPersistSnapshot().
  cases: ProjectCase[];
  activeCaseId: string;
  baseSnapshot: HydrateSnapshot;

  // UI-only active selectors (not persisted)
  activePhaseId: string;
  activeAssetId: string | null;

  // ── Setters ──
  setProject: (patch: Partial<Project>) => void;
  setLandAllocationMode: (mode: LandAllocationMode) => void;

  setPhases: (phases: Phase[]) => void;
  addPhase: (phase: Phase) => void;
  updatePhase: (id: string, patch: Partial<Phase>) => void;
  removePhase: (id: string) => void;

  setParcels: (parcels: Parcel[]) => void;
  addParcel: (parcel: Parcel) => void;
  updateParcel: (id: string, patch: Partial<Parcel>) => void;
  removeParcel: (id: string) => void;

  setAssets: (assets: Asset[]) => void;
  addAsset: (asset: Asset) => void;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  removeAsset: (id: string) => void;

  setSubUnits: (subUnits: SubUnit[]) => void;
  addSubUnit: (subUnit: SubUnit) => void;
  updateSubUnit: (id: string, patch: Partial<SubUnit>) => void;
  removeSubUnit: (id: string) => void;

  setCostLines: (costLines: CostLine[]) => void;
  addCostLine: (costLine: CostLine) => void;
  updateCostLine: (id: string, patch: Partial<CostLine>) => void;
  removeCostLine: (id: string) => void;
  setCostOverride: (override: CostOverride) => void;
  removeCostOverride: (assetId: string, lineId: string) => void;

  setFinancingTranches: (tranches: FinancingTranche[]) => void;
  addFinancingTranche: (tranche: FinancingTranche) => void;
  updateFinancingTranche: (id: string, patch: Partial<FinancingTranche>) => void;
  removeFinancingTranche: (id: string) => void;

  setEquityContributions: (contribs: EquityContribution[]) => void;
  addEquityContribution: (contrib: EquityContribution) => void;
  updateEquityContribution: (id: string, patch: Partial<EquityContribution>) => void;
  removeEquityContribution: (id: string) => void;

  setActivePhaseId: (id: string) => void;
  setActiveAssetId: (id: string | null) => void;

  // ── Case management ──
  /** Switch the active case: flushes the current case's edits into the
   *  registry, then loads the target case's effective model into the store. */
  setActiveCase: (caseId: string) => void;
  /** Add a new scenario case (override-only, empty overrides). */
  addCase: (name?: string) => void;
  renameCase: (caseId: string, name: string) => void;
  /** Remove a scenario case (the base case cannot be removed). */
  removeCase: (caseId: string) => void;
  /** Clear ALL overrides on a scenario case (reset it fully to base). */
  clearCaseOverrides: (caseId: string) => void;
  /** Reset one overridden field (by diff path) on the active scenario to base. */
  resetOverridePath: (path: string) => void;
  /** Build the persisted snapshot: base model fields + flushed cases + activeCaseId. */
  extractPersistSnapshot: () => HydrateSnapshot;

  hydrate: (snapshot: HydrateSnapshot) => void;
}

// ── Hydration shape ────────────────────────────────────────────────────────
// Persisted slice. Active selectors are excluded.
export type HydrateSnapshot = Pick<Module1Store,
  | 'project'
  | 'phases'
  | 'parcels'
  | 'landAllocationMode'
  | 'assets'
  | 'subUnits'
  | 'costLines'
  | 'costOverrides'
  | 'financingTranches'
  | 'equityContributions'
  | 'migrationsApplied'
> & {
  // Scenario cases ride along in the persisted snapshot (versioned together).
  // Optional so legacy snapshots without them stay valid; hydrate auto-seeds.
  // The top-level model fields above represent the BASE (Management) model in
  // the persisted form; the live store holds the active case's merged model.
  cases?: ProjectCase[];
  activeCaseId?: string;
};

// The model-only fields (everything a base/effective snapshot carries, minus
// the case metadata). Used to pick the base model out of the live store.
const MODEL_KEYS = [
  'project', 'phases', 'parcels', 'landAllocationMode', 'assets', 'subUnits',
  'costLines', 'costOverrides', 'financingTranches', 'equityContributions',
  'migrationsApplied',
] as const;

/** Pick the model-only snapshot (no case metadata) from a store-like object. */
function pickModel(s: Record<string, unknown>): HydrateSnapshot {
  const out = {} as HydrateSnapshot;
  for (const k of MODEL_KEYS) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

// P10-Fix 4 (2026-05-12): sub-unit -> companion bookkeeper. Recomputes
// `unitsFromParent` on every companion asset based on its parent's
// current Sellable sub-unit count. Returns a new assets array if any
// companion needs updating; otherwise returns the input array
// unchanged so React.memo / Zustand identity checks short-circuit.
function syncCompanionUnits(assets: Asset[], subUnits: SubUnit[]): Asset[] {
  const companions = assets.filter((a) => a.isCompanion && a.parentAssetId);
  if (companions.length === 0) return assets;
  let changed = false;
  const next = assets.map((a) => {
    if (!a.isCompanion || !a.parentAssetId) return a;
    const sellableUnits = subUnits
      .filter((u) => u.assetId === a.parentAssetId && u.category === 'Sellable')
      .reduce((sum, u) => sum + Math.max(0, u.metricValue), 0);
    if ((a.unitsFromParent ?? 0) === sellableUnits) return a;
    changed = true;
    return { ...a, unitsFromParent: sellableUnits };
  });
  return changed ? next : assets;
}

// T2-Fix 5c (2026-05-12): companion sub-unit mirror sync. For each
// companion (Operate) asset, ensures its sub-unit list mirrors the
// parent's Sellable sub-units one-for-one. ADR is preserved by
// matching parentSubUnitId; rows whose parent vanished are dropped;
// rows for newly added parent Sellables get a fresh companion shadow.
// Returns a new subUnits array only if a change is required.
function syncCompanionSubUnits(assets: Asset[], subUnits: SubUnit[]): SubUnit[] {
  const companions = assets.filter((a) => a.isCompanion && a.parentAssetId);
  if (companions.length === 0) return subUnits;
  let changed = false;
  let working = subUnits;
  for (const companion of companions) {
    const parentSellables = subUnits.filter(
      (u) => u.assetId === companion.parentAssetId && u.category === 'Sellable',
    );
    const parentIds = new Set(parentSellables.map((u) => u.id));
    const existingCompanionSubs = working.filter((u) => u.assetId === companion.id);
    // Drop existing companion sub-units whose parent is gone OR are not mirrors.
    const adrByParentId = new Map<string, number>();
    for (const cs of existingCompanionSubs) {
      if (cs.parentSubUnitId && cs.startingAdr !== undefined) {
        adrByParentId.set(cs.parentSubUnitId, cs.startingAdr);
      }
    }
    // Build target set: one mirror per parent Sellable, ordered to match parent.
    const targetMirrors = parentSellables.map((parentSub) => {
      const preservedAdr = adrByParentId.get(parentSub.id);
      const existing = existingCompanionSubs.find((u) => u.parentSubUnitId === parentSub.id);
      const next = makeCompanionSubUnit(parentSub, companion.id, existing?.startingAdr ?? preservedAdr);
      // Preserve operate-only fields if user set them.
      if (existing) {
        return {
          ...next,
          occupancyPct: existing.occupancyPct,
          operatingMargin: existing.operatingMargin,
        };
      }
      return next;
    });
    // Replace this companion's sub-units in the working list.
    const before = existingCompanionSubs;
    const sameLength = before.length === targetMirrors.length;
    const sameContents = sameLength && before.every((b, i) => {
      const t = targetMirrors[i]!;
      return b.id === t.id
        && b.name === t.name
        && b.metricValue === t.metricValue
        && b.unitPrice === t.unitPrice
        && b.startingAdr === t.startingAdr
        && b.parentSubUnitId === t.parentSubUnitId;
    });
    if (sameContents) continue;
    changed = true;
    working = [
      ...working.filter((u) => u.assetId !== companion.id),
      ...targetMirrors,
    ];
    void parentIds;
  }
  return changed ? working : subUnits;
}

// ── Default state ──────────────────────────────────────────────────────────
// Brand-new project: 1 phase, 1 parcel, no assets, default cost lines, 1
// financing tranche. The wizard overwrites this on create.
const defaultPhase = makeDefaultPhase();
const defaultParcel = makeDefaultParcel(undefined, defaultPhase.id);
const defaultTranche = makeDefaultFinancingTranche('tranche_1', defaultPhase.id);
const defaultCostLines = makeDefaultCostLines(defaultPhase.id, defaultPhase.constructionPeriods);

export const DEFAULT_MODULE1_STATE: HydrateSnapshot = {
  project: makeDefaultProject(),
  phases: [defaultPhase],
  parcels: [defaultParcel],
  landAllocationMode: 'autoByBua',
  assets: [],
  subUnits: [],
  costLines: defaultCostLines,
  costOverrides: [],
  financingTranches: [defaultTranche],
  equityContributions: [],
  migrationsApplied: [],
};

// ── Store factory ──────────────────────────────────────────────────────────
export function createModule1Store() {
  return create<Module1Store>((set, get) => ({
    ...DEFAULT_MODULE1_STATE,

    // Case state: a fresh project seeds Management (base) + Downside + Upside,
    // with the base model mirroring the default model.
    cases: seedCases(),
    activeCaseId: baseCaseId(seedCases()),
    baseSnapshot: pickModel(DEFAULT_MODULE1_STATE as unknown as Record<string, unknown>),

    activePhaseId: DEFAULT_PHASE_ID,
    activeAssetId: null,

    setProject: (patch) => set((s) => ({ project: { ...s.project, ...patch } })),
    setLandAllocationMode: (mode) => set({ landAllocationMode: mode }),

    setPhases: (phases) => set({ phases }),
    addPhase: (phase) => set((s) => ({ phases: [...s.phases, phase] })),
    // 2026-05-20: phase-date cascade disabled.
    //
    // History: an earlier version of this setter "intelligently" shifted
    // every asset's per-period array when a phase's startDate changed,
    // attempting to keep user inputs anchored to their original calendar
    // years. That cascade caused two production bugs:
    //   1. Lossy shifts: a backward shift of N periods clobbered the
    //      first N entries of every axis-indexed array (preSalesVelocity,
    //      occupancyPerPeriod, ratePerGuest etc.).
    //   2. Incomplete coverage: opex line YoY rates, opex defaultIndexation
    //      growth arrays, and several other per-period arrays added after
    //      the cascade was written were never shifted, leaving them
    //      half-anchored to the old origin while the rest of the model
    //      anchored to the new origin.
    //
    // Both bugs manifested to the user as "my revenue / opex inputs are
    // changing or zeroing out when I edit a phase date." The safe fix is
    // to NOT touch any asset arrays on phase-date change. The user's
    // inputs stay verbatim, what they entered is what they get back.
    //
    // Trade-off: axis-indexed arrays (preSalesVelocity, occupancyPerPeriod
    // etc.) are still indexed by project axis position, so if the user
    // moves the earliest phase and the axis origin shifts, those arrays
    // now represent different calendar years. We accept this because:
    //   (a) inputs are preserved (no data loss);
    //   (b) the effect is visible (the user sees the same numbers under
    //       different year columns and can manually re-align);
    //   (c) a future Pass can offer an explicit "Re-align inputs to new
    //       calendar" button if users want the old auto-shift behaviour.
    //
    // project.startDate stays in sync with the new earliest-phase year
    // so any surface that reads it directly (not via computeProjectTimeline)
    // still sees the same axis origin the engine sees.
    updatePhase: (id, patch) => set((s) => {
      const before = s.phases.find((p) => p.id === id);
      if (!before) return {};
      const after = { ...before, ...patch };
      const nextPhases = s.phases.map((p) => (p.id === id ? after : p));

      const oldYear = before.startDate ? new Date(before.startDate).getUTCFullYear() : null;
      const newYear = after.startDate ? new Date(after.startDate).getUTCFullYear() : null;
      if (oldYear == null || newYear == null || oldYear === newYear) {
        return { phases: nextPhases };
      }

      const yearOf = (p: Phase, fallback: number): number =>
        p.startDate ? new Date(p.startDate).getUTCFullYear() : fallback;
      const projectOriginFallback = s.project.startDate
        ? new Date(s.project.startDate).getUTCFullYear()
        : oldYear;
      const oldOrigin = Math.min(...s.phases.map((p) => yearOf(p, projectOriginFallback)));
      const newOrigin = Math.min(...nextPhases.map((p) => yearOf(p, projectOriginFallback)));
      const originDelta = newOrigin - oldOrigin;

      const nextProject = originDelta !== 0
        ? { ...s.project, startDate: `${newOrigin}-01-01` }
        : s.project;

      return { phases: nextPhases, project: nextProject };
    }),
    removePhase: (id) => set((s) => {
      // Cascade: drop assets / subUnits / parcels / costLines / tranches /
      // equity tied to this phase.
      const droppedAssetIds = new Set(
        s.assets.filter((a) => a.phaseId === id).map((a) => a.id),
      );
      const remainingPhases = s.phases.filter((p) => p.id !== id);
      return {
        phases: remainingPhases,
        parcels: s.parcels.filter((p) => p.phaseId !== id),
        assets: s.assets.filter((a) => a.phaseId !== id),
        subUnits: s.subUnits.filter((u) => !droppedAssetIds.has(u.assetId)),
        costLines: s.costLines.filter((c) => c.phaseId !== id),
        costOverrides: s.costOverrides.filter((o) => !droppedAssetIds.has(o.assetId)),
        financingTranches: s.financingTranches.filter((t) => t.phaseId !== id),
        equityContributions: s.equityContributions.filter((e) => e.phaseId !== id),
        activePhaseId: s.activePhaseId === id
          ? (remainingPhases[0]?.id ?? DEFAULT_PHASE_ID)
          : s.activePhaseId,
        activeAssetId: droppedAssetIds.has(s.activeAssetId ?? '')
          ? null
          : s.activeAssetId,
      };
    }),

    setParcels: (parcels) => set({ parcels }),
    addParcel: (parcel) => set((s) => ({ parcels: [...s.parcels, parcel] })),
    updateParcel: (id, patch) => set((s) => ({
      parcels: s.parcels.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
    removeParcel: (id) => set((s) => ({
      parcels: s.parcels.filter((p) => p.id !== id),
    })),

    setAssets: (assets) => set({ assets }),
    // P10-Fix 3 (2026-05-12): hybrid project-wide architecture.
    // Cost lines are project-wide masters (one per (phaseId, baseId)),
    // so a newly-added asset automatically inherits every existing
    // cost line in its phase via the master. No per-asset replication
    // is needed. Auto-replication (Pass 10 Fix 2) is reverted here.
    //
    // When the phase has no cost lines yet (first asset in a brand-
    // new phase), seed the master catalog via makeDefaultCostLines so
    // the asset's Total column has something to display from period 0.
    addAsset: (asset) => set((s) => {
      const phaseHasLines = s.costLines.some((c) => c.phaseId === asset.phaseId);
      if (phaseHasLines) {
        return { assets: [...s.assets, asset] };
      }
      const phase = s.phases.find((p) => p.id === asset.phaseId);
      const seed = makeDefaultCostLines(asset.phaseId, phase?.constructionPeriods ?? 24);
      return {
        assets: [...s.assets, asset],
        costLines: [...s.costLines, ...seed],
      };
    }),
    // P10-Fix 4 (2026-05-12): updateAsset reconciles Sell + Manage
    // companion lifecycle. When strategy changes TO Sell + Manage and
    // the parent has no companion yet, auto-create one via
    // makeCompanionAsset (sellable units count derived from parent's
    // existing Sellable sub-units). When strategy changes AWAY from
    // Sell + Manage, cascade-remove the companion + its cost lines.
    // Direct edits on a companion (e.g. unitsFromParent override) flow
    // through unchanged.
    updateAsset: (id, patch) => set((s) => {
      let next = s.assets.map((a) => (a.id === id ? { ...a, ...patch } : a));
      // T2P3 Fix 2 (2026-05-12): when the parent's `type` changes,
      // propagate to every companion whose parentAssetId matches so the
      // companion's type stays mirrored (Residential parent -> Residential
      // companion). Runs regardless of whether the strategy changed.
      if ('type' in patch) {
        const editedAsset = next.find((a) => a.id === id);
        if (editedAsset && editedAsset.isCompanion !== true) {
          const newType = editedAsset.type ?? '';
          next = next.map((a) =>
            a.parentAssetId === id && a.isCompanion === true
              ? { ...a, type: newType }
              : a,
          );
        }
      }
      if (!('strategy' in patch)) {
        return { assets: next };
      }
      const before = s.assets.find((a) => a.id === id);
      const after = next.find((a) => a.id === id);
      if (!before || !after) return { assets: next };
      const becomesSellManage = before.strategy !== 'Sell + Manage' && after.strategy === 'Sell + Manage';
      const leavesSellManage = before.strategy === 'Sell + Manage' && after.strategy !== 'Sell + Manage';
      if (becomesSellManage) {
        const existing = s.assets.find((a) => a.parentAssetId === id);
        if (existing) return { assets: next };
        const sellableUnits = s.subUnits
          .filter((u) => u.assetId === id && u.category === 'Sellable')
          .reduce((sum, u) => sum + Math.max(0, u.metricValue), 0);
        const companion = makeCompanionAsset(after, sellableUnits);
        // T2-Fix 5c (2026-05-12): mirror parent Sellable sub-units onto the
        // new companion so the user immediately sees them with ADR=0.
        const nextAssets = [...next, companion];
        const nextSubUnits = syncCompanionSubUnits(nextAssets, s.subUnits);
        return { assets: nextAssets, subUnits: nextSubUnits };
      }
      if (leavesSellManage) {
        const companionIds = new Set(
          s.assets.filter((a) => a.parentAssetId === id).map((a) => a.id),
        );
        if (companionIds.size === 0) return { assets: next };
        return {
          assets: next.filter((a) => !companionIds.has(a.id)),
          subUnits: s.subUnits.filter((u) => !companionIds.has(u.assetId)),
          costLines: s.costLines.filter((c) => !c.targetAssetId || !companionIds.has(c.targetAssetId)),
          costOverrides: s.costOverrides.filter((o) => !companionIds.has(o.assetId)),
        };
      }
      return { assets: next };
    }),
    // P10-Fix 2 (2026-05-12): cascade-delete per-asset cost lines + any
    // child companion assets (Fix 4) when removing the parent. Without
    // this, costLines accumulate orphans (targetAssetId pointing at an
    // asset that no longer exists) and re-adding an asset with the same
    // id resurrects stale lines.
    removeAsset: (id) => set((s) => {
      const companionIds = s.assets.filter((a) => a.parentAssetId === id).map((a) => a.id);
      const removedIds = new Set<string>([id, ...companionIds]);
      return {
        assets: s.assets.filter((a) => !removedIds.has(a.id)),
        subUnits: s.subUnits.filter((u) => !removedIds.has(u.assetId)),
        costLines: s.costLines.filter((c) => !c.targetAssetId || !removedIds.has(c.targetAssetId)),
        costOverrides: s.costOverrides.filter((o) => !removedIds.has(o.assetId)),
        activeAssetId: s.activeAssetId && removedIds.has(s.activeAssetId) ? null : s.activeAssetId,
      };
    }),

    setSubUnits: (subUnits) => set({ subUnits }),
    // P10-Fix 4 (2026-05-12): sub-unit mutations sync the unitsFromParent
    // field on any companion whose parent owns the affected sub-unit.
    // Sellable categories drive the keys count. Helper closed over the
    // next subUnits array + assets array; idempotent.
    addSubUnit: (subUnit) => set((s) => {
      const draftSubs = [...s.subUnits, subUnit];
      const nextAssets = syncCompanionUnits(s.assets, draftSubs);
      const nextSubUnits = syncCompanionSubUnits(nextAssets, draftSubs);
      return { subUnits: nextSubUnits, assets: nextAssets };
    }),
    updateSubUnit: (id, patch) => set((s) => {
      const draftSubs = s.subUnits.map((u) => (u.id === id ? { ...u, ...patch } : u));
      const nextAssets = syncCompanionUnits(s.assets, draftSubs);
      const nextSubUnits = syncCompanionSubUnits(nextAssets, draftSubs);
      return { subUnits: nextSubUnits, assets: nextAssets };
    }),
    removeSubUnit: (id) => set((s) => {
      const draftSubs = s.subUnits.filter((u) => u.id !== id);
      const nextAssets = syncCompanionUnits(s.assets, draftSubs);
      const nextSubUnits = syncCompanionSubUnits(nextAssets, draftSubs);
      return { subUnits: nextSubUnits, assets: nextAssets };
    }),

    setCostLines: (costLines) => set({ costLines }),
    addCostLine: (costLine) => set((s) => ({ costLines: [...s.costLines, costLine] })),
    updateCostLine: (id, patch) => set((s) => ({
      costLines: s.costLines.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
    removeCostLine: (id) => set((s) => ({
      costLines: s.costLines.filter((c) => c.id !== id),
      costOverrides: s.costOverrides.filter((o) => o.lineId !== id),
    })),
    setCostOverride: (override) => set((s) => {
      const filtered = s.costOverrides.filter(
        (o) => !(o.assetId === override.assetId && o.lineId === override.lineId),
      );
      return { costOverrides: [...filtered, override] };
    }),
    removeCostOverride: (assetId, lineId) => set((s) => ({
      costOverrides: s.costOverrides.filter(
        (o) => !(o.assetId === assetId && o.lineId === lineId),
      ),
    })),

    setFinancingTranches: (tranches) => set({ financingTranches: tranches }),
    addFinancingTranche: (tranche) => set((s) => ({
      financingTranches: [...s.financingTranches, tranche],
    })),
    updateFinancingTranche: (id, patch) => set((s) => ({
      financingTranches: s.financingTranches.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    })),
    removeFinancingTranche: (id) => set((s) => ({
      financingTranches: s.financingTranches.filter((t) => t.id !== id),
    })),

    setEquityContributions: (contribs) => set({ equityContributions: contribs }),
    addEquityContribution: (contrib) => set((s) => ({
      equityContributions: [...s.equityContributions, contrib],
    })),
    updateEquityContribution: (id, patch) => set((s) => ({
      equityContributions: s.equityContributions.map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      ),
    })),
    removeEquityContribution: (id) => set((s) => ({
      equityContributions: s.equityContributions.filter((e) => e.id !== id),
    })),

    setActivePhaseId: (id) => set({ activePhaseId: id }),
    setActiveAssetId: (id) => set({ activeAssetId: id }),

    // ── Case management ──
    // Flush the current active case into (baseSnapshot, cases): base-active
    // refreshes the base from the live model; scenario-active recomputes that
    // case's overrides via diff. Returns the flushed pair without mutating.
    setActiveCase: (caseId) => set((s) => {
      const liveModel = pickModel(s as unknown as Record<string, unknown>);
      const baseId = baseCaseId(s.cases);
      let baseSnapshot = s.baseSnapshot;
      let cases = s.cases;
      if (s.activeCaseId === baseId) {
        baseSnapshot = liveModel;
      } else {
        cases = s.cases.map((c) => c.id === s.activeCaseId ? { ...c, overrides: buildOverrides(s.baseSnapshot, liveModel) } : c);
      }
      const target = cases.find((c) => c.id === caseId) ?? cases.find((c) => c.id === baseId)!;
      const model = target.role === 'base' ? baseSnapshot : applyOverrides(baseSnapshot, target.overrides);
      return {
        ...model,
        migrationsApplied: model.migrationsApplied ?? [],
        baseSnapshot,
        cases,
        activeCaseId: target.id,
        activePhaseId: model.phases[0]?.id ?? DEFAULT_PHASE_ID,
        activeAssetId: null,
      };
    }),

    addCase: (name) => set((s) => {
      const n = s.cases.filter((c) => c.role === 'scenario').length + 1;
      const id = `case_${s.cases.length}_${Math.max(0, ...s.cases.map((c) => c.name.length))}`;
      const newCase: ProjectCase = { id, name: name?.trim() || `Case ${n}`, role: 'scenario', overrides: {} };
      return { cases: [...s.cases, newCase] };
    }),

    renameCase: (caseId, name) => set((s) => ({
      cases: s.cases.map((c) => c.id === caseId ? { ...c, name: name.trim() || c.name } : c),
    })),

    removeCase: (caseId) => set((s) => {
      const target = s.cases.find((c) => c.id === caseId);
      if (!target || target.role === 'base') return {}; // never remove the base case
      const cases = s.cases.filter((c) => c.id !== caseId);
      // If the removed case was active, fall back to the base case's model.
      if (s.activeCaseId === caseId) {
        const baseId = baseCaseId(cases);
        const base = cases.find((c) => c.id === baseId)!;
        const model = s.baseSnapshot;
        return {
          ...model,
          migrationsApplied: model.migrationsApplied ?? [],
          cases,
          activeCaseId: base.id,
          activePhaseId: model.phases[0]?.id ?? DEFAULT_PHASE_ID,
          activeAssetId: null,
        };
      }
      return { cases };
    }),

    clearCaseOverrides: (caseId) => set((s) => {
      const target = s.cases.find((c) => c.id === caseId);
      if (!target || target.role === 'base') return {};
      const cases = s.cases.map((c) => c.id === caseId ? { ...c, overrides: {} } : c);
      // If it's the active case, reload its (now empty) model = base.
      if (s.activeCaseId === caseId) {
        const model = s.baseSnapshot;
        return { ...model, migrationsApplied: model.migrationsApplied ?? [], cases, activePhaseId: model.phases[0]?.id ?? DEFAULT_PHASE_ID, activeAssetId: null };
      }
      return { cases };
    }),

    // Reset one overridden field on the ACTIVE scenario back to base: drop the
    // path from the override map and re-merge so the live model reflects base.
    resetOverridePath: (path) => set((s) => {
      const baseId = baseCaseId(s.cases);
      if (s.activeCaseId === baseId) return {}; // base has no overrides
      const liveModel = pickModel(s as unknown as Record<string, unknown>);
      const current = buildOverrides(s.baseSnapshot, liveModel);
      delete current[path];
      const cases = s.cases.map((c) => c.id === s.activeCaseId ? { ...c, overrides: current } : c);
      const model = applyOverrides(s.baseSnapshot, current);
      return { ...model, migrationsApplied: model.migrationsApplied ?? [], cases, activePhaseId: model.phases[0]?.id ?? DEFAULT_PHASE_ID, activeAssetId: null };
    }),

    extractPersistSnapshot: () => {
      const s = get();
      const liveModel = pickModel(s as unknown as Record<string, unknown>);
      const baseId = baseCaseId(s.cases);
      let baseModel = s.baseSnapshot;
      let cases = s.cases;
      if (s.activeCaseId === baseId) {
        baseModel = liveModel;
      } else {
        cases = s.cases.map((c) => c.id === s.activeCaseId ? { ...c, overrides: buildOverrides(s.baseSnapshot, liveModel) } : c);
      }
      return { ...baseModel, cases, activeCaseId: s.activeCaseId };
    },

    hydrate: (snapshot) => set(() => {
      const cases = normaliseCases(snapshot.cases);
      const baseId = baseCaseId(cases);
      const activeCaseId = snapshot.activeCaseId && cases.some((c) => c.id === snapshot.activeCaseId)
        ? snapshot.activeCaseId
        : baseId;
      // The persisted top-level fields ARE the base model.
      const baseModel = pickModel(snapshot as unknown as Record<string, unknown>);
      const active = cases.find((c) => c.id === activeCaseId)!;
      const model = active.role === 'base' ? baseModel : applyOverrides(baseModel, active.overrides);
      return {
        ...model,
        // Pass 43 (2026-05-14): coerce to array so legacy snapshots
        // without the marker field still satisfy the store contract.
        migrationsApplied: model.migrationsApplied ?? [],
        baseSnapshot: baseModel,
        cases,
        activeCaseId,
        activePhaseId: model.phases[0]?.id ?? DEFAULT_PHASE_ID,
        activeAssetId: null,
      };
    }),
  }));
}

export const useModule1Store = createModule1Store();

// ── Selectors ──────────────────────────────────────────────────────────────
export const selectActivePhase = (s: Module1Store): Phase | undefined =>
  s.phases.find((p) => p.id === s.activePhaseId) ?? s.phases[0];

export const selectAssetsForPhase = (phaseId: string) => (s: Module1Store): Asset[] =>
  s.assets.filter((a) => a.phaseId === phaseId);

export const selectVisibleAssetsForPhase = (phaseId: string) => (s: Module1Store): Asset[] =>
  s.assets.filter((a) => a.phaseId === phaseId && a.visible);

export const selectSubUnitsForAsset = (assetId: string) => (s: Module1Store): SubUnit[] =>
  s.subUnits.filter((u) => u.assetId === assetId);

export const selectParcelsForPhase = (phaseId: string) => (s: Module1Store): Parcel[] =>
  s.parcels.filter((p) => p.phaseId === phaseId);

export const selectCostLinesForPhase = (phaseId: string) => (s: Module1Store): CostLine[] =>
  s.costLines.filter((c) => c.phaseId === phaseId);

export const selectFinancingTranchesForPhase = (phaseId: string) => (s: Module1Store): FinancingTranche[] =>
  s.financingTranches.filter((t) => t.phaseId === phaseId);

export const selectEquityContributionsForPhase = (phaseId: string) => (s: Module1Store): EquityContribution[] =>
  s.equityContributions.filter((e) => e.phaseId === phaseId);

export const selectCostOverride = (assetId: string, lineId: string) => (s: Module1Store): CostOverride | undefined =>
  s.costOverrides.find((o) => o.assetId === assetId && o.lineId === lineId);
