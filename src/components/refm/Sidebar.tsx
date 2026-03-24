'use client';

import React from 'react';
import type { Role } from '@/src/types/settings.types';
import { ROLE_META } from '@/src/core/core-state';
import { sidebarModules, m1Tabs } from './RealEstatePlatform';
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
}

export default function Sidebar({
  activeModule, setActiveModule,
  activeTab, setActiveTab,
  sidebarCollapsed, setSidebarCollapsed,
  sidebarSubOpen, setSidebarSubOpen,
  currentUserRole,
  activeProjectId, activeProjectName, activeVersionName,
  canSeeModule,
  canAccess, subLoaded, onLockedModuleClick,
  onOpenProjects, onOpenRbac,
}: SidebarProps) {
  const roleMeta = ROLE_META[currentUserRole];

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-header-title">Navigation</span>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          ◀
        </button>
      </div>

      {/* Project/Version panel */}
      <div className="sb-pv-panel">
        <div className="sb-pv-row" onClick={onOpenProjects} title="Switch project">
          <div className="sb-pv-dot sb-pv-dot-proj" />
          <div className="sb-pv-content">
            <div className="sb-pv-eyebrow">Project</div>
            <div className="sb-pv-name">{activeProjectName ?? 'No project selected'}</div>
          </div>
          <div className="sb-pv-arrow">▶</div>
        </div>
        <div className="sb-pv-row" title="Current version">
          <div className="sb-pv-dot sb-pv-dot-ver" />
          <div className="sb-pv-content">
            <div className="sb-pv-eyebrow">Version</div>
            <div className="sb-pv-name">{activeVersionName ?? 'Unsaved draft'}</div>
          </div>
        </div>
      </div>

      {/* Collapsed pills */}
      <div className="sb-pv-collapsed">
        <button className="sb-pv-collapsed-pill" onClick={onOpenProjects} title={activeProjectName ?? 'Projects'}>
          🏗️
        </button>
        <button className="sb-pv-collapsed-pill" title={activeVersionName ?? 'Versions'}>
          📌
        </button>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Platform</div>

        {sidebarModules.map(mod => {
          // Use type cast for optional properties that only exist on some union members
          const modAny = mod as { disabled?: boolean; disabledReason?: string; badge?: string | null; badgeClass?: string };
          const isDisabledByPermission = !canSeeModule(mod.key);
          const isDisabledByConfig = modAny.disabled === true;
          const isOverviewDisabled = mod.key === 'overview' && !activeProjectId;
          const isFeatureLocked = subLoaded && !!mod.featureKey && !canAccess(mod.featureKey);

          // Feature lock overrides "coming soon" disabled — user sees upgrade CTA instead
          const isDisabled = isFeatureLocked
            ? false
            : isDisabledByPermission || isDisabledByConfig || isOverviewDisabled;

          const disabledReason = isDisabledByPermission
            ? `Your role cannot view this module`
            : isOverviewDisabled
            ? 'Select a project first'
            : modAny.disabledReason;

          const isActive = activeModule === mod.key;
          const isModule1 = mod.key === 'module1';

          return (
            <div key={mod.key} className="sidebar-item-wrap">
              <button
                className={`sidebar-item${isActive ? ' active' : ''}${isDisabled ? ' disabled' : ''}${isFeatureLocked ? ' feature-locked' : ''}`}
                onClick={() => {
                  if (isFeatureLocked && mod.featureKey && (mod.requiredPlan === 'professional' || mod.requiredPlan === 'enterprise')) {
                    onLockedModuleClick(mod.featureKey, mod.requiredPlan);
                    return;
                  }
                  if (isDisabled) return;
                  setActiveModule(mod.key);
                  if (isModule1) setSidebarSubOpen(true);
                }}
                disabled={isDisabled}
                title={isFeatureLocked ? `Requires ${mod.requiredPlan} plan` : isDisabled ? disabledReason : mod.label}
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
                  modAny.badge && <span className={`sidebar-badge ${modAny.badgeClass}`}>{modAny.badge}</span>
                )}
                {isModule1 && !sidebarCollapsed && (
                  <span
                    style={{
                      fontSize: '10px', color: 'rgba(255,255,255,0.4)',
                      marginLeft: '4px', flexShrink: 0,
                      transition: 'transform 0.2s ease',
                      transform: sidebarSubOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                    onClick={(e) => { e.stopPropagation(); setSidebarSubOpen(!sidebarSubOpen); }}
                  >
                    ▶
                  </span>
                )}
              </button>

              {/* Tooltip when collapsed */}
              {sidebarCollapsed && (
                <div className="sidebar-tooltip">
                  {isFeatureLocked ? `Requires ${mod.requiredPlan} plan` : isDisabled ? disabledReason : mod.label}
                </div>
              )}

              {/* Sub-menu for module 1 */}
              {isModule1 && (
                <div className={`sidebar-sub${sidebarSubOpen && isActive ? ' open' : ''}`}>
                  {m1Tabs.map(tab => (
                    <button
                      key={tab.key}
                      className={`sidebar-sub-item${activeTab === tab.key && isActive ? ' active' : ''}`}
                      onClick={() => {
                        setActiveModule('module1');
                        setActiveTab(tab.key);
                      }}
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
          <button
            className="sidebar-item"
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
            disabled
          >
            <span className="sidebar-icon">⚙️</span>
            <span className="sidebar-label">Settings</span>
            <span className="sidebar-badge badge-soon">SOON</span>
          </button>
        </div>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div
          className="sb-role-indicator"
          onClick={onOpenRbac}
          title={`Role: ${roleMeta?.label}. Click to switch.`}
        >
          <div className="sb-role-dot" style={{ background: roleMeta?.dotColor }} />
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>
            {roleMeta?.label}
          </span>
        </div>
      </div>
    </aside>
  );
}
