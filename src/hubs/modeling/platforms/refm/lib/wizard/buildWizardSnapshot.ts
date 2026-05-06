/**
 * buildWizardSnapshot.ts (v5 schema)
 *
 * Phase M2.0 (2026-05-06): rewrite for MAAD-Spec.
 *
 * Translates a ProjectWizard draft into a v5 HydrateSnapshot. The
 * wizard captures:
 *   1. Project basics: name, currency, modelType, location
 *   2. Phases & land: per-phase construction/operations/overlap +
 *      land parcels with rate + cash/in-kind split
 *   3. Assets seed: per-asset name + strategy + type + GFA + BUA +
 *      sub-unit count + parking
 *
 * The output is a complete v5 HydrateSnapshot (not partial; every
 * field set so the store can hydrate cleanly without enrichment).
 */

import type { HydrateSnapshot } from '../state/module1-store';
import {
  type ModelGranularity,
  type Project,
  type Phase,
  type Parcel,
  type Asset,
  type SubUnit,
  type FinancingTranche,
  type LandAllocationMode,
  type AssetStrategy,
  DEFAULT_OPERATIONS_BY_STRATEGY,
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
} from '../state/module1-types';

export interface WizardDraftPhase {
  name: string;
  // M2.0e: ISO date (YYYY-MM-DD). Per-phase start date drives concrete
  // timeline display (computePhaseTimeline). When the wizard mints
  // multiple phases, the next phase's startDate defaults to the prior
  // phase's constructionEnd (or project.startDate for the first phase).
  startDate: string;
  constructionPeriods: number;
  operationsPeriods: number;
  overlapPeriods: number;
}

export interface WizardDraftParcel {
  name: string;
  area: number;
  rate: number;
  cashPct: number;
  inKindPct: number;
}

export interface WizardDraftAsset {
  name: string;
  strategy: AssetStrategy;
  type: string;
  gfaSqm: number;
  buaSqm: number;
  sellableBuaSqm: number;
  parkingBaysRequired: number;
  // Seed sub-unit shape (single sub-unit per asset on create; user
  // adds more in Tab 2)
  subUnitName: string;
  subUnitMetric: 'count' | 'area';
  subUnitMetricValue: number;
  subUnitUnitArea?: number;
  subUnitUnitPrice: number;
}

export interface WizardDraft {
  // Step 1
  projectName: string;
  currency: string;
  modelType: ModelGranularity;
  startDate: string;
  location: string;
  // Step 2
  phases: WizardDraftPhase[];
  parcels: WizardDraftParcel[];
  landAllocationMode: LandAllocationMode;
  // Step 3
  assets: WizardDraftAsset[];
}

