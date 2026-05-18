/**
 * buildWizardSnapshot.ts (v5 schema)
 *
 * Phase M2.0 (2026-05-06): rewrite for the v5 spec.
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
  type OutputGranularity,
  type Project,
  type ProjectType,
  type DisplayScale,
  type Phase,
  type Parcel,
  type Asset,
  type SubUnit,
  type FinancingTranche,
  type LandAllocationMode,
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

// M2.0e: WizardDraftAsset retired. Step 3 captures only project type;
// asset detail entry moves to Tab 2 (Module1Assets) with full phase
// context visible. The wizard outputs an empty assets[] / subUnits[]
// in the snapshot; users add assets in Tab 2 explicitly.

export interface WizardDraft {
  // Step 1
  projectName: string;
  currency: string;
  // M2.0g v8 (Addendum 3): modelType always 'annual' on new projects.
  // Kept on the draft for backward-compat reads; UI no longer exposes
  // a granularity picker here. outputGranularity replaces it as the
  // user-facing reporting view.
  modelType: ModelGranularity;
  outputGranularity: OutputGranularity;
  startDate: string;
  location: string;
  // M2.0g: display scale captured in Wizard Step 1.
  displayScale: DisplayScale;
  // Step 2
  phases: WizardDraftPhase[];
  parcels: WizardDraftParcel[];
  landAllocationMode: LandAllocationMode;
  // Step 3 (M2.0e: project type only; asset detail moved to Tab 2)
  projectType: ProjectType;
}

export function buildWizardSnapshot(draft: WizardDraft): HydrateSnapshot {
  // Project meta
  const project: Project = {
    name: draft.projectName,
    currency: draft.currency,
    // M2.0g v8: inputs are always entered annually.
    modelType: 'annual',
    // M2.0 Pass 14 (2026-05-13): outputGranularity force-stamped 'annual'
    // until M5 Financial Statements reintroduces a granularity toggle
    // scoped to FS output. Wizard select removed.
    outputGranularity: 'annual',
    startDate: draft.startDate,
    status: 'draft',
    location: draft.location,
    projectType: draft.projectType,
    displayScale: draft.displayScale,
  };

  // Phases. M2.0e: each phase carries its own startDate from the wizard.
  // constructionStart still reflects sequential ordering (1-indexed
  // periods from project start) so the legacy calc surface keeps
  // working; the new computePhaseTimeline prefers startDate when set.
  const phases: Phase[] = [];
  let cursor = 1;
  for (let i = 0; i < draft.phases.length; i++) {
    const wp = draft.phases[i];
    // M2.0j Fix 1: allow constructionPeriods = 0 (operational phase).
    const cp = Math.max(0, wp.constructionPeriods);
    phases.push({
      id: `phase_${i + 1}`,
      name: wp.name || `Phase ${i + 1}`,
      constructionStart: cursor,
      constructionPeriods: cp,
      operationsPeriods: Math.max(0, wp.operationsPeriods),
      overlapPeriods: Math.max(0, Math.min(cp, wp.overlapPeriods)),
      startDate: wp.startDate && wp.startDate.length === 10 ? wp.startDate : undefined,
    });
    cursor += Math.max(1, cp) - Math.max(0, wp.overlapPeriods);
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

  // M2.0e: assets + sub-units start empty. Tab 2 is the canonical asset
  // entry surface. Phase headers in Tab 2 print project-type-aware
  // suggestions until the user adds assets explicitly.
  const assets: Asset[] = [];
  const subUnits: SubUnit[] = [];

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
    // Pass 43 (2026-05-14): brand-new wizard snapshots are already in
    // every current schema, so pre-mark all known migrations as applied
    // to prevent legacy banners from firing on freshly-created projects.
    migrationsApplied: ['m20costs-pass7'],
  };
}

// ── Default draft factory (used by the wizard's initial state) ─────────────
export function makeDefaultWizardDraft(): WizardDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    projectName: 'New Project',
    currency: 'SAR',
    modelType: 'annual',
    outputGranularity: 'annual',
    startDate: today,
    location: '',
    phases: [
      { name: 'Phase 1', startDate: today, constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 },
    ],
    parcels: [
      { name: 'Land 1', area: 100000, rate: 500, cashPct: 60, inKindPct: 40 },
    ],
    landAllocationMode: 'autoByBua',
    // M2.0e: project type defaults to Mixed-Use so Tab 2's catalog
    // shows the broadest selection until the user picks a narrower one.
    projectType: 'Mixed-Use',
    // M2.0g: full numbers default; user can opt into K / M scale.
    displayScale: 'full',
  };
}
