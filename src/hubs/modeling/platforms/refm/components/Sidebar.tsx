'use client';

/**
 * Sidebar.tsx (v5 schema, M2.0 stub)
 *
 * Minimal sidebar that surfaces module navigation + the 4 Module 1
 * tab labels. The legacy multi-prop sprawl is replaced with a
 * compact set, full plan-gating + role-aware visibility lands in
 * M2.1+ once the shell stabilises.
 */

import React from 'react';
import { sidebarModules, m1Tabs } from './RealEstatePlatform';

interface SidebarProps {
  activeModule: string;
  activeTab: string;
  collapsed: boolean;
  subOpen: boolean;
  onSelectModule: (m: string) => void;
  onSelectTab: (t: string) => void;
  onToggleCollapsed: () => void;
  onToggleSubOpen: () => void;
  canAccess: (featureKey: string) => boolean;
  subLoaded: boolean;
  onUpgradePrompt: (p: { featureKey: string; requiredPlan: 'professional' | 'enterprise' } | null) => void;
}

export default function Sidebar({
  activeModule,
  activeTab,
  collapsed,
  subOpen,
  onSelectModule,
  onSelectTab,
  onToggleCollapsed,
  onToggleSubOpen,
  canAccess,
  subLoaded,
  onUpgradePrompt,
}: SidebarProps): React.JSX.Element {
  return (
    <aside
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
      style={{
        width: collapsed ? 60 : 240,
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        padding: 'var(--sp-2)',
        transition: 'width 0.15s ease',
      }}
      data-testid="sidebar"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
        {!collapsed && <strong style={{ fontSize: 'var(--font-small)' }}>Navigation</strong>}
        <button
          type="button"
          onClick={onToggleCollapsed}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          data-testid="sidebar-toggle"
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>
      {sidebarModules.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => {
            if (m.disabled) return;
            if (m.featureKey && !canAccess(m.featureKey) && subLoaded && m.requiredPlan && m.requiredPlan !== 'free') {
              onUpgradePrompt({ featureKey: m.featureKey, requiredPlan: m.requiredPlan as 'professional' | 'enterprise' });
              return;
            }
            onSelectModule(m.key);
            if (m.key === 'module1') onToggleSubOpen();
          }}
          data-testid={`sidebar-${m.key}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: 'var(--sp-1)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: activeModule === m.key ? 'var(--color-navy-pale)' : 'transparent',
            color: activeModule === m.key ? 'var(--color-navy)' : 'var(--color-body)',
            cursor: m.disabled ? 'not-allowed' : 'pointer',
            opacity: m.disabled ? 0.5 : 1,
            fontSize: 'var(--font-small)',
            textAlign: 'left',
            marginBottom: 2,
          }}
          title={m.disabled ? m.disabledReason : undefined}
        >
          <span>{m.icon}</span>
          {!collapsed && <span style={{ flex: 1 }}>{m.label}</span>}
          {!collapsed && m.badge && (
            <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>{m.badge}</span>
          )}
        </button>
      ))}
      {!collapsed && activeModule === 'module1' && subOpen && (
        <div style={{ marginTop: 'var(--sp-2)', paddingLeft: 'var(--sp-2)', borderLeft: '2px solid var(--color-border)' }}>
          {m1Tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelectTab(tab.key)}
              data-testid={`sidebar-tab-${tab.key}`}
              style={{
                display: 'block',
                width: '100%',
                padding: 'var(--sp-1)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: activeTab === tab.key ? 'var(--color-navy-pale)' : 'transparent',
                color: activeTab === tab.key ? 'var(--color-navy)' : 'var(--color-body)',
                cursor: 'pointer',
                fontSize: 'var(--font-small)',
                textAlign: 'left',
                marginBottom: 2,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
