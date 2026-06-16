'use client';

/**
 * RealEstatePlatform.tsx (v5 schema, M2.0b shell rewire)
 *
 * Phase M2.0 (4-tab spec rebuild) + Phase M2.0b (brand-styled
 * shell restoration). The 4 tab components subscribe to the v5
 * Zustand store directly; the shell wires layout + persistence +
 * project routing + RBAC + dark-mode.
 *
 * Tabs (4): Project & Phases / Assets & Sub-units / Costs / Financing.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

import {
  ROLES,
  ROLE_META,
  MODULE_VISIBILITY,
  PERMISSIONS,
  useBrandingStore,
} from '@/src/core/state';
import type { Role, ModuleKey, PermissionMap } from '@/src/core/types/settings.types';

import { useModule1Store, DEFAULT_MODULE1_STATE, type HydrateSnapshot } from '../lib/state/module1-store';
import * as pclient from '../lib/persistence/client';
// Reuse the table scrollbar styling so the workspace vertical scrollbar is the
// same 14px thickness as the horizontal scrollbars inside the results tables.
import scrollStyles from './modules/_shared/ScrollableTable.module.css';
import {
  attachToProject as attachSyncToProject,
  attachToProjectFromLocalSnapshot,
  detach as detachSync,
  loadVersionInto,
  startEditSession,
  revertEditSession,
  getSessionState,
} from '../lib/persistence/module1-sync';
import { writeActiveProjectId, clearCachedSnapshot } from '../lib/persistence/cache';

import Topbar from './Topbar';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import Overview from './Overview';
import ProjectsScreen from './ProjectsScreen';
import Module1ProjectPhases from './modules/Module1ProjectPhases';
import Module1Assets from './modules/Module1Assets';
import Module1Costs from './modules/Module1Costs';
import Module1Financing from './modules/Module1Financing';
import Module2Revenue from './modules/Module2Revenue';
import Module2RevenueOutput from './modules/Module2RevenueOutput';
import Module2CostOfSales from './modules/Module2CostOfSales';
import Module2Schedules from './modules/Module2Schedules';
import Module2Escrow from './modules/Module2Escrow';
import Module4Schedules from './modules/Module4Schedules';
import Module4PL from './modules/Module4PL';
import Module4CashFlow from './modules/Module4CashFlow';
import Module4BalanceSheet from './modules/Module4BalanceSheet';
import Module5Returns from './modules/Module5Returns';
import Module5Metrics from './modules/Module5Metrics';
import Module5CaseComparison from './modules/Module5CaseComparison';
import Module6Scenarios from './modules/Module6Scenarios';
import Module3Opex from './modules/Module3Opex';
import Module3OpexOutput from './modules/Module3OpexOutput';

import ProjectModal from './modals/ProjectModal';
import ProjectWizard, { type WizardDraft } from './modals/ProjectWizard';
import VersionModal from './modals/VersionModal';
import NameVersionModal, { defaultSessionLabel, type NameVersionModalMode, type NameVersionConfirm } from './modals/NameVersionModal';
import RbacModal from './modals/RbacModal';
import ExportModal from './modals/ExportModal';
import PlatformGuideModal from './modals/PlatformGuideModal';
import UpgradePrompt from '@/src/shared/components/UpgradePrompt';
import { buildPlatformGuide } from '../lib/guide/platformGuide';

import { buildWizardSnapshot } from '../lib/wizard/buildWizardSnapshot';
import { MODULES } from '../lib/modules-config';
import { usePlatformModules, REFM_PLATFORM_SLUG } from '../lib/usePlatformModules';

// ── StorageShape (consumer contract for ProjectsScreen / Dashboard / Overview) ──
export interface StorageProject {
  name: string;
  createdAt: string;
  lastModified: string;
  location: string;
  status: 'Draft' | 'Active' | 'IC Review' | 'Approved' | 'Archived';
  assetMix: string[];
  versions: Record<string, { name: string; createdAt: string; data: unknown }>;
  versionCount?: number;
}

export interface StorageShape {
  projects: Record<string, StorageProject>;
  activeProjectId: string | null;
  activeVersionId: string | null;
}

const SNAPSHOT_KEYS = Object.keys(DEFAULT_MODULE1_STATE) as Array<keyof HydrateSnapshot>;

function extractHydrateSnapshot(state: ReturnType<typeof useModule1Store.getState>): HydrateSnapshot {
  const out = {} as HydrateSnapshot;
  for (const k of SNAPSHOT_KEYS) {
    (out as Record<string, unknown>)[k] = state[k];
  }
  return out;
}

function projectsToStorageShape(
  projects: pclient.RefmProjectSummary[],
  activeProjectId: string | null,
  activeVersionId: string | null,
): StorageShape {
  const out: StorageShape = { projects: {}, activeProjectId, activeVersionId };
  for (const p of projects) {
    out.projects[p.id] = {
      name: p.name,
      createdAt: p.created_at,
      lastModified: p.updated_at,
      location: p.location ?? '',
      status: p.status,
      assetMix: p.asset_mix,
      versions: {},
      versionCount: p.version_count,
    };
  }
  return out;
}

// ── Country data (kept for ProjectsScreen / Dashboard) ─────────────────────
export const COUNTRY_DATA = [
  { name: 'Saudi Arabia', flag: '🇸🇦', currency: 'SAR' },
  { name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED' },
  { name: 'Qatar', flag: '🇶🇦', currency: 'QAR' },
  { name: 'Kuwait', flag: '🇰🇼', currency: 'KWD' },
  { name: 'Bahrain', flag: '🇧🇭', currency: 'BHD' },
  { name: 'Oman', flag: '🇴🇲', currency: 'OMR' },
  { name: 'Jordan', flag: '🇯🇴', currency: 'JOD' },
  { name: 'Egypt', flag: '🇪🇬', currency: 'EGP' },
  { name: 'United States', flag: '🇺🇸', currency: 'USD' },
  { name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
];

// ── Sidebar nav ────────────────────────────────────────────────────────────
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

// Pass 47 (2026-05-14): Overview entry removed - Dashboard (after the
// Pass 45 redesign) covers both the portfolio welcome AND the per-
// project overview, making Overview redundant in the sidebar. The
// activeModule === 'overview' branch below aliases to the Dashboard
// component so legacy deep links and ProjectsScreen.setActiveModule
// ('overview') calls keep working.
const STATIC_NAV: readonly SidebarNavItem[] = [
  // Projects tab removed (2026-06-16): the Dashboard hub replaces it.
  { key: 'dashboard', icon: '📊', label: 'Dashboard', featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
];

export const sidebarModules: readonly SidebarNavItem[] = [
  ...STATIC_NAV,
  ...MODULES.map((m): SidebarNavItem => ({
    key: m.key,
    icon: m.icon,
    label: `Module ${m.num}: ${m.shortLabel}`,
    featureKey: m.featureKey,
    requiredPlan: m.requiredPlan,
    badge: m.status === 'done' ? '✓' : m.status === 'wip' ? 'WIP' : m.status === 'soon' ? 'SOON' : null,
    badgeClass: m.status === 'done' ? 'badge-done' : m.status === 'wip' ? 'badge-wip' : m.status === 'soon' ? 'badge-soon' : '',
    disabled: m.disabled,
    disabledReason: m.disabledReason,
  })),
];

// ── Module 1 tabs (M2.0: 4 tabs) ──────────────────────────────────────────
export const m1Tabs = [
  { key: 'project-phases', icon: '📅', label: '1. Project & Phases', step: 1 },
  { key: 'assets', icon: '🏗️', label: '2. Assets & Sub-units', step: 2 },
  { key: 'costs', icon: '💸', label: '3. Capex', step: 3 },
  { key: 'financing', icon: '🏦', label: '4. Financing', step: 4 },
];

// ── Module 2 tabs (M2 Pass 9h: 5 tabs - Inputs / Revenue / CoS / Schedules / Escrow) ──
// Inputs reuses the Pass 5/6 phase-wise asset card surface; the other
// four tabs are read-only output surfaces driven by the revenue engine.
// Escrow added 2026-05-19 (Pass 9h): pre-sales held % + per-asset release
// year, modelled on the reference v1.16 Escrow tab methodology.
export const m2Tabs = [
  { key: 'm2-inputs', icon: '📝', label: '1. Inputs', step: 1 },
  { key: 'm2-revenue', icon: '💰', label: '2. Revenue', step: 2 },
  { key: 'm2-cost-of-sales', icon: '🧾', label: '3. Cost of Sales', step: 3 },
  { key: 'm2-schedules', icon: '📑', label: '4. Schedules', step: 4 },
  { key: 'm2-escrow', icon: '🔒', label: '5. Escrow', step: 5 },
];

// ── Module 3 tabs (Opex Pass 2: Inputs / Output) ──
// Inputs is the per-asset line-item editor + HQ corporate overheads.
// Output is the read-only narrative + project totals computed by the
// engine from M1 sub-units + M2 revenue + the per-asset opex config.
export const m3Tabs = [
  { key: 'm3-inputs', icon: '📝', label: '1. Inputs', step: 1 },
  { key: 'm3-output', icon: '📊', label: '2. Opex Output', step: 2 },
];

// ── Module 4 tabs (Financial Statements) ────────────────────────────
// Pass 1 shipped Fixed Assets + Depreciation; Pass 2 added the full
// financial statements (P&L, CF, BS). Pass 2i (2026-05-20) merges the
// former "Fixed Assets & D&A" and "BS Schedules" entries under a single
// "Schedules" tab with an internal sub-tab toggle. The shell component
// lives in Module4Schedules and switches between Module4FixedAssets and
// Module4BSFeeders.
export const m4Tabs = [
  { key: 'm4-schedules', icon: '📑', label: '1. Schedules', step: 1 },
  { key: 'm4-pl', icon: '📈', label: '2. P&L', step: 2 },
  { key: 'm4-cashflow', icon: '💵', label: '3. Cash Flow', step: 3 },
  { key: 'm4-balancesheet', icon: '⚖️', label: '4. Balance Sheet', step: 4 },
];

// ── Module 5 tabs (Returns and Valuation) ─────────────────────────────
export const m5Tabs = [
  { key: 'm5-returns', icon: '📈', label: '1. Returns', step: 1 },
  { key: 'm5-metrics', icon: '🏷️', label: '2. RE Metrics', step: 2 },
  { key: 'm5-cases', icon: '🔀', label: '3. Case Comparison', step: 3 },
];

// Universal module → sub-tabs map. Any module key that needs a sidebar
// drop-down just registers its tabs here; Sidebar.tsx reads from this
// map instead of hard-coding per-module branches. New modules (M4/M5/M6)
// only need to add their tabs here, sidebar code stays untouched.
export type SidebarSubTab = { key: string; icon: string; label: string; step: number };
export const MODULE_TABS: Record<string, ReadonlyArray<SidebarSubTab>> = {
  module1: m1Tabs,
  module2: m2Tabs,
  module3: m3Tabs,
  module4: m4Tabs,
  module5: m5Tabs,
};

// ── Main component ────────────────────────────────────────────────────────
export default function RealEstatePlatform(): React.JSX.Element {
  const session = useSession();
  void session; // auth gate handled by middleware

  // Navigation state
  const [activeModule, setActiveModule] = useState('dashboard');
  const [activeTab, setActiveTab] = useState('project-phases');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSubOpen, setSidebarSubOpen] = useState(true);

  // M4 Pass 2N-Fix (2026-05-21): Excel-style trace-to-source navigator.
  // M4 line items (e.g. P&L Finance Cost) can declare a `trace` field
  // on M4Row that includes { module, tab, sectionId }. Clicking the
  // ⤴ icon dispatches 'fmp:trace-to'; this top-level listener flips
  // module + tab, then re-dispatches 'fmp:asset-nav-expand' with the
  // sectionId (re-using the existing expand-and-scroll plumbing).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ module?: string; tab?: string; sectionId?: string }>).detail;
      if (!detail) return;
      if (detail.module) setActiveModule(detail.module);
      if (detail.tab) setActiveTab(detail.tab);
      if (detail.sectionId) {
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('fmp:asset-nav-expand', { detail: { assetId: detail.sectionId } }));
          window.setTimeout(() => {
            const el = document.getElementById(detail.sectionId!);
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const prevOutline = el.style.outline;
            const prevOffset = el.style.outlineOffset;
            el.style.outline = '2px solid var(--color-primary, #1d4ed8)';
            el.style.outlineOffset = '2px';
            el.style.transition = 'outline-color 0.6s ease-out';
            window.setTimeout(() => { el.style.outline = prevOutline; el.style.outlineOffset = prevOffset; }, 1200);
          }, 80);
        }, 80);
      }
    };
    window.addEventListener('fmp:trace-to', handler);
    return () => window.removeEventListener('fmp:trace-to', handler);
  }, []);

  // P-Sync: dynamic platform modules from /api/platforms/refm/modules.
  // Falls back to static MODULES list while in flight.
  const { modules: dynamicSidebarModules } = usePlatformModules(REFM_PLATFORM_SLUG);

  // Subscription / plan gating. Free modules are always accessible;
  // pro / enterprise modules stay locked behind the upgrade prompt
  // until plan enforcement ships. Previous version returned false for
  // every featureKey which silently lock-icon'd free modules in the
  // sidebar (Module 1 / Module 2) and intercepted clicks for paid
  // tiers - users reported Revenue sidebar feeling unclickable.
  const canAccess = (featureKey: string): boolean => {
    const mod = MODULES.find((m) => m.featureKey === featureKey);
    return mod?.requiredPlan === 'free';
  };
  const subLoaded = true;
  const [upgradePrompt, setUpgradePrompt] = useState<{ featureKey: string; requiredPlan: 'professional' | 'enterprise' } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // RBAC (admin-only by default; left as user-toggle for testing)
  const [currentUserRole, setCurrentUserRole] = useState<Role>(ROLES.ADMIN);
  const [rbacModalOpen, setRbacModalOpen] = useState(false);
  const [rbacSelectedRole, setRbacSelectedRole] = useState<Role>(ROLES.ADMIN);

  // Dark mode (workspace-scoped via body[data-refm-theme])
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (darkMode) {
      document.body.setAttribute('data-refm-theme', 'dark');
    } else {
      document.body.removeAttribute('data-refm-theme');
    }
    return () => {
      document.body.removeAttribute('data-refm-theme');
    };
  }, [darkMode]);

  // Server-side project list
  const [serverProjects, setServerProjects] = useState<pclient.RefmProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Save state
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  // 2026-05-31 BUG-B FIX: gates the UI during a project switch so no
  // stale snapshot is rendered between detach + hydrate.
  const [isSwitchingProject, setIsSwitchingProject] = useState(false);
  // M2.0h Fix 1 (2026-05-07): one-shot banner shown after a v7 -> v8
  // migration. Cleared by the user via the dismiss button.
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);

  // Modal state
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  // Phase M-Versioning (2026-05-31): NameVersionModal state.
  const [nameVersionModalOpen, setNameVersionModalOpen] = useState(false);
  const [nameVersionModalMode, setNameVersionModalMode] = useState<NameVersionModalMode>('start-session');
  const [editingVersionLabel, setEditingVersionLabel] = useState<string | null>(null);
  // Auto-start session toast (transient banner shown when the sync
  // module auto-creates a session on first edit). null = hidden.
  const [sessionStartedToast, setSessionStartedToast] = useState<string | null>(null);
  const sessionToastTimerRef = useRef<number>(0);

  // Permissions / visibility helpers
  const can = useCallback(
    (permission: keyof PermissionMap): boolean => PERMISSIONS[currentUserRole]?.[permission] === true,
    [currentUserRole],
  );
  const canSeeModule = useCallback(
    (key: string): boolean => MODULE_VISIBILITY[currentUserRole]?.includes(key as ModuleKey) ?? true,
    [currentUserRole],
  );

  // Boot: list projects from server
  //
  // 2026-05-31 BUG-B FIX: hydrate BEFORE flipping activeProjectId so
  // the first paint of every module surface reads the correct
  // snapshot. Previously the boot effect set activeProjectId before
  // awaiting the hydrate, causing the same stale-snapshot render
  // window as handleSelectProject.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await pclient.listProjects();
      if (cancelled) return;
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      setServerProjects(res.data?.projects ?? []);
      // 2026-06-16: do NOT auto-open the last-cached project on sign-in. The
      // user lands on the Dashboard (all-projects hub) with NO project open;
      // every module stays locked until a project is opened explicitly from
      // the Dashboard or Projects. (Previously this restored readActiveProjectId
      // here, so a project was always open by default.)
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Track unsaved edits via store subscription. Any HydrateSnapshot field
  // change marks hasUnsaved=true. lastSavedAt clears it on Save Version.
  useEffect(() => {
    if (!activeProjectId) {
      setHasUnsaved(false);
      return;
    }
    const unsub = useModule1Store.subscribe(() => {
      setHasUnsaved(true);
    });
    return () => unsub();
  }, [activeProjectId]);

  // Phase M-Versioning (2026-05-31, auto-start refactor per user
  // request): the sync module auto-creates a session on first edit
  // with a default timestamp label. We listen for the post-creation
  // event and surface a non-blocking banner with a "Rename" affordance
  // instead of popping a modal. The user can rename later via the
  // topbar Save button OR ignore it entirely and the auto-name sticks.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ versionId?: string; label?: string }>).detail;
      const session = getSessionState();
      setEditingVersionLabel(detail?.label ?? session.editingLabel);
      setActiveVersionId(detail?.versionId ?? session.editingVersionId ?? null);
      setSessionStartedToast(detail?.label ?? session.editingLabel ?? null);
      setHasUnsaved(true);
      setLastSavedAt(new Date().toLocaleTimeString());
      // Auto-dismiss the toast after 8s; user can also click X.
      window.clearTimeout(sessionToastTimerRef.current);
      sessionToastTimerRef.current = window.setTimeout(() => {
        setSessionStartedToast(null);
      }, 8000);
    };
    window.addEventListener('fmp:refm-session-started', handler);
    return () => window.removeEventListener('fmp:refm-session-started', handler);
  }, []);

  // Project selection / load
  //
  // 2026-05-31 BUG-B FIX: previously this method flipped React state
  // (`setActiveProjectId`, `setActiveModule`) BEFORE awaiting the
  // hydrate from server. During the 200-500ms server round-trip the
  // UI rendered with `activeProjectId = <new id>` but the Zustand
  // store still held the PREVIOUS project's snapshot, so every
  // module surface showed the wrong project's numbers under the new
  // project's heading. The fix is to:
  //   1. Detach the previous project's subscriber.
  //   2. Show a switching indicator and clear the store so no stale
  //      data renders during the gap.
  //   3. Await the hydrate.
  //   4. Only then flip activeProjectId/activeModule, so the UI
  //      renders with the correct snapshot from the very first
  //      paint.
  const handleSelectProject = useCallback(async (projectId: string) => {
    setIsSwitchingProject(true);
    setHasUnsaved(false);

    // Step 1: detach the previous project's autosave subscriber so
    // any in-flight events from the prior session can't race with
    // the new attach. attachToProject internally calls detach() again
    // for safety; the dual call is idempotent.
    detachSync();

    // Step 2: clear the store IMMEDIATELY so that if React re-renders
    // before attachSyncToProject's hydrate fires (e.g. due to other
    // state updates), no stale snapshot is visible. We still hold
    // activeProjectId until hydrate completes, so module surfaces
    // currently render the prior project's UI shell.
    useModule1Store.getState().hydrate({ ...DEFAULT_MODULE1_STATE });

    // Step 3: load + hydrate the new project's snapshot before the
    // UI knows about it. attachSyncToProject re-wires the autosave
    // subscriber for the new project after hydrate is done.
    const res = await attachSyncToProject(projectId);
    if (res.error) {
      setLoadError(res.error);
      setIsSwitchingProject(false);
      return;
    }
    if (res.migrationNotice) setMigrationNotice(res.migrationNotice);

    // Step 4: flip the UI now that the store is correct.
    setActiveProjectId(projectId);
    writeActiveProjectId(projectId);
    setActiveTab('project-phases');
    setActiveModule('overview'); // opening a project lands on its Overview
    setHasUnsaved(false);
    setActiveVersionId(res.versionId ?? null);
    setEditingVersionLabel(null);
    setIsSwitchingProject(false);
  }, []);

  const handleCreateFromWizard = useCallback(
    async (draft: WizardDraft): Promise<void> => {
      const snapshot = buildWizardSnapshot(draft);

      // 2026-05-31 BUG-A FIX: detach the PREVIOUS project's autosave
      // subscriber BEFORE hydrating the store with the new project's
      // snapshot. Previously this method called `hydrate(snapshot)`
      // while the old project's subscriber was still wired, so the
      // hydrate event scheduled an autosave that, 1.5s later, wrote
      // the NEW project's snapshot to the OLD project's server row,
      // overwriting the user's previous work on disk. The 2026-05-29
      // demo data-loss incident traced to this exact sequence.
      detachSync();

      useModule1Store.getState().hydrate(snapshot);
      const res = await pclient.createProject({
        name: snapshot.project.name,
        snapshot,
        location: snapshot.project.location,
        status: 'Draft',
        assetMix: snapshot.assets.filter((a) => a.visible).map((a) => a.name),
      });
      if (res.error || !res.data) {
        setLoadError(res.error ?? 'Failed to create project');
        return;
      }
      setServerProjects((prev) => [...prev, res.data!.project]);
      setActiveProjectId(res.data.project.id);
      writeActiveProjectId(res.data.project.id);
      // Phase M-Versioning (2026-05-31): pass version.id so the
      // session base is anchored to the just-created v1. The user's
      // first edit will then prompt for a session name and create a
      // v2 with base=v1 and a proper change_log diff.
      attachToProjectFromLocalSnapshot(res.data.project.id, snapshot, res.data.version.id);
      setActiveTab('project-phases');
      setActiveModule('module1');
      setHasUnsaved(false);
      setEditingVersionLabel(null);
    },
    [],
  );

  const handleCloseProject = useCallback((): void => {
    detachSync();
    setActiveProjectId(null);
    setActiveVersionId(null);
    if (activeProjectId) clearCachedSnapshot(activeProjectId);
    writeActiveProjectId(null);
    useModule1Store.getState().hydrate({ ...DEFAULT_MODULE1_STATE });
    setActiveModule('dashboard'); // Projects tab removed; close returns to the Dashboard hub
    setHasUnsaved(false);
    setLastSavedAt(null);
  }, [activeProjectId]);

  const handleLoadVersion = useCallback(async (projectId: string, versionId: string): Promise<void> => {
    const res = await loadVersionInto(projectId, versionId);
    if (res.error) {
      setLoadError(res.error);
      return;
    }
    setActiveProjectId(projectId);
    setActiveVersionId(versionId);
    setActiveTab('project-phases');
    setActiveModule('overview'); // loading a version lands on its Overview
    setHasUnsaved(false);
    // Phase M-Versioning: loadVersionInto re-anchors sessionBase to
    // the loaded version. Clear the editing label so the next edit
    // triggers a fresh "name this version" prompt.
    setEditingVersionLabel(null);
  }, []);

  // Phase M-Versioning: explicit "Save" / "Create version" now always
  // runs through handleSaveQuick -> NameVersionModal (auto-name + Task +
  // Comment). The old plain-label handleSaveVersion path is retired so a
  // version is never named with a bare "Version N" counter.

  const handleSaveQuick = useCallback(() => {
    const session = getSessionState();
    // A version is "properly named" once it carries the auto-generated
    // {Project}_vX.Y_date_task label. Auto-started sessions get a default
    // "Edits ..." label, so the FIRST explicit save must run the rich
    // naming flow (auto-name + Task + Comment) to promote that row, even
    // though an editing session already exists.
    const isRichlyNamed = !!session.editingLabel && /_v\d+\.\d+_/.test(session.editingLabel);
    if (session.editingVersionId && isRichlyNamed) {
      // Already a named version; "Save" is a free-text label rename.
      setNameVersionModalMode('rename');
      setEditingVersionLabel(session.editingLabel);
      setNameVersionModalOpen(true);
      return;
    }
    // No session yet, OR an auto-started session not yet given a proper
    // name + comment. Open the rich create flow.
    setNameVersionModalMode('start-session');
    setEditingVersionLabel(null);
    setNameVersionModalOpen(true);
  }, []);

  // NameVersionModal callbacks.
  const handleNameVersionConfirm = useCallback(
    async (result: NameVersionConfirm): Promise<void> => {
      const res = await startEditSession(result.label, {
        versionLabel: result.versionLabel,
        taskName: result.taskName,
        comment: result.comment,
      });
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      if (res.versionId) {
        setActiveVersionId(res.versionId);
        setEditingVersionLabel(getSessionState().editingLabel);
        // Refresh the picker tile in case assetMix shifted on this save.
        const listRes = await pclient.listProjects();
        if (listRes.data?.projects) setServerProjects(listRes.data.projects);
      }
      setHasUnsaved(true);
      setLastSavedAt(new Date().toLocaleTimeString());
      setNameVersionModalOpen(false);
    },
    [],
  );

  const handleNameVersionCancel = useCallback((): void => {
    // Only discard edits when this was a brand-new fork with NO committed
    // editing session yet. If a session is already persisting the user's
    // edits (e.g. auto-started on first edit), Cancel just closes the
    // dialog and keeps the auto-named version: it never throws away work.
    const session = getSessionState();
    if (nameVersionModalMode === 'start-session' && !session.editingVersionId) {
      revertEditSession();
      setHasUnsaved(false);
    }
    setNameVersionModalOpen(false);
  }, [nameVersionModalMode]);

  const handleEditProject = useCallback((_pid: string): void => {
    setProjectModalOpen(true);
  }, []);

  const handleDeleteProject = useCallback(
    async (pid: string): Promise<void> => {
      const res = await pclient.deleteProject(pid);
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      setServerProjects((prev) => prev.filter((p) => p.id !== pid));
      if (activeProjectId === pid) handleCloseProject();
    },
    [activeProjectId, handleCloseProject],
  );

  const storage: StorageShape = projectsToStorageShape(serverProjects, activeProjectId, activeVersionId);
  const activeProjectData = activeProjectId ? storage.projects[activeProjectId] : null;
  const activeVersionData =
    activeProjectData && activeVersionId
      ? activeProjectData.versions[activeVersionId] ?? null
      : null;

  const onLockedModuleClick = useCallback(
    (featureKey: string, requiredPlan: 'professional' | 'enterprise') => {
      setUpgradePrompt({ featureKey, requiredPlan });
    },
    [],
  );

  // Module rendering
  const renderModule = (): React.ReactNode => {
    // A module hidden in admin is dropped from the dynamic sidebar list, but a
    // deep link or stale activeModule could still target its key. Guard the
    // render so a hidden / not-launched module is genuinely unreachable, not
    // just absent from the sidebar. (Before the dynamic fetch resolves the list
    // is the full static fallback, so nothing is falsely hidden on first paint.)
    const visibleModuleKeys = new Set(
      dynamicSidebarModules.filter((m) => m.key.startsWith('module')).map((m) => m.key),
    );
    if (activeModule.startsWith('module') && !visibleModuleKeys.has(activeModule)) {
      return (
        <div style={{ padding: 'var(--sp-3)' }} data-testid="module-hidden">
          This module is not available.
        </div>
      );
    }

    // 2026-06-16: Dashboard and Overview are now DISTINCT. Dashboard is the
    // all-projects hub (project-agnostic landing); Overview is the investor
    // summary of the single open project (only meaningful with a project open).
    if (activeModule === 'dashboard') {
      return (
        <Dashboard
          storage={storage}
          activeProjectId={activeProjectId}
          activeVersionId={activeVersionId}
          onCreateProject={() => setWizardOpen(true)}
          onSelectProject={(id) => void handleSelectProject(id)}
          onSelectModule={setActiveModule}
          onSelectTab={setActiveTab}
          onSaveVersion={() => setVersionModalOpen(true)}
          onLoadVersion={(pid, vid) => void handleLoadVersion(pid, vid)}
          can={can}
        />
      );
    }
    if (activeModule === 'overview') {
      if (!activeProjectId) {
        return (
          <div style={{ padding: 'var(--sp-3)' }} data-testid="overview-no-project">
            Open a project to see its investor summary.
          </div>
        );
      }
      return <Overview projectName={activeProjectData?.name ?? null} status={activeProjectData?.status ?? null} />;
    }
    if (activeModule === 'projects') {
      return (
        <ProjectsScreen
          storage={storage}
          activeProjectId={activeProjectId}
          onCreateProject={() => setWizardOpen(true)}
          onSelectProject={(id) => void handleSelectProject(id)}
          onCloseProject={handleCloseProject}
          onEditProject={handleEditProject}
          onDeleteProject={(id) => void handleDeleteProject(id)}
          setActiveModule={setActiveModule}
          can={can}
        />
      );
    }
    if (activeModule === 'module1') {
      if (!activeProjectId) {
        return (
          <div style={{ padding: 'var(--sp-3)' }} data-testid="m1-no-project">
            No project selected.{' '}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            >
              Create Project
            </button>
          </div>
        );
      }
      return (
        <div data-testid="module1-shell">
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-1)',
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 'var(--sp-3)',
            }}
            data-testid="m1-tab-row"
          >
            {m1Tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                data-testid={`m1-tab-${tab.key}`}
                style={{
                  padding: 'var(--sp-1) var(--sp-2)',
                  background: activeTab === tab.key ? 'var(--color-navy)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-small)',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          {activeTab === 'project-phases' && <Module1ProjectPhases />}
          {activeTab === 'assets' && <Module1Assets />}
          {activeTab === 'costs' && <Module1Costs />}
          {activeTab === 'financing' && <Module1Financing />}
        </div>
      );
    }
    if (activeModule === 'module2') {
      if (!activeProjectId) {
        return (
          <div style={{ padding: 'var(--sp-3)' }} data-testid="m2-no-project">
            No project selected.{' '}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            >
              Create Project
            </button>
          </div>
        );
      }
      const m2ActiveTab = m2Tabs.some((t) => t.key === activeTab) ? activeTab : m2Tabs[0].key;
      return (
        <div data-testid="module2-shell-wrap">
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-1)',
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 'var(--sp-3)',
            }}
            data-testid="m2-tab-row"
          >
            {m2Tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                data-testid={`m2-tab-${tab.key}`}
                style={{
                  padding: 'var(--sp-1) var(--sp-2)',
                  background: m2ActiveTab === tab.key ? 'var(--color-navy)' : 'transparent',
                  color: m2ActiveTab === tab.key ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-small)',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          {m2ActiveTab === 'm2-inputs' && <Module2Revenue />}
          {m2ActiveTab === 'm2-revenue' && <Module2RevenueOutput />}
          {m2ActiveTab === 'm2-cost-of-sales' && <Module2CostOfSales />}
          {m2ActiveTab === 'm2-schedules' && <Module2Schedules />}
          {m2ActiveTab === 'm2-escrow' && <Module2Escrow />}
        </div>
      );
    }
    if (activeModule === 'module3') {
      if (!activeProjectId) {
        return (
          <div style={{ padding: 'var(--sp-3)' }} data-testid="m3-no-project">
            No project selected.{' '}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            >
              Create Project
            </button>
          </div>
        );
      }
      const m3ActiveTab = m3Tabs.some((t) => t.key === activeTab) ? activeTab : m3Tabs[0].key;
      return (
        <div data-testid="module3-shell-wrap">
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-1)',
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 'var(--sp-3)',
            }}
            data-testid="m3-tab-row"
          >
            {m3Tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                data-testid={`m3-tab-${tab.key}`}
                style={{
                  padding: 'var(--sp-1) var(--sp-2)',
                  background: m3ActiveTab === tab.key ? 'var(--color-navy)' : 'transparent',
                  color: m3ActiveTab === tab.key ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-small)',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          {m3ActiveTab === 'm3-inputs' && <Module3Opex />}
          {m3ActiveTab === 'm3-output' && <Module3OpexOutput />}
        </div>
      );
    }
    if (activeModule === 'module4') {
      if (!activeProjectId) {
        return (
          <div style={{ padding: 'var(--sp-3)' }} data-testid="m4-no-project">
            No project selected.{' '}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            >
              Create Project
            </button>
          </div>
        );
      }
      const m4ActiveTab = m4Tabs.some((t) => t.key === activeTab) ? activeTab : m4Tabs[0].key;
      return (
        <div data-testid="module4-shell-wrap">
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-1)',
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 'var(--sp-3)',
            }}
            data-testid="m4-tab-row"
          >
            {m4Tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                data-testid={`m4-tab-${tab.key}`}
                style={{
                  padding: 'var(--sp-1) var(--sp-2)',
                  background: m4ActiveTab === tab.key ? 'var(--color-navy)' : 'transparent',
                  color: m4ActiveTab === tab.key ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-small)',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          {m4ActiveTab === 'm4-schedules' && <Module4Schedules />}
          {m4ActiveTab === 'm4-pl' && <Module4PL />}
          {m4ActiveTab === 'm4-cashflow' && <Module4CashFlow />}
          {m4ActiveTab === 'm4-balancesheet' && <Module4BalanceSheet />}
        </div>
      );
    }
    if (activeModule === 'module5') {
      if (!activeProjectId) {
        return (
          <div style={{ padding: 'var(--sp-3)' }} data-testid="m5-no-project">
            No project selected.{' '}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn-primary"
              style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            >
              Create Project
            </button>
          </div>
        );
      }
      const m5ActiveTab = m5Tabs.some((t) => t.key === activeTab) ? activeTab : m5Tabs[0].key;
      return (
        <div data-testid="module5-shell-wrap">
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-1)',
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 'var(--sp-3)',
            }}
            data-testid="m5-tab-row"
          >
            {m5Tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                data-testid={`m5-tab-${tab.key}`}
                style={{
                  padding: 'var(--sp-1) var(--sp-2)',
                  background: m5ActiveTab === tab.key ? 'var(--color-navy)' : 'transparent',
                  color: m5ActiveTab === tab.key ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--font-small)',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          {m5ActiveTab === 'm5-returns' && <Module5Returns />}
          {m5ActiveTab === 'm5-metrics' && <Module5Metrics />}
          {m5ActiveTab === 'm5-cases' && <Module5CaseComparison />}
        </div>
      );
    }
    if (activeModule === 'module6') {
      if (!activeProjectId) {
        return (
          <div style={{ padding: 'var(--sp-3)' }} data-testid="m6-no-project">
            No project selected.{' '}
            <button type="button" onClick={() => setWizardOpen(true)} className="btn-primary" style={{ padding: 'var(--sp-1) var(--sp-2)' }}>
              Create Project
            </button>
          </div>
        );
      }
      return <Module6Scenarios />;
    }
    return (
      <div style={{ padding: 'var(--sp-3)' }} data-testid="module-coming-soon">
        Module &quot;{activeModule}&quot; is coming soon.
      </div>
    );
  };

  return (
    // M2.0i Fix 8 (2026-05-07): outer wrapper height: 100vh (was
    // minHeight: 100vh) so the page never grows beyond the viewport.
    // Combined with `.app-shell { overflow: hidden }` and `<main
    // overflow: auto >`, the sidebar stays put while only the
    // workspace content scrolls. Standard SaaS pattern.
    // Pass 32 (2026-05-14): default platform zoom 80% so the dense
    // financial tables breathe at typical 1080p+ widths. CSS `zoom`
    // is widely supported in evergreen browsers and composes with
    // the user's own browser zoom (Ctrl+/-).
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh / 0.8)', width: 'calc(100vw / 0.8)', overflow: 'hidden', zoom: 0.8 }}>
      <Topbar
        projectName={activeProjectData?.name ?? ''}
        activeProjectData={activeProjectData}
        activeVersionData={activeVersionData}
        hasUnsaved={hasUnsaved}
        lastSavedAt={lastSavedAt}
        currentUserRole={currentUserRole}
        can={can}
        onSave={handleSaveQuick}
        onOpenProjects={() => setProjectModalOpen(true)}
        onOpenVersions={() => setVersionModalOpen(true)}
        onOpenRbac={() => setRbacModalOpen(true)}
        onExportClick={() => setExportModalOpen(true)}
        onGuideClick={() => setGuideOpen(true)}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((v) => !v)}
      />
      <div className="app-shell" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
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
          onLockedModuleClick={onLockedModuleClick}
          onOpenProjects={() => setProjectModalOpen(true)}
          onOpenRbac={() => setRbacModalOpen(true)}
          modules={dynamicSidebarModules}
        />
        <main className={scrollStyles.scroll} style={{ flex: 1, padding: 'var(--sp-3)', overflow: 'auto' }}>
          {loadError && (
            <div
              role="alert"
              data-testid="m1-load-error"
              style={{
                background: 'var(--color-warning-bg)',
                border: '1px solid var(--color-warning)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--sp-2)',
                marginBottom: 'var(--sp-2)',
              }}
            >
              {loadError}{' '}
              <button
                type="button"
                onClick={() => setLoadError(null)}
                style={{ marginLeft: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                Dismiss
              </button>
            </div>
          )}
          {sessionStartedToast && activeProjectId && (
            <div
              role="status"
              data-testid="session-started-toast"
              style={{
                background: 'color-mix(in srgb, var(--color-primary, #1d4ed8) 12%, transparent)',
                border: '1px solid var(--color-primary, #1d4ed8)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--sp-2)',
                marginBottom: 'var(--sp-2)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                fontSize: 'var(--font-small)',
              }}
            >
              <span>
                ✏️ Editing as <strong>{sessionStartedToast}</strong>, all changes
                in this session save to one version. Use{' '}
                <strong>📌 Save Version</strong> in the topbar to rename it.
              </span>
              <button
                type="button"
                data-testid="session-started-toast-rename"
                onClick={() => {
                  setNameVersionModalMode('rename');
                  setEditingVersionLabel(getSessionState().editingLabel);
                  setNameVersionModalOpen(true);
                }}
                style={{
                  background: 'var(--color-primary, #1d4ed8)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => setSessionStartedToast(null)}
                data-testid="session-started-toast-dismiss"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Dismiss
              </button>
            </div>
          )}
          {migrationNotice && (
            <div
              role="status"
              data-testid="m20h-migration-banner"
              style={{
                background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                border: '1px solid var(--color-success)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--sp-2)',
                marginBottom: 'var(--sp-2)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--sp-2)',
              }}
            >
              <span style={{ fontSize: 'var(--font-small)' }}>{migrationNotice}</span>
              <button
                type="button"
                onClick={() => setMigrationNotice(null)}
                data-testid="m20h-migration-banner-dismiss"
                style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}
              >
                Dismiss
              </button>
            </div>
          )}
          {renderModule()}
        </main>
      </div>

      {/* 2026-05-31 BUG-B FIX: overlay shown during a project switch so
          the user sees an unambiguous loading state instead of stale
          numbers from the previous project. Pointer-events:auto on the
          backdrop prevents any clicks reaching the underlying UI during
          the hydration window. */}
      {isSwitchingProject && (
        <div
          role="status"
          aria-live="polite"
          data-testid="project-switching-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
        >
          <div
            style={{
              background: 'var(--color-surface, #fff)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md, 10px)',
              padding: '18px 26px',
              fontSize: 'var(--font-body)',
              fontWeight: 600,
              color: 'var(--color-heading)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2px solid var(--color-border)',
                borderTopColor: 'var(--color-primary, #1d4ed8)',
                animation: 'fmp-spin 0.8s linear infinite',
              }}
            />
            Loading project...
          </div>
          <style>{`@keyframes fmp-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      <ProjectWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreate={(draft) => void handleCreateFromWizard(draft)}
      />
      <ProjectModal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        storage={storage}
        onSelectProject={(id) => {
          setProjectModalOpen(false);
          void handleSelectProject(id);
        }}
      />
      <VersionModal
        open={versionModalOpen}
        onClose={() => setVersionModalOpen(false)}
        projectId={activeProjectId}
        projectName={activeProjectData?.name ?? null}
        activeVersionId={activeVersionId}
        onCreateVersion={can('canSave') ? handleSaveQuick : undefined}
        onLoadVersion={(versionId) => {
          if (activeProjectId) void handleLoadVersion(activeProjectId, versionId);
          setVersionModalOpen(false);
        }}
      />
      <NameVersionModal
        open={nameVersionModalOpen}
        mode={nameVersionModalMode}
        defaultLabel={defaultSessionLabel()}
        currentLabel={editingVersionLabel}
        projectName={activeProjectData?.name ?? null}
        existingVersions={Object.values(activeProjectData?.versions ?? {}).map((v) => ({ name: v.name, createdAt: v.createdAt }))}
        discardOnCancel={!getSessionState().editingVersionId}
        onConfirm={handleNameVersionConfirm}
        onCancel={handleNameVersionCancel}
      />
      <RbacModal
        open={rbacModalOpen}
        onClose={() => setRbacModalOpen(false)}
        currentRole={currentUserRole}
        selectedRole={rbacSelectedRole}
        onSelectRole={setRbacSelectedRole}
        onApply={(role) => {
          setCurrentUserRole(role);
          setRbacModalOpen(false);
        }}
      />
      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        canAccess={canAccess}
        projectId={activeProjectId}
        projectName={activeProjectData?.name ?? null}
        versionLabel={activeVersionData?.name ?? null}
      />
      <PlatformGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        doc={buildPlatformGuide({ modules: MODULES, moduleTabs: MODULE_TABS })}
        dateLabel={new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
      />
      {upgradePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setUpgradePrompt(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--color-bg)', padding: 'var(--sp-3)', borderRadius: 'var(--radius)' }}
          >
            <UpgradePrompt
              featureKey={upgradePrompt.featureKey}
              requiredPlan={upgradePrompt.requiredPlan}
              variant="card"
            />
            <div style={{ textAlign: 'right', marginTop: 'var(--sp-2)' }}>
              <button type="button" onClick={() => setUpgradePrompt(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

void ROLE_META;
void useBrandingStore;
void extractHydrateSnapshot;
