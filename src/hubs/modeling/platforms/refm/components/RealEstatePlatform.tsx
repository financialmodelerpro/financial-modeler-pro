'use client';

/**
 * RealEstatePlatform.tsx (v5 schema, M2.0b shell rewire)
 *
 * Phase M2.0 (4-tab MAAD-Spec rebuild) + Phase M2.0b (brand-styled
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
import OverviewScreen from './OverviewScreen';
import Module1ProjectPhases from './modules/Module1ProjectPhases';
import Module1Assets from './modules/Module1Assets';
import Module1Costs from './modules/Module1Costs';
import Module1Financing from './modules/Module1Financing';

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

const STATIC_NAV: readonly SidebarNavItem[] = [
  { key: 'dashboard', icon: '📊', label: 'Dashboard', featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
  { key: 'projects', icon: '🏗️', label: 'Projects', featureKey: null, requiredPlan: null, badge: null, badgeClass: '' },
  { key: 'overview', icon: '📋', label: 'Overview', featureKey: null, requiredPlan: null, badge: null, badgeClass: '', disabledReason: 'Select a project first' },
];

export const sidebarModules: readonly SidebarNavItem[] = [
  ...STATIC_NAV,
  ...MODULES.map((m): SidebarNavItem => ({
    key: m.key,
    icon: m.icon,
    label: `Module ${m.num}, ${m.shortLabel}`,
    featureKey: m.featureKey,
    requiredPlan: m.requiredPlan,
    badge: m.status === 'done' ? '✓' : m.status === 'soon' ? 'SOON' : null,
    badgeClass: m.status === 'done' ? 'badge-done' : m.status === 'soon' ? 'badge-soon' : '',
    disabled: m.disabled,
    disabledReason: m.disabledReason,
  })),
];

// ── Module 1 tabs (M2.0: 4 tabs) ──────────────────────────────────────────
export const m1Tabs = [
  { key: 'project-phases', icon: '📅', label: '1. Project & Phases', step: 1 },
  { key: 'assets', icon: '🏗️', label: '2. Assets & Sub-units', step: 2 },
  { key: 'costs', icon: '💸', label: '3. Costs', step: 3 },
  { key: 'financing', icon: '🏦', label: '4. Financing', step: 4 },
];

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

  // Subscription / plan gating (currently locked pre-launch)
  const canAccess = (_featureKey: string): boolean => false;
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
    if (activeModule === 'dashboard') {
      return (
        <Dashboard
          storage={storage}
          onCreateProject={() => setWizardOpen(true)}
          onSelectProject={(id) => void handleSelectProject(id)}
          onSelectModule={setActiveModule}
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
    if (activeModule === 'overview') {
      return (
        <OverviewScreen
          storage={storage}
          activeProjectId={activeProjectId}
          activeVersionId={activeVersionId}
          onLoadVersion={(pid, vid) => void handleLoadVersion(pid, vid)}
          onSaveVersion={() => setVersionModalOpen(true)}
          onEditProject={() => setProjectModalOpen(true)}
          setActiveModule={setActiveModule}
          setActiveTab={setActiveTab}
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
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
