'use client';

/**
 * Sidebar.tsx (M2.0b restored brand-styled sidebar)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand sidebar that
 * the M2.0 slim shell stripped, project/version panel, module list
 * with locks/badges, Module 1 sub-tabs, collapsed pills, role
 * indicator footer.
 *
 * Adapted to v5: m1Tabs reads the new 4-tab structure (project-
 * phases / assets / costs / financing). Project + version names
 * passed in via props from the v5-aware shell.
 */

import React from 'react';
import type { Role } from '@/src/core/types/settings.types';
import { ROLE_META } from '@/src/core/state';
import { sidebarModules as staticSidebarModules, m1Tabs, m2Tabs } from './RealEstatePlatform';
import type { SidebarNavItem } from '../lib/usePlatformModules';
import PlanBadge from './PlanBadge';

interface SidebarProps {
  activeModule: string;
  setActiveModule: (m: string) => void;
  activeTab: string;
  setActiveTab: (t: string) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  sidebarSubOpen: boolean;
  setSidebarSubOpen: (v: boolean) => void;
  currentUserRole: Role;
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeVersionName: string | null;
  canSeeModule: (key: string) => boolean;
  canAccess: (featureKey: string) => boolean;
  subLoaded: boolean;
  onLockedModuleClick: (featureKey: string, requiredPlan: 'professional' | 'enterprise') => void;
  onOpenProjects: () => void;
  onOpenRbac: () => void;
  /** Optional dynamic module list, overrides the static export. */
  modules?: readonly SidebarNavItem[];
}

