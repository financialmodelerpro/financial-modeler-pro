/**
 * buildWizardSnapshot.ts
 *
 * Phase M1.8/5 — pure function that turns a wizard draft into a full
 * HydrateSnapshot ready for `pclient.createProject`.
 *
 * Responsibilities:
 *   1. Map the wizard's display-level WizardProjectType to the legacy
 *      ProjectType enum the rest of REFM still uses ('residential' |
 *      'hospitality' | 'mixed-use'). The cascade math in @core/calculations
 *      reads `projectType` for showResidential / showHospitality flags,
 *      so any wizard project that isn't pure residential or pure
 *      hospitality lands on 'mixed-use' (the only enum value that admits
 *      arbitrary asset mixes).
 *   2. Mint stable hierarchy ids per row: 1 SubProject + N Phases + N
 *      Plots + 1 Asset per wizard row + 1 Sub-Unit per asset.
 *   3. Bind every asset to Phase 1 + Plot 1 (the brief's default — users
 *      reassign via the Hierarchy / Area Program tabs later).
 *   4. Mint a single placeholder Sub-Unit per asset whose metric +
 *      metricValue match the asset's strategy (Sell/Operate → count=1,
 *      Lease → area=0). Unit price always 0; users fill in revenue side
 *      later.
 *   5. Stamp `hierarchyDisclosure: 'progressive'` so the Hierarchy tab
 *      knows to hide unused layers (M1.8/6 reads this).
 *
 * Pure function — does NOT touch the Zustand store or persistence client.
 * The caller owns those side effects.
 */

import type { ModelType } from '@core/types/project.types';
import type { HydrateSnapshot } from '../state/module1-store';
import { DEFAULT_MODULE1_STATE } from '../state/module1-store';
import type {
  AssetClass, MasterHolding, Phase, Plot, SubProject, SubUnit,
} from '../state/module1-types';
import {
  makeDefaultMasterHolding, makeDefaultPlot,
  DEFAULT_SUB_PROJECT_ID, DEFAULT_PHASE_ID,
} from '../state/module1-types';
import type { WizardDraft, WizardDraftAsset, WizardProjectType } from '../../components/modals/ProjectWizard';

// ── Wizard → ProjectType collapse ──
// Pure residential / pure hospitality wizard types map to the legacy
// scalar enum so the area-cascade math behaves as it always did.
// Everything else (Mixed-Use, Office, Retail, Custom) lands on
// 'mixed-use' which is the only enum value that allows arbitrary
// per-asset allocations on the Land & Area tab.
export function mapWizardToProjectType(t: WizardProjectType): 'residential' | 'hospitality' | 'mixed-use' {
  if (t === 'Residential') return 'residential';
  if (t === 'Hospitality') return 'hospitality';
  return 'mixed-use';
}

// ── Sub-Unit metric selection per strategy ──
// Sell: 1 unit, count metric, 100 sqm placeholder unit size
// Operate: 1 key, count metric, quantity = 1
// Lease: 1 area, area metric, area = 0 (user fills later)
// All unit prices start at 0. Users wire the revenue model up in M2+
// once it lands; the placeholders just guarantee each asset has at
// least one inventory row so downstream tabs never crash on empty
// SubUnit lists.
function makePlaceholderSubUnit(asset: AssetClass): SubUnit {
  if (asset.category === 'Sell') {
    return {
      id:           `subunit_${asset.id}`,
      assetId:      asset.id,
      name:         `${asset.name} Units`,
      metric:       'count',
      metricValue:  1,
      unitPrice:    0,
    };
  }
  if (asset.category === 'Operate') {
    return {
      id:           `subunit_${asset.id}`,
      assetId:      asset.id,
      name:         `${asset.name} Keys`,
      metric:       'count',
      metricValue:  1,
      unitPrice:    0,
    };
  }
  // Lease + Hybrid both default to area metric — Hybrid users can edit.
  return {
    id:           `subunit_${asset.id}`,
    assetId:      asset.id,
    name:         `${asset.name} Area`,
    metric:       'area',
    metricValue:  0,
    unitPrice:    0,
  };
}

// ── Hierarchy id helpers ──
// Stable, deterministic ids so a wizard-built snapshot looks tidy when
// inspected in the Supabase JSONB column. SubProject and Phase 1 reuse
// the canonical ids from module1-types so legacy code paths that still
// reference DEFAULT_SUB_PROJECT_ID / DEFAULT_PHASE_ID keep working
// without surprises. Subsequent phases / plots use 1-indexed numeric
// suffixes.
function phaseIdFor(idx: number): string {
  return idx === 0 ? DEFAULT_PHASE_ID : `phase_${idx + 1}`;
}
function plotIdFor(idx: number): string {
  return `plot_${idx + 1}`;
}
function assetIdFor(idx: number): string {
  return `wizardasset_${idx + 1}`;
}

// ── Build helper ──
export interface BuildWizardSnapshotResult {
  snapshot:   HydrateSnapshot;
  /** Arrays the caller can pass to pclient.createProject for the asset_mix column. */
  assetMix:   string[];
  /** Display-level project type the wizard chose, for logging / future use. */
  wizardType: WizardProjectType;
}

