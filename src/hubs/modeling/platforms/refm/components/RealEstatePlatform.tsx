'use client';

/**
 * RealEstatePlatform.tsx (v5 schema, M2.0)
 *
 * Slim 4-tab shell. Ditches the 2055-line legacy version that wove
 * Module 1 state through prop-drilling, useState scaffolding, and
 * dead helpers. The 4 new tab components subscribe directly to the
 * v5 Zustand store, so the shell's only job is to wire layout +
 * persistence + project routing.
 *
 * Tabs (4): Project & Phases / Assets & Sub-units / Costs / Financing.
 * No Build Program, no Hierarchy, no Land tab, no Plot/Parcel wizards.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSession } from 'next-auth/react';

import { ROLES, ROLE_META, MODULE_VISIBILITY, PERMISSIONS, useBrandingStore } from '@/src/core/state';
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
    label: `Module ${m.num} - ${m.shortLabel}`,
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

  // Subscription / plan gating (currently locked pre-launch)
  const canAccess = (_featureKey: string): boolean => false;
  const subLoaded = true;
  const [upgradePrompt, setUpgradePrompt] = useState<{ featureKey: string; requiredPlan: 'professional' | 'enterprise' } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // RBAC (admin-only by default; left as user-toggle for testing)
  const [currentUserRole, setCurrentUserRole] = useState<Role>(ROLES.ADMIN);
  const [rbacModalOpen, setRbacModalOpen] = useState(false);
  const [rbacSelectedRole, setRbacSelectedRole] = useState<Role>(ROLES.ADMIN);

  // Server-side project list
  const [serverProjects, setServerProjects] = useState<pclient.RefmProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal state
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);

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
      // If a previously-active project lives in localStorage, restore it
      const cached = readActiveProjectId();
      if (cached && (res.data?.projects ?? []).some((p) => p.id === cached)) {
        setActiveProjectId(cached);
        const attach = await attachSyncToProject(cached);
        if (attach.error) setLoadError(attach.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Project selection / load
  const handleSelectProject = useCallback(async (projectId: string) => {
    setActiveProjectId(projectId);
    writeActiveProjectId(projectId);
    setActiveTab('project-phases');
    setActiveModule('module1');
    const res = await attachSyncToProject(projectId);
    if (res.error) setLoadError(res.error);
  }, []);

  const handleCreateFromWizard = useCallback(
    async (draft: WizardDraft): Promise<void> => {
      const snapshot = buildWizardSnapshot(draft);
      // Hydrate the store immediately so the post-create UI sees the
      // wizard data without round-tripping through the server.
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
  }, []);

  // Build StorageShape for legacy consumers (Dashboard / ProjectsScreen / Overview)
  const storage: StorageShape = projectsToStorageShape(serverProjects, activeProjectId, activeVersionId);

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
          onCreateProject={() => setWizardOpen(true)}
          onSelectProject={(id) => void handleSelectProject(id)}
          onCloseProject={handleCloseProject}
        />
      );
    }
    if (activeModule === 'overview') {
      if (!activeProjectId) {
        return <div style={{ padding: 'var(--sp-3)' }}>Select a project to view its overview.</div>;
      }
      return <OverviewScreen storage={storage} />;
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
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        activeModule={activeModule}
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        subOpen={sidebarSubOpen}
        onSelectModule={setActiveModule}
        onSelectTab={setActiveTab}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        onToggleSubOpen={() => setSidebarSubOpen((v) => !v)}
        canAccess={canAccess}
        subLoaded={subLoaded}
        onUpgradePrompt={setUpgradePrompt}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Topbar
          activeProjectId={activeProjectId}
          activeProject={activeProjectId ? storage.projects[activeProjectId] : null}
          onOpenProject={() => setProjectModalOpen(true)}
          onOpenVersion={() => setVersionModalOpen(true)}
          onOpenExport={() => setExportModalOpen(true)}
          onOpenRbac={() => setRbacModalOpen(true)}
          onCloseProject={handleCloseProject}
          currentUserRole={currentUserRole}
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
      <ExportModal open={exportModalOpen} onClose={() => setExportModalOpen(false)} />
      {upgradePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setUpgradePrompt(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg)', padding: 'var(--sp-3)', borderRadius: 'var(--radius)' }}>
            <UpgradePrompt featureKey={upgradePrompt.featureKey} requiredPlan={upgradePrompt.requiredPlan} variant="card" />
            <div style={{ textAlign: 'right', marginTop: 'var(--sp-2)' }}>
              <button type="button" onClick={() => setUpgradePrompt(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// References preserved to avoid unused-import warnings while shell modules
// catch up to v5. Each is consumed by a downstream legacy component that
// still imports it; deleting these here would break those imports
// transparently to lint.
void ROLE_META;
void MODULE_VISIBILITY;
void PERMISSIONS;
void useBrandingStore;
void extractHydrateSnapshot;
