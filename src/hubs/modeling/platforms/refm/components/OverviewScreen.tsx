'use client';

import React from 'react';
import type { ProjectType } from '@/src/core/types/project.types';
import type { PermissionMap } from '@/src/core/types/settings.types';
import { formatCurrency, formatNumber } from '@/src/core/formatters';
import type { StorageShape } from './RealEstatePlatform';

interface OverviewScreenProps {
  storageData: StorageShape;
  activeProjectId: string | null;
  activeVersionId: string | null;
  projectName: string;
  projectType: ProjectType;
  currency: string;
  totalLandValue: number;
  totalProjectGFA: number;
  totalCapex: number;
  onLoadVersion: (pid: string, vid: string) => void;
  onSaveVersion: () => void;
  onEditProject: () => void;
  setActiveModule: (m: string) => void;
  setActiveTab: (t: string) => void;
  can: (permission: keyof PermissionMap) => boolean;
}

export default function OverviewScreen({
  storageData, activeProjectId, activeVersionId,
  projectName, projectType, currency,
  totalLandValue, totalProjectGFA, totalCapex,
  onLoadVersion, onSaveVersion, onEditProject,
  setActiveModule, setActiveTab, can,
}: OverviewScreenProps) {
  const proj = activeProjectId ? storageData.projects[activeProjectId] : null;

  // Two empty-state cases collapse to the same UX:
  //   1. activeProjectId is null (nothing selected yet).
  //   2. activeProjectId is set but the project no longer exists in storage
  //      (e.g. deleted in another tab, or hydration mid-flight). Previously
  //      this returned `null` silently, which rendered a blank Overview
  //      screen — indistinguishable from a broken page.
  if (!proj || !activeProjectId) {
    const reason = activeProjectId
      ? 'The selected project is no longer available. Pick a different project to continue.'
      : 'No project selected. Go to Projects and select a project first.';
    return (
      <div className="module-view">
        <div className="state-empty">
          📋 {reason}
        </div>
        <div style={{ marginTop: 'var(--sp-2)', textAlign: 'center' }}>
          <button className="btn-primary" onClick={() => setActiveModule('projects')}>
            → Go to Projects
          </button>
        </div>
      </div>
    );
  }

  const versions = Object.entries(proj.versions || {});

  const quickLinks = [
    { icon: '📅', label: 'Timeline',    tab: 'timeline',  desc: 'Project schedule & model type' },
    { icon: '🗺️', label: 'Land & Area', tab: 'area',      desc: 'Land parcels & GFA hierarchy' },
    { icon: '💸', label: 'Dev Costs',   tab: 'costs',     desc: 'Construction cost items' },
    { icon: '🏦', label: 'Financing',   tab: 'financing', desc: 'Debt/equity structure' },
  ];

  return (
    <div className="module-view">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{
              fontSize: 'var(--font-h1)', fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.02em',
            }}>
              {proj.name}
            </h1>
            {can('canEditProject') && (
              <button
                type="button"
                onClick={onEditProject}
                title="Edit project name & location"
                aria-label="Edit project name & location"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  width: 30, height: 30,
                  cursor: 'pointer',
                  fontSize: 14, lineHeight: 1,
                  color: 'var(--color-meta)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)';
                  e.currentTarget.style.color = 'var(--color-primary)';
                  e.currentTarget.style.background = 'color-mix(in srgb, var(--color-primary) 6%, transparent)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.color = 'var(--color-meta)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                ✏️
              </button>
            )}
          </div>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-body)', marginTop: '6px' }}>
            {proj.status} · {projectType} · {proj.location || 'No location set'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {can('canSave') && (
            <button className="btn-primary" onClick={onSaveVersion}>
              💾 Save Version
            </button>
          )}
          <button className="btn-secondary" onClick={() => setActiveModule('module1')}>
            Edit Model →
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 'var(--sp-2)',
        marginBottom: 'var(--sp-3)',
      }}>
        {[
          { label: 'Land Value',  value: formatCurrency(totalLandValue, currency), color: 'var(--color-green-dark)' },
          { label: 'Total GFA',   value: `${formatNumber(totalProjectGFA)} sqm`,   color: 'var(--color-accent-warm)' },
          { label: 'Total CapEx', value: formatCurrency(totalCapex, currency),      color: 'var(--color-navy)' },
          { label: 'Versions',    value: String(versions.length),                  color: 'var(--color-grey-mid)' },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-card__accent" style={{ background: kpi.color }} />
            <div className="kpi-card__body">
              <div className="kpi-card__label">{kpi.label}</div>
              <div className="kpi-card__value">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick links to module tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--sp-1)', marginBottom: 'var(--sp-3)' }}>
        {quickLinks.map(ql => (
          <div
            key={ql.tab}
            className="module-card"
            style={{ padding: 'var(--sp-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}
            onClick={() => { setActiveModule('module1'); setActiveTab(ql.tab); }}
          >
            <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{ql.icon}</span>
            <div>
              <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--color-heading)', fontSize: 'var(--font-body)' }}>
                {ql.label}
              </div>
              <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>{ql.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Version history */}
      <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 'var(--sp-2)',
        }}>
          <h3 style={{
            fontSize: '11px', fontWeight: 'var(--fw-bold)',
            color: 'var(--color-heading)', margin: 0,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Version History
          </h3>
          {can('canSave') && (
            <button className="btn-primary" style={{ fontSize: '12px', padding: '5px 12px' }} onClick={onSaveVersion}>
              + Save Version
            </button>
          )}
        </div>

        {versions.length === 0 ? (
          <div style={{ color: 'var(--color-muted)', fontSize: 'var(--font-meta)', padding: 'var(--sp-2) 0' }}>
            No saved versions yet. Save a version to track changes.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[...versions].reverse().map(([vid, ver]) => {
              const isActive = vid === activeVersionId;
              return (
                <div
                  key={vid}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                    border: isActive
                      ? '1px solid color-mix(in srgb, var(--color-success) 40%, transparent)'
                      : '1px solid var(--color-border)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--color-success) 6%, transparent)'
                      : 'transparent',
                  }}
                >
                  <div>
                    <div style={{
                      fontWeight: 'var(--fw-semibold)', color: 'var(--color-heading)',
                      fontSize: 'var(--font-body)', marginBottom: '2px',
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                      {ver.name}
                      {isActive && (
                        <span style={{
                          fontSize: '9px', fontWeight: 700, padding: '1px 7px',
                          borderRadius: '20px',
                          background: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                          color: 'var(--color-success)',
                        }}>LOADED</span>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-muted)' }}>
                      {new Date(ver.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {can('canManageVersions') && !isActive && (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: '12px', padding: '5px 12px' }}
                      onClick={() => onLoadVersion(activeProjectId, vid)}
                    >
                      Load
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