export function buildWizardSnapshot(draft: WizardDraft): BuildWizardSnapshotResult {
  const projectType = mapWizardToProjectType(draft.wizardProjectType);

  // ── 1 SubProject ──
  const subProject: SubProject = {
    id:                   DEFAULT_SUB_PROJECT_ID,
    name:                 draft.name.trim() || 'Main',
    currency:             draft.currency,
    masterHoldingId:      draft.enableMasterHolding ? 'mh_1' : null,
    revenueShareToMaster: 0,
  };

  // ── Phases (phaseCount of them; first is Phase 1 with canonical id) ──
  const phases: Phase[] = [];
  // Borrow timing scalars from DEFAULT_MODULE1_STATE.phases[0] so
  // wizard-created phases inherit the same construction/operations
  // window the legacy single-phase default uses (4 + 5 + 0).
  const seedPhase = DEFAULT_MODULE1_STATE.phases[0];
  for (let i = 0; i < draft.phaseCount; i++) {
    phases.push({
      id:                  phaseIdFor(i),
      name:                draft.phaseCount === 1 ? 'Phase 1' : `Phase ${i + 1}`,
      subProjectId:        subProject.id,
      constructionStart:   seedPhase.constructionStart,
      constructionPeriods: seedPhase.constructionPeriods,
      operationsStart:     seedPhase.operationsStart,
      operationsPeriods:   seedPhase.operationsPeriods,
      overlapPeriods:      seedPhase.overlapPeriods,
    });
  }

  // ── Plots (plotCount of them, all bound to Phase 1) ──
  // Plot area is split evenly from the default land parcel size (100k sqm)
  // so the wizard projects total land area is ~constant regardless of
  // plotCount. Users edit per-plot from the Area Program tab.
  const phase1Id      = phases[0].id;
  const seedLandArea  = DEFAULT_MODULE1_STATE.landParcels[0]?.area ?? 100_000;
  const plotAreaEach  = Math.round(seedLandArea / draft.plotCount);
  const plots: Plot[] = [];
  for (let i = 0; i < draft.plotCount; i++) {
    const id = plotIdFor(i);
    const name = draft.plotCount === 1 ? 'Plot 1' : `Plot ${i + 1}`;
    plots.push(makeDefaultPlot(id, name, phase1Id, plotAreaEach));
  }
  const plot1Id = plots[0].id;

  // ── Assets (1 per wizard row, all bound to Phase 1 + Plot 1) ──
  const assets: AssetClass[] = draft.assets.map((row: WizardDraftAsset, idx: number): AssetClass => {
    const id = assetIdFor(idx);
    return {
      id,
      name:           row.name.trim() || `Asset ${idx + 1}`,
      type:           row.type,
      category:       row.category,
      allocationPct:  row.allocationPct,
      // deductPct + efficiencyPct: borrow industry-typical legacy seeds
      // per category so the Land & Area tab renders sensible numbers.
      // Sell ~10/85, Operate ~15/80, Lease ~5/90, Hybrid ~10/85.
      deductPct:      row.category === 'Operate' ? 15 : row.category === 'Lease' ? 5 : 10,
      efficiencyPct:  row.category === 'Operate' ? 80 : row.category === 'Lease' ? 90 : 85,
      visible:        true,
      subProjectId:   subProject.id,
      phaseId:        phase1Id,
      plotId:         plot1Id,
      primaryStrategy:    row.strategy,
      primaryStrategyPct: 100,
    };
  });

  // ── Sub-Units (1 placeholder per asset) ──
  const subUnits: SubUnit[] = assets.map(makePlaceholderSubUnit);

  // ── Master Holding ──
  // Always create the singleton; enabled flag is the only thing that
  // changes whether the Hierarchy tab shows it as a configurable
  // header card.
  const masterHolding: MasterHolding = {
    ...makeDefaultMasterHolding(),
    enabled: draft.enableMasterHolding,
  };

  // ── Compose the full snapshot ──
  // Start from the canonical defaults so any field we don't touch
  // (interestRate, lineRatios, costStage, etc.) reads exactly the same
  // values the rest of REFM expects. We then layer wizard inputs on top.
  const snapshot: HydrateSnapshot = {
    ...DEFAULT_MODULE1_STATE,
    projectName:  draft.name.trim() || 'New Project',
    projectType,
    currency:     draft.currency,
    modelType:    draft.modelType as ModelType,
    projectStart: draft.startDate,
    masterHolding,
    subProjects:  [subProject],
    phases,
    plots,
    zones:        [],
    assets,
    subUnits,
    // Costs intentionally start empty. The legacy default-cost seed
    // useEffect in RealEstatePlatform fires whenever a per-asset cost
    // array becomes empty AND its asset exists, so wizard assets pick
    // up the standard 12-cost seed automatically when the user opens
    // the Dev Costs tab. Avoids duplicating the seed list here.
    costs:        [],
    // Hierarchy disclosure flag (M1.8/6): wizard projects open in
    // 'progressive' mode (hide unused layers). Pre-existing projects
    // that never went through the wizard load with this field absent
    // (= 'manual' fallback) so their Hierarchy tab keeps the current
    // show-all-layers behavior.
    hierarchyDisclosure: 'progressive',
  };

  // Asset-mix column for the project list (used by ProjectsScreen
  // chips). Use the wizard asset names so users see "Hotel, Retail
  // Podium" rather than the asset categories.
  const assetMix = assets.map(a => a.name);

  return { snapshot, assetMix, wizardType: draft.wizardProjectType };
}
