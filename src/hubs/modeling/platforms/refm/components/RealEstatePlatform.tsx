'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ModelType, ProjectType, CostInputMode, FinancingMode,
  RepaymentMethod, CostItem, LandParcel, AreaMetrics, FinancingResult,
} from '@/src/core/types/project.types';
import { buildAssetFinancing as buildAssetFinancingCore } from '@/src/core/calculations';
import { ROLES, ROLE_META, MODULE_VISIBILITY, PERMISSIONS, useBrandingStore } from '@/src/core/state';
import type { Role, ModuleKey, PermissionMap } from '@/src/core/types/settings.types';
import { useShallow } from 'zustand/react/shallow';
import { useSession } from 'next-auth/react';
import { useModule1Store, DEFAULT_MODULE1_STATE, type HydrateSnapshot } from '../lib/state/module1-store';
// Phase M1.6: hydrationFromAnySnapshot import dropped — the sync
// module owns hydration via attachToProject / loadVersionInto. The
// legacy toLegacySnapshot path is retained only inside the store for
// migration use; nothing in this component needs it post-M1.6.
import { LEGACY_ASSET_IDS, DEFAULT_SUB_PROJECT_ID, makeDefaultPhase, type CostLine } from '../lib/state/module1-types';
import * as pclient from '../lib/persistence/client';
import { attachToProject as attachSyncToProject, detach as detachSync, loadVersionInto } from '../lib/persistence/module1-sync';
import { runOneShotMigration } from '../lib/persistence/migrator';
import { readActiveProjectId, writeActiveProjectId, clearCachedSnapshot } from '../lib/persistence/cache';

// Module-scope helper used by the store-setter wrappers below. Hoisted
// out of the component so it does not need to appear in any useCallback
// dependency list (its identity is stable across renders).
type StoreUpdater<T> = T | ((prev: T) => T);
const resolveStoreUpdater = <T,>(updater: StoreUpdater<T>, prev: T): T =>
  typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;

import Topbar from './Topbar';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import ProjectsScreen from './ProjectsScreen';
import OverviewScreen from './OverviewScreen';
import Module1Timeline from './modules/Module1Timeline';
import Module1Area from './modules/Module1Area';
import Module1Costs from './modules/Module1Costs';
import Module1Financing from './modules/Module1Financing';
import Module1Hierarchy from './modules/Module1Hierarchy';
import ProjectModal from './modals/ProjectModal';
import VersionModal from './modals/VersionModal';
import RbacModal from './modals/RbacModal';
import ExportModal from './modals/ExportModal';
import UpgradePrompt from '@/src/shared/components/UpgradePrompt';
import { MODULES } from '../lib/modules-config';

// ── Storage shape (consumer interface, post-M1.6) ───────────────────────────
// StorageProject + StorageShape are kept as the contract that
// ProjectsScreen / OverviewScreen / Dashboard / VersionModal still
// consume. Pre-M1.6 these were pulled from `localStorage.refm_v2`;
// post-M1.6 they're SYNTHESIZED from server data (refm_projects +
// refm_project_versions, migration 149) inside RealEstatePlatform's
// boot effect. The legacy localStorage blob is read once by the
// one-shot migrator (lib/persistence/migrator.ts) and otherwise left
// untouched for user-side verification.
//
// Per-project `versions` map is populated lazily — only the
// currently-active project's version metadata is fetched. Other
// project cards in the picker show their `version_count` (from the
// list endpoint) but their `versions` dict stays empty.
//
// Per-version `data` is OMITTED from the synthesized shape (kept as
// `null`). The active snapshot lives in the Zustand store via
// attachToProject; the version-history UI doesn't need it pre-loaded.
export interface StorageProject {
  name: string;
  createdAt: string;
  lastModified: string;
  location: string;
  status: 'Draft' | 'Active' | 'IC Review' | 'Approved' | 'Archived';
  assetMix: string[];
  versions: Record<string, { name: string; createdAt: string; data: unknown }>;
  versionCount?: number;   // populated from server `version_count` even when versions{} is empty
}

export interface StorageShape {
  projects: Record<string, StorageProject>;
  activeProjectId: string | null;
  activeVersionId: string | null;
}

// HydrateSnapshot field list. Iterates DEFAULT_MODULE1_STATE keys so
// adding a new field to the snapshot shape automatically participates
// in saves without anyone touching this file. Mirrors module1-sync's
// SNAPSHOT_KEYS.
const SNAPSHOT_KEYS = Object.keys(DEFAULT_MODULE1_STATE) as Array<keyof HydrateSnapshot>;

function extractHydrateSnapshot(state: ReturnType<typeof useModule1Store.getState>): HydrateSnapshot {
  const out = {} as HydrateSnapshot;
  for (const k of SNAPSHOT_KEYS) {
    (out as Record<string, unknown>)[k] = state[k];
  }
  return out;
}

// Project the server list endpoint into the StorageShape contract.
// Versions are intentionally empty per the rule above; consumers that
// need them request via fetchVersionsForProject() below.
function projectsToStorageShape(
  projects: pclient.RefmProjectSummary[],
  activeProjectId: string | null,
  activeVersionId: string | null,
): StorageShape {
  const out: StorageShape = { projects: {}, activeProjectId, activeVersionId };
  for (const p of projects) {
    out.projects[p.id] = {
      name:         p.name,
      createdAt:    p.created_at,
      lastModified: p.updated_at,
      location:     p.location ?? '',
      status:       p.status,
      assetMix:     p.asset_mix,
      versions:     {},
      versionCount: p.version_count,
    };
  }
  return out;
}

// ── Default cost items ───────────────────────────────────────────────────────
const makeDefaultCosts = (startId: number): CostItem[] => [
  { id: startId + 0,  name: 'Site Preparation',        method: 'rate_total_allocated', value: 15,    baseType: '', startPeriod: 1, endPeriod: 2, phasing: 'even', canDelete: true },
  { id: startId + 1,  name: 'Infrastructure',          method: 'rate_net_developable',  value: 80,   baseType: '', startPeriod: 1, endPeriod: 3, phasing: 'even', canDelete: true },
  { id: startId + 2,  name: 'Structural Works',        method: 'rate_gfa',              value: 400,  baseType: '', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 3,  name: 'MEP Works',               method: 'rate_gfa',              value: 150,  baseType: '', startPeriod: 2, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 4,  name: 'Finishing Works',         method: 'rate_bua',              value: 200,  baseType: '', startPeriod: 3, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 5,  name: 'Professional Fees',       method: 'percent_base',          value: 8,    baseType: 'construction', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 6,  name: 'Contingency',             method: 'percent_base',          value: 5,    baseType: 'construction', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 7,  name: 'Marketing & Sales',       method: 'percent_total_land',    value: 2,    baseType: '', startPeriod: 2, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 8,  name: 'Project Management',      method: 'percent_base',          value: 3,    baseType: 'construction', startPeriod: 1, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 9,  name: 'Legal & Admin',           method: 'percent_total_land',    value: 1,    baseType: '', startPeriod: 1, endPeriod: 2, phasing: 'even', canDelete: true },
  { id: startId + 10, name: 'Landscaping & External',  method: 'rate_net_developable',  value: 30,   baseType: '', startPeriod: 3, endPeriod: 4, phasing: 'even', canDelete: true },
  { id: startId + 11, name: 'FF&E / Interior Design',  method: 'rate_bua',              value: 50,   baseType: '', startPeriod: 4, endPeriod: 4, phasing: 'even', canDelete: true },
];