export default function Sidebar({
  activeModule,
  setActiveModule,
  activeTab,
  setActiveTab,
  sidebarCollapsed,
  setSidebarCollapsed,
  sidebarSubOpen,
  setSidebarSubOpen,
  currentUserRole,
  activeProjectId,
  activeProjectName,
  activeVersionName,
  canSeeModule,
  canAccess,
  subLoaded,
  onLockedModuleClick,
  onOpenProjects,
  onOpenRbac,
  modules,
}: SidebarProps): React.JSX.Element {
  const roleMeta = ROLE_META[currentUserRole];
  const sidebarModules = modules ?? staticSidebarModules;

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`} data-testid="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-header-title">Navigation</span>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-testid="sidebar-toggle"
        >
          ◀
        </button>
      </div>

      <div className="sb-pv-panel">
        <div
          className="sb-pv-row"
          onClick={onOpenProjects}
          title="Switch project"
          data-testid="sidebar-pv-project"
        >
          <div className="sb-pv-dot sb-pv-dot-proj" />
          <div className="sb-pv-content">
            <div className="sb-pv-eyebrow">Project</div>
            <div className="sb-pv-name">{activeProjectName ?? 'No project selected'}</div>
          </div>
          <div className="sb-pv-arrow">▶</div>
        </div>
        <div className="sb-pv-row" title="Current version" data-testid="sidebar-pv-version">
          <div className="sb-pv-dot sb-pv-dot-ver" />
          <div className="sb-pv-content">
            <div className="sb-pv-eyebrow">Version</div>
            <div className="sb-pv-name">{activeVersionName ?? 'Unsaved draft'}</div>
          </div>
        </div>
      </div>

      <div className="sb-pv-collapsed">
        <button
          className="sb-pv-collapsed-pill"
          onClick={onOpenProjects}
          title={activeProjectName ?? 'Projects'}
        >
          🏗️
        </button>
        <button className="sb-pv-collapsed-pill" title={activeVersionName ?? 'Versions'}>
          📌
        </button>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Platform</div>

        {sidebarModules.map((mod) => {
          const isDisabledByPermission = !canSeeModule(mod.key);
          const isDisabledByConfig = mod.disabled === true;
          const isOverviewDisabled = mod.key === 'overview' && !activeProjectId;
          const isFeatureLocked = subLoaded && !!mod.featureKey && !canAccess(mod.featureKey);

          const isDisabled = isFeatureLocked
            ? false
            : isDisabledByPermission || isDisabledByConfig || isOverviewDisabled;

          const disabledReason = isDisabledByPermission
            ? 'Your role cannot view this module'
            : isOverviewDisabled
            ? 'Select a project first'
            : mod.disabledReason;

          const isActive = activeModule === mod.key;
          const isModule1 = mod.key === 'module1';
          const isModule2 = mod.key === 'module2';
          const hasSubTabs = isModule1 || isModule2;

          return (
            <div key={mod.key} className="sidebar-item-wrap">
              <button
                className={`sidebar-item${isActive ? ' active' : ''}${isDisabled ? ' disabled' : ''}${isFeatureLocked ? ' feature-locked' : ''}`}
                onClick={() => {
                  if (
                    isFeatureLocked &&
                    mod.featureKey &&
                    (mod.requiredPlan === 'professional' || mod.requiredPlan === 'enterprise')
                  ) {
                    onLockedModuleClick(mod.featureKey, mod.requiredPlan);
                    return;
                  }
                  if (isDisabled) return;
                  setActiveModule(mod.key);
                  if (hasSubTabs) {
                    setSidebarSubOpen(true);
                    if (isModule2 && !m2Tabs.some((t) => t.key === activeTab)) {
                      setActiveTab(m2Tabs[0].key);
                    }
                    if (isModule1 && !m1Tabs.some((t) => t.key === activeTab)) {
                      setActiveTab(m1Tabs[0].key);
                    }
                  }
                }}
                disabled={isDisabled}
                title={isFeatureLocked ? `Requires ${mod.requiredPlan} plan` : isDisabled ? disabledReason : mod.label}
                data-testid={`sidebar-${mod.key}`}
              >
                <span className="sidebar-icon">{mod.icon}</span>
                <span className="sidebar-label">{mod.label}</span>
                {isFeatureLocked ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
                    <span style={{ fontSize: 10 }}>🔒</span>
                    {(mod.requiredPlan === 'professional' || mod.requiredPlan === 'enterprise') && (
                      <PlanBadge requiredPlan={mod.requiredPlan} />
                    )}
                  </span>
                ) : (
                  mod.badge && <span className={`sidebar-badge ${mod.badgeClass}`}>{mod.badge}</span>
                )}
                {hasSubTabs && !sidebarCollapsed && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'color-mix(in srgb, var(--color-on-primary-navy) 40%, transparent)',
                      marginLeft: '4px',
                      flexShrink: 0,
                      transition: 'transform 0.2s ease',
                      transform: sidebarSubOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSidebarSubOpen(!sidebarSubOpen);
                    }}
                  >
                    ▶
                  </span>
                )}
              </button>

              {sidebarCollapsed && (
                <div className="sidebar-tooltip">
                  {isFeatureLocked ? `Requires ${mod.requiredPlan} plan` : isDisabled ? disabledReason : mod.label}
                </div>
              )}

              {isModule1 && (
                <div className={`sidebar-sub${sidebarSubOpen && isActive ? ' open' : ''}`}>
                  {m1Tabs.map((tab) => (
                    <button
                      key={tab.key}
                      className={`sidebar-sub-item${activeTab === tab.key && isActive ? ' active' : ''}`}
                      onClick={() => {
                        setActiveModule('module1');
                        setActiveTab(tab.key);
                      }}
                      data-testid={`sidebar-tab-${tab.key}`}
                    >
                      <span>{tab.icon}</span>
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {isModule2 && (
                <div className={`sidebar-sub${sidebarSubOpen && isActive ? ' open' : ''}`}>
                  {m2Tabs.map((tab) => (
                    <button
                      key={tab.key}
                      className={`sidebar-sub-item${activeTab === tab.key && isActive ? ' active' : ''}`}
                      onClick={() => {
                        setActiveModule('module2');
                        setActiveTab(tab.key);
                      }}
                      data-testid={`sidebar-tab-${tab.key}`}
                    >
                      <span>{tab.icon}</span>
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="sidebar-divider" />
        <div className="sidebar-section-label">Tools</div>

        <div className="sidebar-item-wrap">
          <button className="sidebar-item" style={{ opacity: 0.5, cursor: 'not-allowed' }} disabled>
            <span className="sidebar-icon">⚙️</span>
            <span className="sidebar-label">Settings</span>
            <span className="sidebar-badge badge-soon">SOON</span>
          </button>
        </div>
      </nav>

      <div className="sidebar-footer">
        <div
          className="sb-role-indicator"
          onClick={onOpenRbac}
          title={`Role: ${roleMeta?.label}. Click to switch.`}
          data-testid="sidebar-role-indicator"
        >
          <div className="sb-role-dot" style={{ background: roleMeta?.dotColor }} />
          <span
            style={{
              fontSize: '11px',
              color: 'color-mix(in srgb, var(--color-on-primary-navy) 65%, transparent)',
              fontWeight: 600,
            }}
          >
            {roleMeta?.label}
          </span>
        </div>
      </div>
    </aside>
  );
}