export function buildWizardSnapshot(draft: WizardDraft): HydrateSnapshot {
  // Project meta
  const project: Project = {
    name: draft.projectName,
    currency: draft.currency,
    modelType: draft.modelType,
    startDate: draft.startDate,
    status: 'draft',
    location: draft.location,
  };

  // Phases. M2.0e: each phase carries its own startDate from the wizard.
  // constructionStart still reflects sequential ordering (1-indexed
  // periods from project start) so the legacy calc surface keeps
  // working; the new computePhaseTimeline prefers startDate when set.
  const phases: Phase[] = [];
  let cursor = 1;
  for (let i = 0; i < draft.phases.length; i++) {
    const wp = draft.phases[i];
    phases.push({
      id: `phase_${i + 1}`,
      name: wp.name || `Phase ${i + 1}`,
      constructionStart: cursor,
      constructionPeriods: Math.max(1, wp.constructionPeriods),
      operationsPeriods: Math.max(0, wp.operationsPeriods),
      overlapPeriods: Math.max(0, Math.min(wp.constructionPeriods, wp.overlapPeriods)),
      startDate: wp.startDate && wp.startDate.length === 10 ? wp.startDate : undefined,
    });
    cursor += Math.max(1, wp.constructionPeriods) - Math.max(0, wp.overlapPeriods);
  }
  if (phases.length === 0) {
    phases.push({
      id: 'phase_1',
      name: 'Phase 1',
      constructionStart: 1,
      constructionPeriods: 24,
      operationsPeriods: 60,
      overlapPeriods: 0,
      startDate: draft.startDate,
    });
  }
  const firstPhaseId = phases[0].id;

  // Parcels (all bound to first phase by default; users move parcels
  // to other phases in Tab 2 after create)
  const parcels: Parcel[] = draft.parcels.map((wp, idx) => ({
    id: `parcel_${idx + 1}`,
    phaseId: firstPhaseId,
    name: wp.name || `Land ${idx + 1}`,
    area: Math.max(0, wp.area),
    rate: Math.max(0, wp.rate),
    cashPct: Math.max(0, Math.min(100, wp.cashPct)),
    inKindPct: Math.max(0, Math.min(100, wp.inKindPct)),
  }));
  if (parcels.length === 0) {
    parcels.push({
      id: 'parcel_1',
      phaseId: firstPhaseId,
      name: 'Land 1',
      area: 100000,
      rate: 500,
      cashPct: 60,
      inKindPct: 40,
    });
  }

  // Assets + sub-units (one seed sub-unit per asset)
  const assets: Asset[] = [];
  const subUnits: SubUnit[] = [];
  draft.assets.forEach((wa, idx) => {
    const id = `asset_${idx + 1}`;
    assets.push({
      id,
      phaseId: firstPhaseId,
      name: wa.name || `Asset ${idx + 1}`,
      type: wa.type,
      strategy: wa.strategy,
      visible: true,
      gfaSqm: Math.max(0, wa.gfaSqm),
      buaSqm: Math.max(0, wa.buaSqm),
      sellableBuaSqm: Math.max(0, wa.sellableBuaSqm),
      parkingBaysRequired: Math.max(0, wa.parkingBaysRequired),
    });
    const ops = DEFAULT_OPERATIONS_BY_STRATEGY[wa.strategy];
    const category =
      wa.strategy === 'Lease' ? 'Leasable' :
      wa.strategy === 'Operate' ? 'Operable' : 'Sellable';
    subUnits.push({
      id: `subunit_${idx + 1}`,
      assetId: id,
      name: wa.subUnitName || 'Sub-unit',
      category,
      metric: wa.subUnitMetric,
      metricValue: Math.max(0, wa.subUnitMetricValue),
      unitArea: wa.subUnitUnitArea,
      unitPrice: Math.max(0, wa.subUnitUnitPrice),
      occupancyPct: ops.occupancyPct,
      operatingMargin: ops.operatingMargin,
    });
  });

  // Default cost lines for every phase
  const costLines = phases.flatMap((p) => makeDefaultCostLines(p.id));

  // Default financing tranche per phase
  const financingTranches: FinancingTranche[] = phases.map((p, i) =>
    makeDefaultFinancingTranche(`tranche_${i + 1}`, p.id),
  );

  return {
    project,
    phases,
    parcels,
    landAllocationMode: draft.landAllocationMode,
    assets,
    subUnits,
    costLines,
    costOverrides: [],
    financingTranches,
    equityContributions: [],
  };
}

// ── Default draft factory (used by the wizard's initial state) ─────────────
export function makeDefaultWizardDraft(): WizardDraft {
  return {
    projectName: 'New Project',
    currency: 'SAR',
    modelType: 'annual',
    startDate: new Date().toISOString().slice(0, 10),
    location: '',
    phases: [
      { name: 'Phase 1', startDate: new Date().toISOString().slice(0, 10), constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 },
    ],
    parcels: [
      { name: 'Land 1', area: 100000, rate: 500, cashPct: 60, inKindPct: 40 },
    ],
    landAllocationMode: 'autoByBua',
    assets: [
      {
        name: 'Residential',
        strategy: 'Sell',
        type: 'High-end Apartments',
        gfaSqm: 0,
        buaSqm: 0,
        sellableBuaSqm: 0,
        parkingBaysRequired: 0,
        subUnitName: '2BR',
        subUnitMetric: 'count',
        subUnitMetricValue: 100,
        subUnitUnitArea: 120,
        subUnitUnitPrice: 1500000,
      },
    ],
  };
}