// ── Country data ─────────────────────────────────────────────────────────────
export const COUNTRY_DATA = [
  { name: 'Saudi Arabia',      flag: '🇸🇦', currency: 'SAR' },
  { name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED' },
  { name: 'Qatar',             flag: '🇶🇦', currency: 'QAR' },
  { name: 'Kuwait',            flag: '🇰🇼', currency: 'KWD' },
  { name: 'Bahrain',           flag: '🇧🇭', currency: 'BHD' },
  { name: 'Oman',              flag: '🇴🇲', currency: 'OMR' },
  { name: 'Jordan',            flag: '🇯🇴', currency: 'JOD' },
  { name: 'Egypt',             flag: '🇪🇬', currency: 'EGP' },
  { name: 'Turkey',            flag: '🇹🇷', currency: 'TRY' },
  { name: 'Pakistan',          flag: '🇵🇰', currency: 'PKR' },
  { name: 'India',             flag: '🇮🇳', currency: 'INR' },
  { name: 'China',             flag: '🇨🇳', currency: 'CNY' },
  { name: 'Japan',             flag: '🇯🇵', currency: 'JPY' },
  { name: 'Singapore',         flag: '🇸🇬', currency: 'SGD' },
  { name: 'Australia',         flag: '🇦🇺', currency: 'AUD' },
  { name: 'United States',     flag: '🇺🇸', currency: 'USD' },
  { name: 'United Kingdom',    flag: '🇬🇧', currency: 'GBP' },
  { name: 'European Union',    flag: '🇪🇺', currency: 'EUR' },
  { name: 'Canada',            flag: '🇨🇦', currency: 'CAD' },
  { name: 'South Africa',      flag: '🇿🇦', currency: 'ZAR' },
];

// ── Sidebar modules ───────────────────────────────────────────────────────────
// The three static nav entries (Dashboard, Projects, Overview) are not modules;
// the 11 module rows are derived from the shared MODULES constant in
// `../lib/modules-config.ts` so Sidebar + Dashboard never drift.
interface SidebarNavItem {
  key: string;
  icon: string;
  label: string;
  featureKey: string | null;
  requiredPlan: 'free' | 'professional' | 'enterprise' | null;
  badge: string | null;
  badgeClass: string;
  disabled?: boolean;
  disabledReason?: string;
}

const STATIC_NAV: readonly SidebarNavItem[] = [
  { key: 'dashboard', icon: '📊', label: 'Dashboard', featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
  { key: 'projects',  icon: '🏗️', label: 'Projects',  featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
  { key: 'overview',  icon: '📋', label: 'Overview',  featureKey: null, requiredPlan: null, badge: null, badgeClass: '', disabledReason: 'Select a project first' },
];

export const sidebarModules: readonly SidebarNavItem[] = [
  ...STATIC_NAV,
  ...MODULES.map((m): SidebarNavItem => ({
    key: m.key,
    icon: m.icon,
    label: `Module ${m.num} - ${m.shortLabel}`,
    featureKey: m.featureKey,
    requiredPlan: m.requiredPlan,
    badge:      m.status === 'done' ? '✓'    : m.status === 'soon' ? 'SOON' : null,
    badgeClass: m.status === 'done' ? 'badge-done' : m.status === 'soon' ? 'badge-soon' : '',
    disabled: m.disabled,
    disabledReason: m.disabledReason,
  })),
];

// `hierarchy` is the new M1.5 default-landing tab for brand-new
// projects (assets.length === 0). The full tree-view + CRUD lands in
// M1.5/6 - M1.5/10; for now M1.5/5 ships an onboarding empty-state so
// the routing has somewhere to send the user.
export const m1Tabs = [
  { key: 'hierarchy', icon: '🗂️', label: 'Hierarchy' },
  { key: 'timeline',  icon: '📅', label: 'Timeline' },
  { key: 'area',      icon: '🗺️', label: 'Land & Area' },
  { key: 'costs',     icon: '💸', label: 'Dev Costs' },
  { key: 'financing', icon: '🏦', label: 'Financing' },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function RealEstatePlatform() {
  // ── Navigation ──
  // activeTab default is 'hierarchy' (M1.5/5): brand-new sessions land
  // on the Hierarchy tab so the user sees the asset-creation flow first
  // rather than a half-empty Timeline. handleLoadVersion (existing
  // project) and handleCreateProject (new project) both re-route this
  // explicitly after store hydration so the choice always reflects
  // assets.length AT THE TIME the project becomes active, not at first
  // mount.
  const [activeModule, setActiveModule] = useState('dashboard');
  const [activeTab, setActiveTab] = useState('hierarchy');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSubOpen, setSidebarSubOpen] = useState(true);

  // ── Subscription / plan gating ──
  // Pre-launch: lock all premium features. Permissions system removed in Phase 5
  // of the admin cleanup; restore real plan-based gating before charging users.
  const canAccess = (_featureKey: string) => false;
  const subLoaded = true;
  const [upgradePrompt, setUpgradePrompt] = useState<{ featureKey: string; requiredPlan: 'professional' | 'enterprise' } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // ── RBAC ──
  const [currentUserRole, setCurrentUserRole] = useState<Role>(ROLES.ADMIN);
  const [rbacModalOpen, setRbacModalOpen] = useState(false);
  const [rbacSelectedRole, setRbacSelectedRole] = useState<Role>(ROLES.ADMIN);

  // ── Project state (lifted to Zustand store, Phase M1.R/4) ──
  // Primitive scalars: pulled in one shallow read so the component re-renders
  // exactly when one of them changes.
  const {
    projectName, projectType, country, currency, modelType, projectStart,
    projectRoadsPct, projectFAR, projectNonEnclosedPct,
    costInputMode, nextCostId,
    interestRate, financingMode, globalDebtPct, capitalizeInterest,
    repaymentPeriods, repaymentMethod,
    allocBasis,
  } = useModule1Store(useShallow((s) => ({
    projectName: s.projectName,
    projectType: s.projectType,
    country: s.country,
    currency: s.currency,
    modelType: s.modelType,
    projectStart: s.projectStart,
    projectRoadsPct: s.projectRoadsPct,
    projectFAR: s.projectFAR,
    projectNonEnclosedPct: s.projectNonEnclosedPct,
    costInputMode: s.costInputMode,
    nextCostId: s.nextCostId,
    interestRate: s.interestRate,
    financingMode: s.financingMode,
    globalDebtPct: s.globalDebtPct,
    capitalizeInterest: s.capitalizeInterest,
    repaymentPeriods: s.repaymentPeriods,
    repaymentMethod: s.repaymentMethod,
    allocBasis: s.allocBasis,
  })));

  // Reference-typed slices: each store update produces a new array/object,
  // so React's === comparison drives re-renders correctly.
  const phases        = useModule1Store((s) => s.phases);
  const landParcels   = useModule1Store((s) => s.landParcels);
  const assets        = useModule1Store((s) => s.assets);
  const allCosts      = useModule1Store((s) => s.costs);
  const lineRatios    = useModule1Store((s) => s.lineRatios);
  const costStage     = useModule1Store((s) => s.costStage);
  const costScope     = useModule1Store((s) => s.costScope);
  const costDevFeeMode = useModule1Store((s) => s.costDevFeeMode);

  // ── M1.5/11: active sub-project + phase selectors ──
  // Hierarchy-tab CRUD lets the user maintain N sub-projects and N
  // phases per sub-project. Until each legacy tab (Timeline / Land &
  // Area / Dev Costs / Financing) gains full phase-aware reads, the
  // selectors at minimum let the user *see* which sub-project + phase
  // the current data slice corresponds to and switch between them. The
  // single-phase fixture pipeline keeps using phase[0] for math; the
  // selectors are wired into the store so future per-tab phase
  // awareness can read activeSubProjectId / activePhaseId directly.
  const subProjects        = useModule1Store((s) => s.subProjects);
  const activeSubProjectId = useModule1Store((s) => s.activeSubProjectId);
  const activePhaseId      = useModule1Store((s) => s.activePhaseId);
  const setActiveSubProjectId = useModule1Store((s) => s.setActiveSubProjectId);
  const setActivePhaseId      = useModule1Store((s) => s.setActivePhaseId);
  const phasesForActiveSubProject = useMemo(
    () => phases.filter(p => p.subProjectId === activeSubProjectId),
    [phases, activeSubProjectId],
  );

  // Clamp the active selectors when the underlying lists change. If
  // the previously-active sub-project / phase was deleted (or the
  // store hydrated to a fresh project that doesn't have it), fall back
  // to the first available so the dropdowns never read 'invalid'.
  useEffect(() => {
    if (subProjects.length === 0) return;
    if (!subProjects.some(sp => sp.id === activeSubProjectId)) {
      setActiveSubProjectId(subProjects[0].id);
    }
  }, [subProjects, activeSubProjectId, setActiveSubProjectId]);
  useEffect(() => {
    if (phasesForActiveSubProject.length === 0) return;
    if (!phasesForActiveSubProject.some(p => p.id === activePhaseId)) {
      setActivePhaseId(phasesForActiveSubProject[0].id);
    }
  }, [phasesForActiveSubProject, activePhaseId, setActivePhaseId]);

  // Phase 0 scalars (single-phase projects). Multi-phase editing surfaces
  // its own selectors when Module1Timeline gains the phase editor.
  const constructionPeriods = phases[0]?.constructionPeriods ?? 4;
  const operationsPeriods   = phases[0]?.operationsPeriods   ?? 5;
  const overlapPeriods      = phases[0]?.overlapPeriods      ?? 0;

  // Per-asset scalars derived from the assets[] array. The 3 canonical
  // legacy ids survive as named lookups so downstream code that still
  // talks in residential / hospitality / retail keeps working.
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a] as const)), [assets]);
  const resAsset  = assetById.get(LEGACY_ASSET_IDS.residential);
  const hospAsset = assetById.get(LEGACY_ASSET_IDS.hospitality);
  const retAsset  = assetById.get(LEGACY_ASSET_IDS.retail);

  const residentialPercent     = resAsset?.allocationPct ?? 0;
  const hospitalityPercent     = hospAsset?.allocationPct ?? 0;
  const retailPercent          = retAsset?.allocationPct ?? 0;
  const residentialDeductPct   = resAsset?.deductPct     ?? 10;
  const residentialEfficiency  = resAsset?.efficiencyPct ?? 85;
  const hospitalityDeductPct   = hospAsset?.deductPct    ?? 15;
  const hospitalityEfficiency  = hospAsset?.efficiencyPct ?? 80;
  const retailDeductPct        = retAsset?.deductPct     ?? 5;
  const retailEfficiency       = retAsset?.efficiencyPct ?? 90;

  // Per-asset cost arrays derived from the flat costs[] list.
  const residentialCosts = useMemo(() => allCosts.filter((c) => c.assetId === LEGACY_ASSET_IDS.residential), [allCosts]);
  const hospitalityCosts = useMemo(() => allCosts.filter((c) => c.assetId === LEGACY_ASSET_IDS.hospitality), [allCosts]);
  const retailCosts      = useMemo(() => allCosts.filter((c) => c.assetId === LEGACY_ASSET_IDS.retail),      [allCosts]);

  // ── Setter wrappers ──
  // The component still passes setX(value) / setX(prev => next) callbacks
  // to its tab children. These wrappers translate that React-shaped API
  // into store action calls so the tabs stay unchanged.
  type Updater<T> = StoreUpdater<T>;

  const setProjectName  = useCallback((v: string) => useModule1Store.getState().setProjectMeta({ projectName: v }), []);
  const setProjectType  = useCallback((v: ProjectType) => useModule1Store.getState().setProjectMeta({ projectType: v }), []);
  const setCountry      = useCallback((v: string) => useModule1Store.getState().setProjectMeta({ country: v }), []);
  const setCurrency     = useCallback((v: string) => useModule1Store.getState().setProjectMeta({ currency: v }), []);
  const setModelType    = useCallback((v: ModelType) => useModule1Store.getState().setProjectMeta({ modelType: v }), []);
  const setProjectStart = useCallback((v: string) => useModule1Store.getState().setProjectMeta({ projectStart: v }), []);

  // Phase-0 scalar setters: write through the single phase's id.
  const writePhase0 = useCallback((patch: Partial<{ constructionPeriods: number; operationsPeriods: number; overlapPeriods: number }>) => {
    const s = useModule1Store.getState();
    const p0 = s.phases[0];
    if (!p0) {
      // Defensive: if hydration didn't seed a phase, mint one from the patch.
      s.setPhases([makeDefaultPhase(DEFAULT_SUB_PROJECT_ID, patch.constructionPeriods ?? 0, patch.operationsPeriods ?? 0, patch.overlapPeriods ?? 0)]);
      return;
    }
    s.updatePhase(p0.id, { ...p0, ...patch, operationsStart: Math.max(1, (patch.constructionPeriods ?? p0.constructionPeriods) - (patch.overlapPeriods ?? p0.overlapPeriods) + 1) });
  }, []);
  const setConstructionPeriods = useCallback((v: number) => writePhase0({ constructionPeriods: v }), [writePhase0]);
  const setOperationsPeriods   = useCallback((v: number) => writePhase0({ operationsPeriods: v }),   [writePhase0]);
  const setOverlapPeriods      = useCallback((v: number) => writePhase0({ overlapPeriods: v }),      [writePhase0]);

  // Land parcel updater (supports React's prev-callback form).
  const setLandParcels = useCallback((updater: Updater<LandParcel[]>) => {
    const s = useModule1Store.getState();
    s.setLand({ landParcels: resolveStoreUpdater(updater, s.landParcels) });
  }, []);
  const setProjectRoadsPct       = useCallback((v: number) => useModule1Store.getState().setLand({ projectRoadsPct: v }), []);
  const setProjectFAR            = useCallback((v: number) => useModule1Store.getState().setLand({ projectFAR: v }), []);
  const setProjectNonEnclosedPct = useCallback((v: number) => useModule1Store.getState().setLand({ projectNonEnclosedPct: v }), []);

  // Per-asset field setters: write into assets[] by canonical id.
  const updateAssetField = useCallback((assetId: string, patch: Partial<{ allocationPct: number; deductPct: number; efficiencyPct: number; visible: boolean }>) => {
    useModule1Store.getState().updateAsset(assetId, patch);
  }, []);
  const setResidentialPercent     = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.residential, { allocationPct: v }), [updateAssetField]);
  const setHospitalityPercent     = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.hospitality, { allocationPct: v }), [updateAssetField]);
  const setRetailPercent          = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.retail,      { allocationPct: v }), [updateAssetField]);
  const setResidentialDeductPct   = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.residential, { deductPct:     v }), [updateAssetField]);
  const setResidentialEfficiency  = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.residential, { efficiencyPct: v }), [updateAssetField]);
  const setHospitalityDeductPct   = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.hospitality, { deductPct:     v }), [updateAssetField]);
  const setHospitalityEfficiency  = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.hospitality, { efficiencyPct: v }), [updateAssetField]);
  const setRetailDeductPct        = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.retail,      { deductPct:     v }), [updateAssetField]);
  const setRetailEfficiency       = useCallback((v: number) => updateAssetField(LEGACY_ASSET_IDS.retail,      { efficiencyPct: v }), [updateAssetField]);

  // Per-asset cost setters: stamp the assetId on every line so the flat
  // costs[] list stays consistent with its assetId discriminator.
  const setCostsForAssetWrapper = useCallback((assetId: string, updater: Updater<CostItem[]>) => {
    const s = useModule1Store.getState();
    const prev: CostItem[] = s.costs.filter((c) => c.assetId === assetId);
    const next = resolveStoreUpdater(updater, prev);
    const stamped: CostLine[] = next.map((c) => ({ ...(c as CostItem), assetId }));
    s.setCostsForAsset(assetId, stamped);
  }, []);
  const setResidentialCosts = useCallback((updater: Updater<CostItem[]>) => setCostsForAssetWrapper(LEGACY_ASSET_IDS.residential, updater), [setCostsForAssetWrapper]);
  const setHospitalityCosts = useCallback((updater: Updater<CostItem[]>) => setCostsForAssetWrapper(LEGACY_ASSET_IDS.hospitality, updater), [setCostsForAssetWrapper]);
  const setRetailCosts      = useCallback((updater: Updater<CostItem[]>) => setCostsForAssetWrapper(LEGACY_ASSET_IDS.retail,      updater), [setCostsForAssetWrapper]);

  const setCostInputMode = useCallback((v: CostInputMode) => useModule1Store.getState().setCostInputMode(v), []);
  const setNextCostId    = useCallback((updater: Updater<number>) => {
    const s = useModule1Store.getState();
    s.setNextCostId(resolveStoreUpdater(updater, s.nextCostId));
  }, []);
  const setCostStage     = useCallback((updater: Updater<Record<number, number>>) => {
    const s = useModule1Store.getState();
    s.setCostStage(resolveStoreUpdater(updater, s.costStage));
  }, []);
  const setCostScope     = useCallback((updater: Updater<Record<number, string>>) => {
    const s = useModule1Store.getState();
    s.setCostScope(resolveStoreUpdater(updater, s.costScope));
  }, []);
  const setCostDevFeeMode = useCallback((updater: Updater<Record<number, string>>) => {
    const s = useModule1Store.getState();
    s.setCostDevFeeMode(resolveStoreUpdater(updater, s.costDevFeeMode));
  }, []);
  const setAllocBasis    = useCallback((v: 'direct_cost' | 'gfa') => useModule1Store.getState().setAllocBasis(v), []);

  const setInterestRate       = useCallback((v: number) => useModule1Store.getState().setFinancing({ interestRate: v }), []);
  const setFinancingMode      = useCallback((v: FinancingMode) => useModule1Store.getState().setFinancing({ financingMode: v }), []);
  const setGlobalDebtPct      = useCallback((v: number) => useModule1Store.getState().setFinancing({ globalDebtPct: v }), []);
  const setCapitalizeInterest = useCallback((v: boolean) => useModule1Store.getState().setFinancing({ capitalizeInterest: v }), []);
  const setRepaymentPeriods   = useCallback((v: number) => useModule1Store.getState().setFinancing({ repaymentPeriods: v }), []);
  const setRepaymentMethod    = useCallback((v: RepaymentMethod) => useModule1Store.getState().setFinancing({ repaymentMethod: v }), []);
  const setLineRatios         = useCallback((updater: Updater<Record<string, number>>) => {
    const s = useModule1Store.getState();
    s.setFinancing({ lineRatios: resolveStoreUpdater(updater, s.lineRatios) });
  }, []);

  // ── Project Manager ──
  const [pmModal, setPmModal] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [pmToast, setPmToast] = useState<{ msg: string; color: string } | null>(null);
  const [pmInputVal, setPmInputVal] = useState('');
  const [pmLocationVal, setPmLocationVal] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [storageData, setStorageData] = useState<StorageShape>({ projects: {}, activeProjectId: null, activeVersionId: null });
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf,   setExportingPdf]   = useState(false);

  // ── Register current platform for per-platform branding overrides ──
  const setCurrentPlatform = useBrandingStore((s) => s.setCurrentPlatform);
  useEffect(() => {
    setCurrentPlatform('refm');
    return () => setCurrentPlatform(null);
  }, [setCurrentPlatform]);

  // ── Init from server (post-M1.6) ──
  // Replaces the pre-M1.6 localStorage hydration. Order matters:
  //   1. Run the one-shot migrator if user is authed and a legacy
  //      `refm_v2` blob exists locally with no server projects yet.
  //      Idempotency flag in localStorage prevents re-runs.
  //   2. Fetch the user's projects from /api/refm/projects.
  //   3. Synthesize the StorageShape contract from the response.
  //   4. If a previously-active project id is cached and still exists
  //      on the server, mark it active and call attachToProject (which
  //      hydrates the store + wires the auto-save subscriber).
  // Each step degrades gracefully: a server failure leaves the picker
  // empty rather than blocking the whole UI.
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const refreshActiveVersions = useCallback(async (pid: string) => {
    const res = await pclient.listVersions(pid);
    if (res.error || !res.data) return;
    setStorageData(prev => {
      const proj = prev.projects[pid];
      if (!proj) return prev;
      const versions: StorageProject['versions'] = {};
      for (const v of res.data!.versions) {
        versions[v.id] = {
          name:      v.label ?? `Version ${v.version_number}`,
          createdAt: v.created_at,
          data:      null,   // not pre-loaded; loadVersionInto fetches on demand
        };
      }
      return {
        ...prev,
        projects: {
          ...prev.projects,
          [pid]: { ...proj, versions, versionCount: res.data!.versions.length },
        },
      };
    });
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Step 1: migrator (best-effort; surfaces errors via toast).
      // Toast color reflects outcome: green = clean, amber = uploaded
      // some data but hit warnings (M1.6/7: includes "snapshot shape
      // unrecognized; uploaded as defaults" cases — silent default-
      // substitution would otherwise hide data loss). Console always
      // gets the full per-error breakdown.
      if (userId) {
        const mig = await runOneShotMigration(userId);
        if (mig.ran || mig.errors.length > 0) {
          const projPart = `${mig.projectsCreated} project${mig.projectsCreated === 1 ? '' : 's'}`;
          const verPart  = `${mig.versionsCreated} version${mig.versionsCreated === 1 ? '' : 's'}`;
          const warnPart = mig.errors.length > 0
            ? ` with ${mig.errors.length} warning${mig.errors.length === 1 ? '' : 's'} (see browser console)`
            : '';
          if (mig.projectsCreated > 0) {
            setPmToast({
              msg:   `Migrated ${projPart} (${verPart}) from your browser to the cloud${warnPart}.`,
              color: mig.errors.length > 0 ? 'var(--color-gold-dark)' : 'var(--color-green-dark)',
            });
          } else if (mig.errors.length > 0) {
            // Edge case: 0 projects created but errors fired (e.g.
            // every legacy project had no versions). User should know.
            setPmToast({
              msg:   `Migration encountered ${mig.errors.length} warning${mig.errors.length === 1 ? '' : 's'} (see browser console).`,
              color: 'var(--color-gold-dark)',
            });
          }
        }
        if (mig.errors.length && typeof console !== 'undefined') {
          console.warn('[REFM] migration errors:', mig.errors);
        }
      }
      if (cancelled) return;

      // Step 2: fetch project list from server.
      const list = await pclient.listProjects();
      if (cancelled) return;
      const serverProjects = list.data?.projects ?? [];

      // Step 3: pick last-active id. Prefer the cached one if it
      // still exists; otherwise leave activeProjectId null.
      const cachedActiveId = readActiveProjectId();
      const restoredActive = cachedActiveId && serverProjects.some(p => p.id === cachedActiveId)
        ? cachedActiveId
        : null;
      setStorageData(projectsToStorageShape(serverProjects, restoredActive, null));
      if (restoredActive) setActiveProjectId(restoredActive);

      // Step 4: attach to the restored project (load snapshot into
      // the Zustand store + start auto-save loop).
      if (restoredActive) {
        const attachRes = await attachSyncToProject(restoredActive);
        if (cancelled) return;
        if (attachRes.error && attachRes.loaded === 'none') {
          setPmToast({ msg: `Could not load project: ${attachRes.error}`, color: 'var(--color-negative)' });
        }
        // Pre-fill the version metadata so VersionModal / OverviewScreen
        // render correct counts and entries from first paint.
        await refreshActiveVersions(restoredActive);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, refreshActiveVersions]);

  // Tear down the auto-save subscriber on unmount (e.g. user navigates
  // away from REFM). attachSyncToProject also calls detach internally
  // before subscribing to a new project, so this only matters for the
  // navigate-away case.
  useEffect(() => () => detachSync(), []);

  // ── Default costs init (Land Cash id:1 canDelete:false + default items) ──
  // Re-seeds whenever a per-asset cost array becomes empty: covers both
  // the first-mount case (store hydrated to defaults with no cost lines)
  // and the post-load case (a saved snapshot whose costs[] for an asset
  // somehow ended up empty would otherwise render an empty Costs tab
  // with no way to recover short of a hard reload).
  //
  // Phase M1.5/5: each branch is gated on the corresponding asset
  // actually existing in the store. Brand-new projects start with
  // assets=[] and are routed to the Hierarchy tab to create their
  // first asset; we must NOT stamp orphaned cost lines with a
  // residential/hospitality/retail assetId when no such asset exists,
  // or the costs[] array would carry referentially-invalid rows.
  useEffect(() => {
    if (resAsset && residentialCosts.length === 0) {
      const initLandValue = (totalLandArea * cashPercent / 100) * (residentialPercent / 100) * landValuePerSqm;
      setResidentialCosts([
        { id: 1, name: 'Land (Cash Portion)', method: 'fixed', value: initLandValue, baseType: '', selectedIds: [], startPeriod: 0, endPeriod: 0, phasing: 'even', canDelete: false },
        ...makeDefaultCosts(2),
      ]);
    }
    if (hospAsset && hospitalityCosts.length === 0) {
      const initLandValue = (totalLandArea * cashPercent / 100) * (hospitalityPercent / 100) * landValuePerSqm;
      setHospitalityCosts([
        { id: 1, name: 'Land (Cash Portion)', method: 'fixed', value: initLandValue, baseType: '', selectedIds: [], startPeriod: 0, endPeriod: 0, phasing: 'even', canDelete: false },
        ...makeDefaultCosts(2),
      ]);
    }
    if (retAsset && retailCosts.length === 0) {
      const initLandValue = (totalLandArea * cashPercent / 100) * (retailPercent / 100) * landValuePerSqm;
      setRetailCosts([
        { id: 1, name: 'Land (Cash Portion)', method: 'fixed', value: initLandValue, baseType: '', selectedIds: [], startPeriod: 0, endPeriod: 0, phasing: 'even', canDelete: false },
        ...makeDefaultCosts(2),
      ]);
    }
    // The closure reads totalLandArea / cashPercent / landValuePerSqm
    // (declared further down the component body) at call time. We list
    // landParcels here as the upstream source that drives all three.
    // resAsset/hospAsset/retAsset gate each branch so brand-new
    // empty-assets projects don't get orphan cost rows seeded.
  }, [
    residentialCosts.length, hospitalityCosts.length, retailCosts.length,
    landParcels, residentialPercent, hospitalityPercent, retailPercent,
    resAsset, hospAsset, retAsset,
    setResidentialCosts, setHospitalityCosts, setRetailCosts,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep Land Cash value in sync when land inputs change ──
  useEffect(() => {
    const updateLandCash = (prev: CostItem[], assetPct: number) => {
      if (prev.length === 0) return prev;
      const v = costInputMode === 'same-for-all'
        ? (totalLandArea * cashPercent / 100) * landValuePerSqm
        : (totalLandArea * cashPercent / 100) * (assetPct / 100) * landValuePerSqm;
      return prev.map(c => c.canDelete === false ? { ...c, value: v } : c);
    };
    setResidentialCosts(prev => updateLandCash(prev, residentialPercent));
    setHospitalityCosts(prev => updateLandCash(prev, hospitalityPercent));
    setRetailCosts(prev => updateLandCash(prev, retailPercent));
  }, [landParcels, residentialPercent, hospitalityPercent, retailPercent, costInputMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Body class for overflow ──
  useEffect(() => {
    document.body.classList.add('refm-active');
    return () => document.body.classList.remove('refm-active');
  }, []);

  // ── Dark mode (workspace-scoped) ──
  // Theme intent is independent of the Modeling Hub sidebar layout, so we
  // use a separate localStorage key (`refmDarkMode`) from the hub's
  // `modelingDarkMode`. A user may want a dark workspace for sustained
  // modeling sessions while keeping the hub light, or vice versa.
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('refmDarkMode');
    if (stored === 'true' || stored === 'false') {
      setDarkMode(stored === 'true');
    } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      setDarkMode(true);
    }
  }, []);

  // Sync the data attribute on <body>. Theme overrides in globals.css are
  // scoped to `body[data-refm-theme="dark"]` so admin and Training Hub get
  // zero leakage — the attribute exists only while RealEstatePlatform is
  // mounted and is removed on unmount.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.refmTheme = darkMode ? 'dark' : 'light';
    return () => { delete document.body.dataset.refmTheme; };
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('refmDarkMode', String(next));
      }
      return next;
    });
  }, []);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (pmToast) {
      const t = setTimeout(() => setPmToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [pmToast]);

  // ── Mark unsaved on state changes ──
  useEffect(() => { setHasUnsaved(true); }, [
    projectName, projectType, country, currency, modelType,
    projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
    landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
    residentialPercent, hospitalityPercent, retailPercent,
    residentialDeductPct, residentialEfficiency,
    hospitalityDeductPct, hospitalityEfficiency,
    retailDeductPct, retailEfficiency,
    residentialCosts, hospitalityCosts, retailCosts, costInputMode,
    interestRate, financingMode, globalDebtPct, capitalizeInterest,
    repaymentPeriods, repaymentMethod, lineRatios,
  ]);

  // ── Permissions ──
  const can = useCallback(
    (permission: keyof PermissionMap) => !!(PERMISSIONS[currentUserRole]?.[permission]),
    [currentUserRole]
  );
  const canSeeModule = useCallback(
    (moduleKey: string) => (MODULE_VISIBILITY[currentUserRole] || []).includes(moduleKey as ModuleKey),
    [currentUserRole]
  );

  // ── Land aggregates ──
  const totalLandArea   = landParcels.reduce((s, p) => s + (p.area || 0), 0);
  const totalLandValue  = landParcels.reduce((s, p) => s + p.area * p.rate, 0);
  const landValuePerSqm = totalLandArea > 0 ? totalLandValue / totalLandArea : 0;
  const cashValue       = landParcels.reduce((s, p) => s + p.area * p.rate * p.cashPct / 100, 0);
  const inKindValue     = totalLandValue - cashValue;
  const cashPercent     = totalLandValue > 0 ? (cashValue / totalLandValue) * 100 : 0;
  const inKindPercent   = 100 - cashPercent;

  // ── Area hierarchy ──
  const showResidential  = projectType === 'residential' || projectType === 'mixed-use';
  const showHospitality  = projectType === 'hospitality' || projectType === 'mixed-use';
  const showRetail       = retailPercent > 0;

  // Keep the store's assets[i].visible field in sync with the projectType
  // / retailPercent semantics that drive show flags here. A custom asset
  // added via the (forthcoming) multi-asset UI will manage its own
  // visibility directly; for the 3 canonical legacy ids we mirror the
  // derivation so toLegacySnapshot's read of allocationPct / visible
  // round-trips cleanly even when storage is bumped to v3.
  useEffect(() => {
    const s = useModule1Store.getState();
    const want: Record<string, boolean> = {
      [LEGACY_ASSET_IDS.residential]: showResidential,
      [LEGACY_ASSET_IDS.hospitality]: showHospitality,
      [LEGACY_ASSET_IDS.retail]:      showRetail,
    };
    s.assets.forEach((a) => {
      if (a.id in want && a.visible !== want[a.id]) {
        s.updateAsset(a.id, { visible: want[a.id] });
      }
    });
  }, [showResidential, showHospitality, showRetail]);
  const projectRoadsArea = totalLandArea * (projectRoadsPct / 100);
  const projectNDA       = totalLandArea - projectRoadsArea;
  const totalProjectGFA  = projectNDA * projectFAR;
  const residentialGFA   = showResidential ? totalProjectGFA * (residentialPercent / 100) : 0;
  const hospitalityGFA   = showHospitality ? totalProjectGFA * (hospitalityPercent / 100) : 0;
  const retailGFA        = showRetail ? totalProjectGFA * (retailPercent / 100) : 0;
  const residentialBUA          = residentialGFA * (1 - residentialDeductPct / 100);
  const residentialNetSaleable  = residentialBUA * (residentialEfficiency / 100);
  const hospitalityBUA          = hospitalityGFA * (1 - hospitalityDeductPct / 100);
  const hospitalityNetSaleable  = hospitalityBUA * (hospitalityEfficiency / 100);
  const retailBUA               = retailGFA * (1 - retailDeductPct / 100);
  const retailNetSaleable       = retailBUA * (retailEfficiency / 100);

  // ── Project end date ──
  const getProjectEndDate = useCallback((): string => {
    const startDate = new Date(projectStart);
    const effectivePeriods = constructionPeriods + operationsPeriods - overlapPeriods;
    const totalMonths = modelType === 'monthly' ? effectivePeriods : effectivePeriods * 12;
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + totalMonths);
    endDate.setDate(0);
    return endDate.toISOString().split('T')[0];
  }, [projectStart, constructionPeriods, operationsPeriods, overlapPeriods, modelType]);

  // ── Area helper ──
  const getAreas = useCallback((assetType: string): AreaMetrics => {
    const pct = assetType === 'residential' ? residentialPercent / 100
      : assetType === 'hospitality' ? hospitalityPercent / 100
      : assetType === 'retail' ? retailPercent / 100 : 1;
    const gfa  = totalProjectGFA * pct;
    const deductPct = assetType === 'residential' ? residentialDeductPct
      : assetType === 'hospitality' ? hospitalityDeductPct
      : assetType === 'retail' ? retailDeductPct : 0;
    const effPct = assetType === 'residential' ? residentialEfficiency
      : assetType === 'hospitality' ? hospitalityEfficiency
      : assetType === 'retail' ? retailEfficiency : 100;
    const bua = gfa * (1 - deductPct / 100);
    const nsa = bua * (effPct / 100);
    const landVal = totalLandValue * pct;
    return {
      totalAllocated: totalLandArea * pct,
      netDevelopable: projectNDA * pct,
      roadsArea:      projectRoadsArea * pct,
      gfa, bua, nsa,
      landValue:      landVal,
      cashLandValue:  landVal * (cashPercent / 100),
      inKindLandValue: landVal * (inKindPercent / 100),
    };
  }, [
    residentialPercent, hospitalityPercent, retailPercent,
    totalProjectGFA, totalLandArea, projectNDA, projectRoadsArea,
    totalLandValue, cashPercent, inKindPercent,
    residentialDeductPct, hospitalityDeductPct, retailDeductPct,
    residentialEfficiency, hospitalityEfficiency, retailEfficiency,
  ]);

  // ── Cost calculation ──
  const calculateItemTotal = useCallback((cost: CostItem, assetType: string, costsArr?: CostItem[]): number => {
    const a = getAreas(assetType);
    // Fix 1: In same-for-all mode, fixed amounts are project-level totals and must be
    // proportioned by this asset's land allocation share (restores legacy getSameForAllFactor).
    const getSameForAllFactor = (): number => {
      if (costInputMode !== 'same-for-all' || cost.canDelete === false) return 1;
      const totalAlloc =
        (showResidential ? residentialPercent : 0) +
        (showHospitality ? hospitalityPercent : 0) +
        (showRetail      ? retailPercent      : 0);
      if (totalAlloc <= 0) return 0;
      const thisAlloc = assetType === 'residential' ? residentialPercent
        : assetType === 'hospitality' ? hospitalityPercent
        : retailPercent;
      return thisAlloc / totalAlloc;
    };
    switch (cost.method) {
      case 'fixed':                 return cost.value * getSameForAllFactor();
      case 'rate_total_allocated':  return cost.value * a.totalAllocated;
      case 'rate_net_developable':  return cost.value * a.netDevelopable;
      case 'rate_roads':            return cost.value * a.roadsArea;
      case 'rate_gfa':              return cost.value * a.gfa;
      case 'rate_bua':              return cost.value * a.bua;
      case 'percent_total_land':    return (cost.value / 100) * a.landValue;
      case 'percent_cash_land':     return (cost.value / 100) * a.cashLandValue;
      case 'percent_inkind_land':   return (cost.value / 100) * a.inKindLandValue;
      case 'percent_base': {
        // Fix 2: Restore selectedIds mechanism - base = only explicitly checked items.
        const base = (cost.selectedIds ?? [])
          .filter(sid => sid !== cost.id)
          .map(sid => (costsArr ?? []).find(c => c.id === sid))
          .filter((c): c is CostItem => c !== undefined)
          // eslint-disable-next-line -- self-referential useCallback (safe: closure resolves at call time)
          .reduce((s, c) => s + calculateItemTotal(c, assetType, costsArr), 0);
        return (cost.value / 100) * base;
      }
      default: return 0;
    }
  }, [getAreas, costInputMode, showResidential, showHospitality, showRetail,
      residentialPercent, hospitalityPercent, retailPercent]);

  const getPhasingValues = useCallback((cost: CostItem): number[] => {
    if (typeof cost.phasing === 'string') return [];
    if (cost.phasing.type === 'manual' && cost.phasing.values) return cost.phasing.values;
    return [];
  }, []);

  const getPhasingMode = useCallback((cost: CostItem): string => {
    if (typeof cost.phasing === 'string') return cost.phasing;
    return cost.phasing.type;
  }, []);

  const distributeCost = useCallback((cost: CostItem, assetType: string): number[] => {
    const total = calculateItemTotal(cost, assetType);
    // Fix 3: Array length = constructionPeriods + 1; index 0 = period 0, index n = period n.
    const distribution = new Array(constructionPeriods + 1).fill(0);
    // Explicit period-0 handler: Land Cash, RETT, Royal Commission Premium, etc.
    if (cost.startPeriod === 0 && cost.endPeriod === 0) {
      distribution[0] = total;
      return distribution;
    }
    const mode = getPhasingMode(cost);
    if (mode === 'even') {
      const cnt = cost.endPeriod - cost.startPeriod + 1;
      const amt = cnt > 0 ? total / cnt : 0;
      for (let i = cost.startPeriod; i <= cost.endPeriod && i <= constructionPeriods; i++) {
        distribution[i] = amt;
      }
    } else {
      // Manual phasing: values are percentages summing to 100
      const pcts = getPhasingValues(cost);
      pcts.forEach((pct, idx) => {
        const p = cost.startPeriod + idx;
        if (p <= constructionPeriods) distribution[p] = total * (pct / 100);
      });
    }
    return distribution;
  }, [calculateItemTotal, constructionPeriods, getPhasingMode, getPhasingValues]);

  // ── Per-asset land values ──
  const residentialLandValue = showResidential ? totalLandArea * (residentialPercent / 100) * landValuePerSqm : 0;
  const hospitalityLandValue = showHospitality ? totalLandArea * (hospitalityPercent / 100) * landValuePerSqm : 0;
  const retailLandValue      = showRetail      ? totalLandArea * (retailPercent      / 100) * landValuePerSqm : 0;

  // ── Line-level debt helpers ──
  const getLineDebtPct = useCallback((name: string): number => {
    if (financingMode === 'fixed') return globalDebtPct;
    return lineRatios[name] !== undefined ? lineRatios[name] : globalDebtPct;
  }, [financingMode, globalDebtPct, lineRatios]);

  const setLineDebtPct = useCallback((name: string, val: number) => {
    setLineRatios(prev => ({ ...prev, [name]: Math.min(100, Math.max(0, parseFloat(String(val)) || 0)) }));
  }, [setLineRatios]);

  // ── calcSameForAllDisplayTotal ──
  const calcSameForAllDisplayTotal = useCallback((cost: CostItem): number => {
    if (cost.canDelete === false) {
      const firstAsset = showResidential ? 'residential' : showHospitality ? 'hospitality' : 'retail';
      return calculateItemTotal(cost, firstAsset);
    }
    const assets = [
      ...(showResidential ? ['residential'] : []),
      ...(showHospitality ? ['hospitality'] : []),
      ...(showRetail      ? ['retail']      : []),
    ];
    return assets.reduce((sum, a) => sum + calculateItemTotal(cost, a), 0);
  }, [showResidential, showHospitality, showRetail, calculateItemTotal]);

  // ── Fix 6: calcItemTotalV14 - developer fee circular reference formula ──
  // When devFeeMode='include' and method='percent_base': total = base * rate / (1 - rate)
  const calcItemTotalV14 = useCallback((cost: CostItem, assetType: string, costsArr?: CostItem[]): number => {
    if (cost.method === 'percent_base' && costDevFeeMode[cost.id] === 'include') {
      const rate = (parseFloat(String(cost.value)) || 0) / 100;
      if (rate >= 1) return 0;
      const arr = costsArr ?? (assetType === 'residential' ? residentialCosts : assetType === 'hospitality' ? hospitalityCosts : retailCosts);
      const selectedBase = (cost.selectedIds ?? [])
        .filter(sid => sid !== cost.id)
        .map(sid => arr.find(c => c.id === sid))
        .filter((c): c is CostItem => c !== undefined)
        .reduce((sum, c) => sum + calculateItemTotal(c, assetType, arr), 0);
      return (selectedBase * rate) / (1 - rate);
    }
    return calculateItemTotal(cost, assetType, costsArr);
  }, [calculateItemTotal, costDevFeeMode, residentialCosts, hospitalityCosts, retailCosts]);

  // ── Fix 7: allocateToAssets - proportion of project-scope cost for an asset ──
  const allocateToAssets = useCallback((cost: CostItem, assetType: string): number => {
    const scope = costScope[cost.id] ?? (cost.id <= 4 ? 'asset' : 'project');
    if (scope === 'asset') return 1;
    const totalGFAAll =
      (showResidential ? residentialGFA : 0) +
      (showHospitality ? hospitalityGFA : 0) +
      (showRetail      ? retailGFA      : 0);
    if (allocBasis === 'gfa') {
      const assetGFA = assetType === 'residential' ? residentialGFA
        : assetType === 'hospitality' ? hospitalityGFA : retailGFA;
      return totalGFAAll > 0 ? assetGFA / totalGFAAll : 0;
    }
    // direct_cost basis: allocate by each asset's Stage-1 direct cost
    const getDirectCost = (a: string, arr: CostItem[]) =>
      arr.filter(c => (costScope[c.id] ?? (c.id <= 4 ? 'asset' : 'project')) === 'asset')
         .reduce((s, c) => s + calculateItemTotal(c, a, arr), 0);
    const directByAsset: Record<string, number> = {
      residential: showResidential ? getDirectCost('residential', residentialCosts) : 0,
      hospitality: showHospitality ? getDirectCost('hospitality', hospitalityCosts) : 0,
      retail:      showRetail      ? getDirectCost('retail',      retailCosts)      : 0,
    };
    const totalDirect = directByAsset.residential + directByAsset.hospitality + directByAsset.retail;
    return totalDirect > 0 ? (directByAsset[assetType] || 0) / totalDirect : 0;
  }, [costScope, showResidential, showHospitality, showRetail, allocBasis,
      residentialGFA, hospitalityGFA, retailGFA,
      residentialCosts, hospitalityCosts, retailCosts, calculateItemTotal]);

  // ── Fix 7: getAssetDirectCost - total cost for an asset using calcItemTotalV14 ──
  const getAssetDirectCost = useCallback((assetType: string): number => {
    const costs = assetType === 'residential' ? residentialCosts
      : assetType === 'hospitality' ? hospitalityCosts : retailCosts;
    return costs.reduce((sum, cost) => sum + calcItemTotalV14(cost, assetType, costs), 0);
  }, [calcItemTotalV14, residentialCosts, hospitalityCosts, retailCosts]);

  // ── Sync same-for-all to all assets ──
  const syncSameForAllToAllAssets = useCallback((masterCosts: CostItem[]) => {
    const nonLand = masterCosts.filter(c => c.canDelete !== false);
    if (showHospitality) setHospitalityCosts(prev => {
      const landLine = prev.find(c => c.canDelete === false);
      return [...(landLine ? [landLine] : []), ...nonLand.map(c => ({ ...c }))];
    });
    if (showRetail) setRetailCosts(prev => {
      const landLine = prev.find(c => c.canDelete === false);
      return [...(landLine ? [landLine] : []), ...nonLand.map(c => ({ ...c }))];
    });
  }, [showHospitality, showRetail, setHospitalityCosts, setRetailCosts]);

  // ── handleCostInputModeChange ──
  const handleCostInputModeChange = useCallback((newMode: CostInputMode) => {
    if (newMode === 'same-for-all') syncSameForAllToAllAssets(residentialCosts);
    setCostInputMode(newMode);
  }, [syncSameForAllToAllAssets, residentialCosts, setCostInputMode]);

  // ── buildAssetFinancing ──
  // Phase M1.R/3: this is now a thin wrapper around the pure
  // buildAssetFinancing in @core/calculations. The React component, the
  // snapshot pipeline (scripts/module1-pipeline.ts), and any future
  // consumer all share that single implementation, so the prior
  // "lockstep contract" between this closure and an inlined copy in the
  // pipeline no longer exists.
  const buildAssetFinancing = useCallback((assetType: string): FinancingResult => {
    const costs = assetType === 'residential' ? residentialCosts
      : assetType === 'hospitality' ? hospitalityCosts
      : retailCosts;

    const assetPercents: Record<string, number> = {
      residential: residentialPercent,
      hospitality: hospitalityPercent,
      retail:      retailPercent,
    };
    const showFlags: Record<string, boolean> = {
      residential: showResidential,
      hospitality: showHospitality,
      retail:      showRetail,
    };

    return buildAssetFinancingCore({
      assetType,
      areas: getAreas(assetType),
      costs,
      constructionPeriods,
      operationsPeriods,
      interestRate,
      modelType,
      repaymentPeriods,
      capitalizeInterest,
      costInputMode,
      financingMode,
      globalDebtPct,
      lineRatios,
      assetPercents,
      showFlags,
    });
  }, [
    residentialCosts, hospitalityCosts, retailCosts,
    constructionPeriods, operationsPeriods,
    interestRate, modelType, repaymentPeriods, capitalizeInterest,
    getAreas, costInputMode, financingMode, globalDebtPct, lineRatios,
    residentialPercent, hospitalityPercent, retailPercent,
    showResidential, showHospitality, showRetail,
  ]);

  const finRes  = showResidential ? buildAssetFinancing('residential') : null;
  const finHosp = showHospitality ? buildAssetFinancing('hospitality')  : null;
  const finRet  = showRetail      ? buildAssetFinancing('retail')       : null;

  // ── Save version (post-M1.6) ──
  // Explicit user-named save. Posts to /api/refm/projects/[id]/versions
  // with the current store snapshot + label. Auto-save (background,
  // unlabeled) runs separately via the module1-sync subscriber and
  // does not go through this handler.
  const handleSaveVersion = useCallback((versionName: string) => {
    if (!activeProjectId) {
      setPmToast({ msg: 'Select or create a project first', color: 'var(--color-negative)' });
      return;
    }
    const pid = activeProjectId;
    (async () => {
      const liveState = useModule1Store.getState();
      const snapshot = extractHydrateSnapshot(liveState);
      const assetMix = liveState.assets.filter(a => a.visible).map(a => a.name);
      const res = await pclient.saveVersion(pid, {
        snapshot,
        label: versionName || null,
        assetMix,
      });
      if (res.error || !res.data) {
        setPmToast({ msg: `Save failed: ${res.error ?? 'unknown error'}`, color: 'var(--color-negative)' });
        return;
      }
      // Update local state to reflect the new version + bumped
      // lastModified. Refreshing the full version list is cheap and
      // guarantees the modal sees consistent ordering.
      setActiveVersionId(res.data.version.id);
      setLastSavedAt(new Date().toLocaleTimeString());
      setHasUnsaved(false);
      setPmToast({ msg: '✓ Version saved', color: 'var(--color-green-dark)' });
      void refreshActiveVersions(pid);
      // Also refresh the project tile (lastModified / asset_mix may
      // have changed). One-line update; no need to re-fetch the list.
      setStorageData(prev => {
        const proj = prev.projects[pid];
        if (!proj) return prev;
        return {
          ...prev,
          projects: {
            ...prev.projects,
            [pid]: {
              ...proj,
              lastModified: res.data!.project.updated_at,
              assetMix:     res.data!.project.asset_mix,
            },
          },
        };
      });
    })();
  }, [activeProjectId, refreshActiveVersions]);

  // ── Create project (post-M1.6) ──
  // Resets the store to defaults (so the new project doesn't inherit
  // the previous project's snapshot), then POSTs to /api/refm/projects
  // with the default snapshot. Server returns the new id; we activate
  // it and start the auto-save loop.
  const handleCreateProject = useCallback((name: string, location: string) => {
    (async () => {
      // Detach the previous project's auto-save before resetting the
      // store, otherwise the reset would trigger a save back into the
      // outgoing project.
      detachSync();
      // Reset store to defaults so the new project starts clean.
      useModule1Store.getState().hydrate({ ...DEFAULT_MODULE1_STATE, projectName: name });
      const snapshotForApi = extractHydrateSnapshot(useModule1Store.getState());

      const res = await pclient.createProject({
        name,
        snapshot: snapshotForApi,
        location,
        status:   'Draft',
        assetMix: [projectType],
      });
      if (res.error || !res.data) {
        setPmToast({ msg: `Create failed: ${res.error ?? 'unknown error'}`, color: 'var(--color-negative)' });
        return;
      }
      const pid = res.data.project.id;
      setStorageData(prev => ({
        ...prev,
        activeProjectId: pid,
        projects: {
          ...prev.projects,
          [pid]: {
            name:         res.data!.project.name,
            location:     res.data!.project.location ?? '',
            createdAt:    res.data!.project.created_at,
            lastModified: res.data!.project.updated_at,
            status:       res.data!.project.status,
            assetMix:     res.data!.project.asset_mix,
            versions:     { [res.data!.version.id]: {
              name:      res.data!.version.label ?? `Version ${res.data!.version.version_number}`,
              createdAt: res.data!.version.created_at,
              data:      null,
            }},
            versionCount: 1,
          },
        },
      }));
      setActiveProjectId(pid);
      setActiveVersionId(res.data.version.id);
      writeActiveProjectId(pid);
      // Start the auto-save loop on the newly-created project.
      await attachSyncToProject(pid);
      setProjectName(name);
      setPmModal(null);
      // M1.5/5 default-landing: brand-new projects always open on the
      // Hierarchy tab (the legacy 3-asset seed is gone, so Timeline /
      // Costs / Financing have nothing to render until the user
      // defines their first asset).
      setActiveTab('hierarchy');
      setPmToast({ msg: `✓ Project "${name}" created`, color: 'var(--color-green-dark)' });
      setHasUnsaved(false);
    })();
  }, [projectType, setProjectName]);

  // ── Edit project (rename + relocate, post-M1.6) ──
  // PATCHes /api/refm/projects/[id]. Local state is mirrored after the
  // server confirms; on failure the toast surfaces the error and
  // local state stays as it was.
  const handleEditProject = useCallback((name: string, location: string) => {
    if (!activeProjectId) return;
    const pid = activeProjectId;
    (async () => {
      const res = await pclient.patchProject(pid, { name, location });
      if (res.error || !res.data) {
        setPmToast({ msg: `Update failed: ${res.error ?? 'unknown error'}`, color: 'var(--color-negative)' });
        return;
      }
      setStorageData(prev => {
        const proj = prev.projects[pid];
        if (!proj) return prev;
        return {
          ...prev,
          projects: {
            ...prev.projects,
            [pid]: {
              ...proj,
              name:         res.data!.project.name,
              location:     res.data!.project.location ?? '',
              lastModified: res.data!.project.updated_at,
            },
          },
        };
      });
      setProjectName(name);
      setPmModal(null);
      setPmInputVal('');
      setPmLocationVal('');
      setPmToast({ msg: `✓ Project "${name}" updated`, color: 'var(--color-green-dark)' });
    })();
  }, [activeProjectId, setProjectName]);

  // Open the edit modal, optionally for a specific project from the
  // list. When `pid` is provided, also makes that project the active
  // one so the modal — which reads `activeProjectData` for its
  // prefilled values — shows the right content.
  const handleEditProjectClick = useCallback((pid?: string) => {
    if (pid && pid !== activeProjectId) {
      setActiveProjectId(pid);
      writeActiveProjectId(pid);
      setStorageData(prev => ({ ...prev, activeProjectId: pid }));
      const proj = storageData.projects[pid];
      if (proj) setProjectName(proj.name);
    }
    setPmModal('edit');
  }, [activeProjectId, storageData, setProjectName]);

  // ── Delete project (post-M1.6) ──
  // DELETEs /api/refm/projects/[id]. Cascades version rows server-side.
  // Local cache for the deleted project is wiped so a subsequent
  // "duplicate via cache" can't resurrect it.
  const handleDeleteProject = useCallback((pid: string) => {
    (async () => {
      const res = await pclient.deleteProject(pid);
      if (res.error) {
        setPmToast({ msg: `Delete failed: ${res.error}`, color: 'var(--color-negative)' });
        return;
      }
      clearCachedSnapshot(pid);
      const wasActive = activeProjectId === pid;
      if (wasActive) {
        detachSync();
        writeActiveProjectId(null);
        setActiveProjectId(null);
        setActiveVersionId(null);
      }
      setStorageData(prev => {
        const next = { ...prev, projects: { ...prev.projects } };
        delete next.projects[pid];
        if (wasActive) { next.activeProjectId = null; next.activeVersionId = null; }
        return next;
      });
      setPmToast({ msg: 'Project deleted', color: 'var(--color-negative)' });
    })();
  }, [activeProjectId]);

  // ── Load version (post-M1.6) ──
  // Replaces the in-store snapshot from a specific historical
  // version row (via the sync module). The next user edit triggers
  // an auto-save that becomes the new latest version, branching off
  // the loaded one. Open assets-empty snapshots on the Hierarchy tab
  // so the user sees the asset-creation flow first.
  const handleLoadVersion = useCallback((pid: string, vid: string) => {
    (async () => {
      const res = await loadVersionInto(pid, vid);
      if (res.error) {
        setPmToast({ msg: `Load failed: ${res.error}`, color: 'var(--color-negative)' });
        return;
      }
      setActiveVersionId(vid);
      setStorageData(prev => ({ ...prev, activeVersionId: vid }));
      setHasUnsaved(false);
      const hasAssets = useModule1Store.getState().assets.length > 0;
      setActiveTab(hasAssets ? 'timeline' : 'hierarchy');
      const verName = storageData.projects[pid]?.versions[vid]?.name;
      setPmToast({ msg: `✓ Loaded: ${verName ?? 'version'}`, color: 'var(--color-navy)' });
    })();
  }, [storageData]);

  // ── Select project (post-M1.6) ──
  // Switches the active project. Detach + attach handles the auto-save
  // subscriber transition. Pre-fills version metadata so VersionModal /
  // OverviewScreen render with correct counts on first open.
  const handleSelectProject = useCallback((pid: string) => {
    (async () => {
      writeActiveProjectId(pid);
      setActiveProjectId(pid);
      setStorageData(prev => ({ ...prev, activeProjectId: pid }));
      const proj = storageData.projects[pid];
      if (proj) setProjectName(proj.name);
      const attachRes = await attachSyncToProject(pid);
      if (attachRes.error && attachRes.loaded === 'none') {
        setPmToast({ msg: `Could not load project: ${attachRes.error}`, color: 'var(--color-negative)' });
        return;
      }
      await refreshActiveVersions(pid);
    })();
  }, [storageData, setProjectName, refreshActiveVersions]);

  // ── Computed totals for financing - derived from finRes/finHosp/finRet lineItems ──
  const _allFins = [
    ...(showResidential && finRes  ? [finRes]  : []),
    ...(showHospitality && finHosp ? [finHosp] : []),
    ...(showRetail      && finRet  ? [finRet]  : []),
  ];
  const totalCapex  = _allFins.reduce((s, f) => s + f.lineItems.reduce((x, l) => x + l.total,    0), 0);
  const totalDebt   = _allFins.reduce((s, f) => s + f.totalDebt,   0);
  const totalEquity = _allFins.reduce((s, f) => s + f.totalEquity, 0);

  // ── Build export payload (declared after finRes/totalCapex are in scope) ──
  const buildExportPayload = useCallback(() => {
    const activeProject = activeProjectId ? storageData.projects[activeProjectId] : null;
    const activeVersion = activeProjectId && activeVersionId
      ? storageData.projects[activeProjectId]?.versions[activeVersionId]
      : null;
    return {
      projectName, projectType, country, currency, modelType,
      projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
      projectEndDate: getProjectEndDate(),
      landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
      residentialPercent, hospitalityPercent, retailPercent,
      residentialDeductPct, residentialEfficiency,
      hospitalityDeductPct, hospitalityEfficiency,
      retailDeductPct, retailEfficiency,
      totalLandArea, totalLandValue, landValuePerSqm,
      cashValue, inKindValue, cashPercent, inKindPercent,
      projectRoadsArea, projectNDA, totalProjectGFA,
      residentialGFA, hospitalityGFA, retailGFA,
      residentialBUA, hospitalityBUA, retailBUA,
      residentialNetSaleable, hospitalityNetSaleable, retailNetSaleable,
      residentialLandValue: totalLandValue * residentialPercent / 100,
      hospitalityLandValue: totalLandValue * hospitalityPercent / 100,
      retailLandValue:      totalLandValue * retailPercent / 100,
      showResidential, showHospitality, showRetail,
      costInputMode,
      residentialCosts, hospitalityCosts, retailCosts,
      interestRate, financingMode, globalDebtPct, capitalizeInterest,
      repaymentPeriods, repaymentMethod, lineRatios,
      finRes, finHosp, finRet,
      totalCapex, totalDebt, totalEquity,
      projectLabel: activeProject?.name || projectName,
      versionLabel: activeVersion?.name || 'Base Case',
    };
  }, [
    activeProjectId, activeVersionId, storageData,
    projectName, projectType, country, currency, modelType,
    projectStart, constructionPeriods, operationsPeriods, overlapPeriods,
    getProjectEndDate, landParcels, projectRoadsPct, projectFAR, projectNonEnclosedPct,
    residentialPercent, hospitalityPercent, retailPercent,
    residentialDeductPct, residentialEfficiency, hospitalityDeductPct, hospitalityEfficiency,
    retailDeductPct, retailEfficiency,
    totalLandArea, totalLandValue, landValuePerSqm,
    cashValue, inKindValue, cashPercent, inKindPercent,
    projectRoadsArea, projectNDA, totalProjectGFA,
    residentialGFA, hospitalityGFA, retailGFA,
    residentialBUA, hospitalityBUA, retailBUA,
    residentialNetSaleable, hospitalityNetSaleable, retailNetSaleable,
    showResidential, showHospitality, showRetail,
    costInputMode, residentialCosts, hospitalityCosts, retailCosts,
    interestRate, financingMode, globalDebtPct, capitalizeInterest,
    repaymentPeriods, repaymentMethod, lineRatios,
    finRes, finHosp, finRet, totalCapex, totalDebt, totalEquity,
  ]);

  const handleExportExcel = useCallback(async () => {
    setExportingExcel(true);
    try {
      const payload = buildExportPayload();
      const res = await fetch('/api/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const safeName = (payload.projectLabel || 'REFM').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
      a.download = `${safeName}__${payload.versionLabel.replace(/\s+/g, '_')}__REFM.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setPmToast({ msg: '📊 Excel exported', color: 'var(--color-green-dark)' });
    } catch {
      setPmToast({ msg: '❌ Excel export failed', color: 'var(--color-negative)' });
    } finally {
      setExportingExcel(false);
    }
  }, [buildExportPayload]);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const payload = buildExportPayload();
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const safeName = (payload.projectLabel || 'REFM').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
      a.download = `${safeName}__${payload.versionLabel.replace(/\s+/g, '_')}__REFM.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPmToast({ msg: '📄 PDF exported', color: 'var(--color-green-dark)' });
    } catch {
      setPmToast({ msg: '❌ PDF export failed', color: 'var(--color-negative)' });
    } finally {
      setExportingPdf(false);
    }
  }, [buildExportPayload]);

  const readOnly = !can('canEditInputs');

  // ── Render module content ──
  const renderContent = () => {
    if (!canSeeModule(activeModule)) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
            <h2 style={{ color: 'var(--color-heading)', fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)' }}>Access Restricted</h2>
            <p style={{ color: 'var(--color-meta)', marginTop: '0.5rem' }}>
              Your role ({ROLE_META[currentUserRole]?.label}) does not have access to this module.
            </p>
          </div>
        </div>
      );
    }

    switch (activeModule) {
      case 'dashboard':
        return (
          <Dashboard
            projectName={projectName}
            projectType={projectType}
            currency={currency}
            totalLandArea={totalLandArea}
            totalLandValue={totalLandValue}
            totalProjectGFA={totalProjectGFA}
            totalCapex={totalCapex}
            totalDebt={totalDebt}
            totalEquity={totalEquity}
            constructionPeriods={constructionPeriods}
            operationsPeriods={operationsPeriods}
            modelType={modelType}
            storageData={storageData}
            setActiveModule={setActiveModule}
          />
        );

      case 'projects':
        return (
          <ProjectsScreen
            storageData={storageData}
            activeProjectId={activeProjectId}
            onSelectProject={handleSelectProject}
            onCreateProject={() => setPmModal('new')}
            onEditProject={handleEditProjectClick}
            onDeleteProject={handleDeleteProject}
            setActiveModule={setActiveModule}
            can={can}
          />
        );

      case 'overview':
        return (
          <OverviewScreen
            storageData={storageData}
            activeProjectId={activeProjectId}
            activeVersionId={activeVersionId}
            projectName={projectName}
            projectType={projectType}
            currency={currency}
            totalLandValue={totalLandValue}
            totalProjectGFA={totalProjectGFA}
            totalCapex={totalCapex}
            onLoadVersion={handleLoadVersion}
            onSaveVersion={() => setPmModal('version')}
            onEditProject={() => handleEditProjectClick()}
            setActiveModule={setActiveModule}
            setActiveTab={setActiveTab}
            can={can}
          />
        );

      case 'module1':
        return (
          <div className="module-view" data-rbac-readonly={readOnly ? 'true' : undefined}>
            {/* Sticky sub-nav */}
            <div className="sticky-nav" style={{ padding: '0 var(--sp-3)', display: 'flex', gap: '4px', alignItems: 'center' }}>
              {m1Tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    padding: '10px 16px',
                    border: 'none',
                    borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                    background: 'none',
                    cursor: 'pointer',
                    color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-meta)',
                    fontWeight: activeTab === tab.key ? 'var(--fw-semibold)' : 'var(--fw-normal)',
                    fontSize: 'var(--font-body)',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontFamily: 'Inter, sans-serif',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* M1.5/11: Sub-Project + Phase context selectors. Shown
               only on the legacy non-Hierarchy tabs — the Hierarchy
               tab is the canonical CRUD surface for both lists, so
               putting the selectors there too would be redundant.
               Hidden when the project has 0 sub-projects or 0 phases
               (brand-new empty-assets project). FAST navy-pale per the
               REFM input convention. */}
            {activeTab !== 'hierarchy' && subProjects.length > 0 && phasesForActiveSubProject.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                padding: '8px var(--sp-3)',
                borderBottom: '1px solid var(--color-border)',
                background: 'color-mix(in srgb, var(--color-navy) 3%, var(--color-surface))',
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-meta)', color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--fw-semibold)' }}>
                  Sub-Project
                  <select
                    value={activeSubProjectId}
                    onChange={(e) => setActiveSubProjectId(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-meta)',
                      fontFamily: 'Inter, sans-serif',
                      background: 'var(--color-navy-pale)',
                      color: 'var(--color-navy)',
                      fontWeight: 'var(--fw-semibold)',
                      cursor: 'pointer',
                    }}
                  >
                    {subProjects.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-meta)', color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--fw-semibold)' }}>
                  Phase
                  <select
                    value={activePhaseId}
                    onChange={(e) => setActivePhaseId(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-meta)',
                      fontFamily: 'Inter, sans-serif',
                      background: 'var(--color-navy-pale)',
                      color: 'var(--color-navy)',
                      fontWeight: 'var(--fw-semibold)',
                      cursor: 'pointer',
                    }}
                  >
                    {phasesForActiveSubProject.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                {phasesForActiveSubProject.length > 1 && (
                  <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', fontStyle: 'italic', marginLeft: 'auto' }}>
                    Per-tab phase-aware reads land progressively across M1.6+; today the legacy tabs render phase[0] math.
                  </span>
                )}
              </div>
            )}

            {/* Tab content */}
            <div className="tab-content" style={{ padding: 'var(--sp-3)' }}>
              {activeTab === 'hierarchy' && <Module1Hierarchy />}
              {activeTab === 'timeline' && (
                <Module1Timeline
                  projectName={projectName} setProjectName={setProjectName}
                  projectType={projectType} setProjectType={setProjectType}
                  country={country} setCountry={setCountry}
                  currency={currency} setCurrency={setCurrency}
                  modelType={modelType} setModelType={setModelType}
                  projectStart={projectStart} setProjectStart={setProjectStart}
                  constructionPeriods={constructionPeriods} setConstructionPeriods={setConstructionPeriods}
                  operationsPeriods={operationsPeriods} setOperationsPeriods={setOperationsPeriods}
                  overlapPeriods={overlapPeriods} setOverlapPeriods={setOverlapPeriods}
                  getProjectEndDate={getProjectEndDate}
                  readOnly={readOnly}
                  showAiButtons={canAccess('ai_contextual')}
                />
              )}
              {activeTab === 'area' && (
                <Module1Area
                  landParcels={landParcels} setLandParcels={setLandParcels}
                  projectRoadsPct={projectRoadsPct} setProjectRoadsPct={setProjectRoadsPct}
                  projectFAR={projectFAR} setProjectFAR={setProjectFAR}
                  projectNonEnclosedPct={projectNonEnclosedPct} setProjectNonEnclosedPct={setProjectNonEnclosedPct}
                  residentialPercent={residentialPercent} setResidentialPercent={setResidentialPercent}
                  hospitalityPercent={hospitalityPercent} setHospitalityPercent={setHospitalityPercent}
                  retailPercent={retailPercent} setRetailPercent={setRetailPercent}
                  residentialDeductPct={residentialDeductPct} setResidentialDeductPct={setResidentialDeductPct}
                  residentialEfficiency={residentialEfficiency} setResidentialEfficiency={setResidentialEfficiency}
                  hospitalityDeductPct={hospitalityDeductPct} setHospitalityDeductPct={setHospitalityDeductPct}
                  hospitalityEfficiency={hospitalityEfficiency} setHospitalityEfficiency={setHospitalityEfficiency}
                  retailDeductPct={retailDeductPct} setRetailDeductPct={setRetailDeductPct}
                  retailEfficiency={retailEfficiency} setRetailEfficiency={setRetailEfficiency}
                  projectType={projectType}
                  currency={currency}
                  totalLandArea={totalLandArea}
                  totalLandValue={totalLandValue}
                  landValuePerSqm={landValuePerSqm}
                  cashValue={cashValue}
                  inKindValue={inKindValue}
                  cashPercent={cashPercent}
                  inKindPercent={inKindPercent}
                  showResidential={showResidential}
                  showHospitality={showHospitality}
                  showRetail={showRetail}
                  projectRoadsArea={projectRoadsArea}
                  projectNDA={projectNDA}
                  totalProjectGFA={totalProjectGFA}
                  residentialGFA={residentialGFA}
                  hospitalityGFA={hospitalityGFA}
                  retailGFA={retailGFA}
                  residentialBUA={residentialBUA}
                  residentialNetSaleable={residentialNetSaleable}
                  hospitalityBUA={hospitalityBUA}
                  hospitalityNetSaleable={hospitalityNetSaleable}
                  retailBUA={retailBUA}
                  retailNetSaleable={retailNetSaleable}
                  readOnly={readOnly}
                />
              )}
              {activeTab === 'costs' && (
                <Module1Costs
                  projectType={projectType}
                  costInputMode={costInputMode} setCostInputMode={setCostInputMode}
                  handleCostInputModeChange={handleCostInputModeChange}
                  residentialCosts={residentialCosts} setResidentialCosts={setResidentialCosts}
                  hospitalityCosts={hospitalityCosts} setHospitalityCosts={setHospitalityCosts}
                  retailCosts={retailCosts} setRetailCosts={setRetailCosts}
                  nextCostId={nextCostId} setNextCostId={setNextCostId}
                  constructionPeriods={constructionPeriods}
                  currency={currency}
                  modelType={modelType}
                  projectStart={projectStart}
                  calculateItemTotal={calculateItemTotal}
                  distributeCost={distributeCost}
                  getPhasingMode={getPhasingMode}
                  getPhasingValues={getPhasingValues}
                  calcSameForAllDisplayTotal={calcSameForAllDisplayTotal}
                  showResidential={showResidential}
                  showHospitality={showHospitality}
                  showRetail={showRetail}
                  readOnly={readOnly}
                  costStage={costStage} setCostStage={setCostStage}
                  getAreas={getAreas}
                  totalLandArea={totalLandArea}
                  landValuePerSqm={landValuePerSqm}
                  inKindPercent={inKindPercent}
                  cashPercent={cashPercent}
                  residentialPercent={residentialPercent}
                  hospitalityPercent={hospitalityPercent}
                  retailPercent={retailPercent}
                  residentialLandValue={residentialLandValue}
                  hospitalityLandValue={hospitalityLandValue}
                  retailLandValue={retailLandValue}
                  syncSameForAllToAllAssets={syncSameForAllToAllAssets}
                  costScope={costScope} setCostScope={setCostScope}
                  costDevFeeMode={costDevFeeMode} setCostDevFeeMode={setCostDevFeeMode}
                  allocBasis={allocBasis} setAllocBasis={setAllocBasis}
                  calcItemTotalV14={calcItemTotalV14}
                />
              )}
              {activeTab === 'financing' && (
                <Module1Financing
                  interestRate={interestRate} setInterestRate={setInterestRate}
                  financingMode={financingMode} setFinancingMode={setFinancingMode}
                  globalDebtPct={globalDebtPct} setGlobalDebtPct={setGlobalDebtPct}
                  capitalizeInterest={capitalizeInterest} setCapitalizeInterest={setCapitalizeInterest}
                  repaymentPeriods={repaymentPeriods} setRepaymentPeriods={setRepaymentPeriods}
                  repaymentMethod={repaymentMethod} setRepaymentMethod={setRepaymentMethod}
                  lineRatios={lineRatios} setLineRatios={setLineRatios}
                  currency={currency}
                  modelType={modelType}
                  constructionPeriods={constructionPeriods}
                  operationsPeriods={operationsPeriods}
                  totalCapex={totalCapex}
                  totalDebt={totalDebt}
                  totalEquity={totalEquity}
                  totalLandValue={totalLandValue}
                  residentialCosts={residentialCosts}
                  hospitalityCosts={hospitalityCosts}
                  retailCosts={retailCosts}
                  costInputMode={costInputMode}
                  calculateItemTotal={calculateItemTotal}
                  readOnly={readOnly}
                  finRes={finRes}
                  finHosp={finHosp}
                  finRet={finRet}
                  getLineDebtPct={getLineDebtPct}
                  setLineDebtPct={setLineDebtPct}
                  showResidential={showResidential}
                  showHospitality={showHospitality}
                  showRetail={showRetail}
                />
              )}
            </div>
          </div>
        );

      // ── Module 8 - Portfolio (partial access on Free) ──────────────────────
      case 'module8': {
        const hasFullM8 = canAccess('module_8_full');
        return (
          <div className="module-view" style={{ position: 'relative' }}>
            <div style={{ padding: 'var(--sp-3)', opacity: hasFullM8 ? 1 : 0.5 }}>
              <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 700, color: 'var(--color-heading)', marginBottom: 8 }}>
                Module 8 - Portfolio Dashboard
              </h2>
              <p style={{ color: 'var(--color-meta)', fontSize: 13 }}>Coming soon.</p>
            </div>
            {!hasFullM8 && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 5,
                background: 'color-mix(in srgb, var(--color-surface) 85%, transparent)', backdropFilter: 'blur(3px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ textAlign: 'center', padding: '24px 32px', maxWidth: 360 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 6 }}>
                    Upgrade to edit financials
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 16, lineHeight: 1.6 }}>
                    Upgrade to Professional to edit Portfolio financials. Outputs are visible in read-only mode.
                  </p>
                  <a href="/settings" style={{
                    display: 'inline-block', padding: '8px 20px', background: 'var(--color-primary)',
                    color: 'var(--color-on-primary-navy)', borderRadius: 6, fontSize: 13, fontWeight: 700, textDecoration: 'none',
                  }}>
                    Upgrade to Professional →
                  </a>
                </div>
              </div>
            )}
          </div>
        );
      }

      // ── Module 9 - Market Data (basic KPIs only on Free) ────────────────────
      case 'module9': {
        const hasFullM9 = canAccess('module_9_full');
        return (
          <div className="module-view" style={{ padding: 'var(--sp-3)' }}>
            <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 700, color: 'var(--color-heading)', marginBottom: 16 }}>
              Module 9 - Market Data
            </h2>
            {/* Basic KPIs - visible on all plans */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
              {['GDV', 'Total Cost', 'Dev Margin'].map(k => (
                <div key={k} className="kpi-card" style={{ minWidth: 160 }}>
                  <div className="kpi-label">{k}</div>
                  <div className="kpi-value">-</div>
                  <div className="kpi-sub">Coming soon</div>
                </div>
              ))}
            </div>
            {/* Advanced metrics - locked for Free */}
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', opacity: 0.35, pointerEvents: 'none' }}>
                {['Cap Rate', 'IRR', 'Equity Multiple', 'DSCR', 'NPV'].map(k => (
                  <div key={k} className="kpi-card" style={{ minWidth: 160 }}>
                    <div className="kpi-label">{k}</div>
                    <div className="kpi-value">-</div>
                  </div>
                ))}
              </div>
              {!hasFullM9 && (
                <UpgradePrompt
                  featureKey="module_9_full"
                  requiredPlan="professional"
                  variant="overlay"
                  message="Upgrade to Professional to access all market metrics and charts."
                />
              )}
            </div>
          </div>
        );
      }

      default:
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
            <div style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🚧</div>
              <p>This module is coming soon.</p>
            </div>
          </div>
        );
    }
  };

  const activeProjectData = activeProjectId ? storageData.projects[activeProjectId] : null;
  const activeVersionData = activeProjectId && activeVersionId
    ? storageData.projects[activeProjectId]?.versions[activeVersionId]
    : null;

  return (
    <>
      <Topbar
        projectName={projectName}
        activeProjectData={activeProjectData}
        activeVersionData={activeVersionData}
        hasUnsaved={hasUnsaved}
        lastSavedAt={lastSavedAt}
        currentUserRole={currentUserRole}
        can={can}
        onSave={() => setPmModal('version')}
        onOpenProjects={() => { setActiveModule('projects'); }}
        onOpenVersions={() => setPmModal('version')}
        onOpenRbac={() => { setRbacSelectedRole(currentUserRole); setRbacModalOpen(true); }}
        onExportClick={() => setExportModalOpen(true)}
        darkMode={darkMode}
        onToggleDark={toggleDarkMode}
      />

      <div className="app-shell">
        <Sidebar
          activeModule={activeModule}
          setActiveModule={setActiveModule}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          sidebarSubOpen={sidebarSubOpen}
          setSidebarSubOpen={setSidebarSubOpen}
          currentUserRole={currentUserRole}
          activeProjectId={activeProjectId}
          activeProjectName={activeProjectData?.name ?? null}
          activeVersionName={activeVersionData?.name ?? null}
          canSeeModule={canSeeModule}
          canAccess={canAccess}
          subLoaded={subLoaded}
          onLockedModuleClick={(featureKey, requiredPlan) => setUpgradePrompt({ featureKey, requiredPlan })}
          onOpenProjects={() => { setActiveModule('projects'); }}
          onOpenRbac={() => { setRbacSelectedRole(currentUserRole); setRbacModalOpen(true); }}
        />

        <main
          className={`main-content${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Modals */}
      {(pmModal === 'new' || pmModal === 'edit') && (
        <ProjectModal
          mode={pmModal}
          initialName={pmModal === 'edit' ? (activeProjectData?.name ?? '') : ''}
          initialLocation={pmModal === 'edit' ? (activeProjectData?.location ?? '') : ''}
          pmInputVal={pmInputVal}
          setPmInputVal={setPmInputVal}
          pmLocationVal={pmLocationVal}
          setPmLocationVal={setPmLocationVal}
          onConfirm={pmModal === 'edit' ? handleEditProject : handleCreateProject}
          onClose={() => setPmModal(null)}
        />
      )}
      {pmModal === 'version' && (
        <VersionModal
          storageData={storageData}
          activeProjectId={activeProjectId}
          activeVersionId={activeVersionId}
          onSave={handleSaveVersion}
          onLoad={handleLoadVersion}
          onClose={() => setPmModal(null)}
        />
      )}
      {rbacModalOpen && (
        <RbacModal
          rbacSelectedRole={rbacSelectedRole}
          setRbacSelectedRole={setRbacSelectedRole}
          onApply={(role) => {
            setCurrentUserRole(role);
            setRbacModalOpen(false);
            setPmToast({ msg: `Role switched to ${ROLE_META[role]?.label}`, color: 'var(--color-navy)' });
          }}
          onClose={() => setRbacModalOpen(false)}
        />
      )}

      {/* Export modal */}
      {exportModalOpen && (
        <ExportModal
          canAccess={canAccess}
          onClose={() => setExportModalOpen(false)}
          onExportExcel={handleExportExcel}
          onExportPdf={handleExportPdf}
          exportingExcel={exportingExcel}
          exportingPdf={exportingPdf}
        />
      )}

      {/* Upgrade prompt overlay */}
      {upgradePrompt && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1999,
            background: 'color-mix(in srgb, var(--color-heading) 45%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setUpgradePrompt(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 440, width: '100%' }}>
            <UpgradePrompt
              featureKey={upgradePrompt.featureKey}
              requiredPlan={upgradePrompt.requiredPlan}
              variant="card"
            />
          </div>
        </div>
      )}

      {/* Toast */}
      {pmToast && (
        <div className="pm-toast" style={{ background: pmToast.color }}>
          {pmToast.msg}
        </div>
      )}
    </>
  );
}
