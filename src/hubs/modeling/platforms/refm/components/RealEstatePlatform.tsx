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

import React, { useState, useEffect, useCallback } from 'react';
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
import {
  attachToProject as attachSyncToProject,
  attachToProjectFromLocalSnapshot,
  detach as detachSync,
  loadVersionInto,
} from '../lib/persistence/module1-sync';
import { readActiveProjectId, writeActiveProjectId, clearCachedSnapshot } from '../lib/persistence/cache';

import Topbar from './Topbar';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
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
import Module4FixedAssets from './modules/Module4FixedAssets';
import Module3Opex from './modules/Module3Opex';
import Module3OpexOutput from './modules/Module3OpexOutput';

import ProjectModal from './modals/ProjectModal';
import ProjectWizard, { type WizardDraft } from './modals/ProjectWizard';
import VersionModal from './modals/VersionModal';
import RbacModal from './modals/RbacModal';
import ExportModal from './modals/ExportModal';
import UpgradePrompt from '@/src/shared/components/UpgradePrompt';

import { buildWizardSnapshot } from '../lib/wizard/buildWizardSnapshot';
import { MODULES } from '../lib/modules-config';
import { usePlatformModules } from '../lib/usePlatformModules';

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
  { key: 'dashboard', icon: '📊', label: 'Dashboard', featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
  { key: 'projects', icon: '🏗️', label: 'Projects', featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
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

// ── Module 4 tabs (Financial Statements; Pass 1 ships Fixed Assets only) ──
// P&L / BS / CF surfaces land in subsequent passes. Pass 1 surfaces only
// the Fixed Assets + Depreciation roll-forward built by the M4 engine
// under src/core/calculations/depreciation/ + fixed-assets-resolvers.
export const m4Tabs = [
  { key: 'm4-fixed-assets', icon: '🏗️', label: '1. Fixed Assets & D&A', step: 1 },
];

// Universal module → sub-tabs map. Any module key that needs a sidebar
// drop-down just registers its tabs here; Sidebar.tsx reads from this
// map instead of hard-coding per-module branches. New modules (M4/M5/M6)
// only need to add their tabs here — sidebar code stays untouched.
export type SidebarSubTab = { key: string; icon: string; label: string; step: number };
export const MODULE_TABS: Record<string, ReadonlyArray<SidebarSubTab>> = {
  module1: m1Tabs,
  module2: m2Tabs,
  module3: m3Tabs,
  module4: m4Tabs,
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

  // P-Sync: dynamic platform modules from /api/platforms/refm/modules.
  // Falls back to static MODULES list while in flight.
  const { modules: dynamicSidebarModules } = usePlatformModules('refm');

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
  // M2.0h Fix 1 (2026-05-07): one-shot banner shown after a v7 -> v8
  // migration. Cleared by the user via the dismiss button.
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);

  // Modal state
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);

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
      const cached = readActiveProjectId();
      if (cached && (res.data?.projects ?? []).some((p) => p.id === cached)) {
        setActiveProjectId(cached);
        const attach = await attachSyncToProject(cached);
        if (attach.error) setLoadError(attach.error);
        if (attach.migrationNotice) setMigrationNotice(attach.migrationNotice);
      }
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

  // Project selection / load
  const handleSelectProject = useCallback(async (projectId: string) => {
    setActiveProjectId(projectId);
    writeActiveProjectId(projectId);
    setActiveTab('project-phases');
    setActiveModule('module1');
    setHasUnsaved(false);
    const res = await attachSyncToProject(projectId);
    if (res.error) setLoadError(res.error);
    if (res.migrationNotice) setMigrationNotice(res.migrationNotice);
  }, []);

  const handleCreateFromWizard = useCallback(
    async (draft: WizardDraft): Promise<void> => {
      const snapshot = buildWizardSnapshot(draft);
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
      attachToProjectFromLocalSnapshot(res.data.project.id, snapshot);
      setActiveTab('project-phases');
      setActiveModule('module1');
      setHasUnsaved(false);
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
    setActiveModule('projects');
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
    setActiveModule('module1');
    setHasUnsaved(false);
  }, []);

  const handleSaveVersion = useCallback(
    async (versionName: string): Promise<void> => {
      if (!activeProjectId) return;
      const snapshot = extractHydrateSnapshot(useModule1Store.getState());
      const res = await pclient.saveVersion(activeProjectId, {
        snapshot,
        label: versionName || null,
        assetMix: snapshot.assets.filter((a) => a.visible).map((a) => a.name),
      });
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      if (res.data) {
        setActiveVersionId(res.data.version.id);
        setServerProjects((prev) => prev.map((p) => (p.id === res.data!.project.id ? res.data!.project : p)));
      }
      setHasUnsaved(false);
      setLastSavedAt(new Date().toLocaleTimeString());
    },
    [activeProjectId],
  );

  const handleSaveQuick = useCallback(() => {
    void handleSaveVersion(`Save ${new Date().toLocaleTimeString()}`);
  }, [handleSaveVersion]);

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
    // Pass 47 (2026-05-14): both 'dashboard' and 'overview' route to
    // the Dashboard component. Overview was removed from the sidebar
    // since the Pass 45 Dashboard covers everything it used to.
    if (activeModule === 'dashboard' || activeModule === 'overview') {
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
          {m4ActiveTab === 'm4-fixed-assets' && <Module4FixedAssets />}
        </div>
      );
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
        <main style={{ flex: 1, padding: 'var(--sp-3)', overflow: 'auto' }}>
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
        onSave={can('canSave') ? (name) => void handleSaveVersion(name) : undefined}
        onLoadVersion={(versionId) => {
          if (activeProjectId) void handleLoadVersion(activeProjectId, versionId);
          setVersionModalOpen(false);
        }}
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
