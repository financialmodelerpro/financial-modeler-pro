'use client';

/**
 * OverviewScreen.tsx (M2.0b restored brand-styled overview)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand overview
 * surface, project header + KPI tiles + quick-link tab cards +
 * version history.
 *
 * Adapted to v5: KPIs derive from the v5 Zustand store via the
 * calc helpers in @core. Quick links route to the new 4-tab
 * structure (project-phases / assets / costs / financing). Version
 * load + save handled via props from the v5-aware shell.
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PermissionMap } from '@/src/core/types/settings.types';
import { formatCurrency, formatNumber } from '@/src/core/formatters';
import { computeLandAggregate, computePhaseCost } from '@/src/core/calculations';
import type { StorageShape } from './RealEstatePlatform';
import { useModule1Store } from '../lib/state/module1-store';

interface OverviewScreenProps {
  storage: StorageShape;
  activeProjectId: string | null;
  activeVersionId: string | null;
  onLoadVersion: (pid: string, vid: string) => void;
  onSaveVersion: () => void;
  onEditProject: () => void;
  setActiveModule: (m: string) => void;
  setActiveTab: (t: string) => void;
  can: (permission: keyof PermissionMap) => boolean;
}

export default function OverviewScreen({
  storage,
  activeProjectId,
  activeVersionId,
  onLoadVersion,
  onSaveVersion,
  onEditProject,
  setActiveModule,
  setActiveTab,
  can,
}: OverviewScreenProps): React.JSX.Element {
  const { project, phases, parcels, assets, costLines } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      parcels: s.parcels,
      assets: s.assets,
      subUnits: s.subUnits,
      costLines: s.costLines,
    })),
  );
  const subUnits = useModule1Store((s) => s.subUnits);

  const proj = activeProjectId ? storage.projects[activeProjectId] : null;

  if (!proj || !activeProjectId) {
    const reason = activeProjectId
      ? 'The selected project is no longer available. Pick a different project to continue.'
      : 'No project selected. Go to Projects and select a project first.';
    return (
      <div className="module-view" data-testid="overview-empty">
        <div className="state-empty">📋 {reason}</div>
        <div style={{ marginTop: 'var(--sp-2)', textAlign: 'center' }}>
          <button className="btn-primary" onClick={() => setActiveModule('projects')}>
            Go to Projects
          </button>
        </div>
      </div>
    );
  }

  const land = computeLandAggregate(parcels);
  const totalLandValue = land.totalValue;
  const totalProjectGFA = assets.reduce((s, a) => s + (a.gfaSqm || 0), 0);
  const totalCapex = phases.reduce(
    (s, p) => s + computePhaseCost(p, costLines, parcels, assets, subUnits).total,
    0,
  );

  const versions = Object.entries(proj.versions || {});
  const currency = project.currency;

  const quickLinks = [
    { icon: '📅', label: '1. Project & Phases', tab: 'project-phases', desc: 'Project meta and per-phase timing' },
    { icon: '🏗️', label: '2. Assets & Sub-units', tab: 'assets', desc: 'Land parcels, asset cards, sub-unit editor' },
    { icon: '💸', label: '3. Costs', tab: 'costs', desc: '9 cost lines per phase, per-asset overrides' },
    { icon: '🏦', label: '4. Financing', tab: 'financing', desc: 'Tranches, drawdown, repayment, equity' },
  ];

  return (
    <div className="module-view" data-testid="overview-screen">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1
              style={{
                fontSize: 'var(--font-h1)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-heading)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
              data-testid="overview-project-name"
            >
              {proj.name}
            </h1>
            {can('canEditProject') && (
              <button
                type="button"
                onClick={onEditProject}
                title="Edit project name and location"
                aria-label="Edit project name and location"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  width: 30,
                  height: 30,
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  color: 'var(--color-meta)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✏️
              </button>
            )}
          </div>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-body)', marginTop: '6px' }}>
            {proj.status} · {project.modelType} · {proj.location || 'No location set'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {can('canSave') && (
            <button className="btn-primary" onClick={onSaveVersion} data-testid="overview-save-version">
              Save Version
            </button>
          )}
          <button className="btn-secondary" onClick={() => setActiveModule('module1')} data-testid="overview-edit-model">
            Edit Model
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
        }}
        data-testid="overview-kpi-grid"
      >
        {[
          { label: 'Land Value', value: formatCurrency(totalLandValue, currency), color: 'var(--color-green-dark)' },
          { label: 'Total GFA', value: `${formatNumber(totalProjectGFA)} sqm`, color: 'var(--color-accent-warm)' },
          { label: 'Total CapEx', value: formatCurrency(totalCapex, currency), color: 'var(--color-navy)' },
          { label: 'Versions', value: String(versions.length), color: 'var(--color-grey-mid)' },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card" data-testid={`overview-kpi-${i}`}>
            <div className="kpi-card__accent" style={{ background: kpi.color }} />
            <div className="kpi-card__body">
              <div className="kpi-card__label">{kpi.label}</div>
              <div className="kpi-card__value">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 'var(--sp-1)',
          marginBottom: 'var(--sp-3)',
        }}
        data-testid="overview-quick-links"
      >
        {quickLinks.map((ql) => (
          <div
            key={ql.tab}
            className="module-card"
            style={{
              padding: 'var(--sp-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
            onClick={() => {
              setActiveModule('module1');
              setActiveTab(ql.tab);
            }}
            data-testid={`overview-quicklink-${ql.tab}`}
          >
            <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{ql.icon}</span>
            <div>
              <div
                style={{
                  fontWeight: 'var(--fw-semibold)',
                  color: 'var(--color-heading)',
                  fontSize: 'var(--font-body)',
                }}
              >
                {ql.label}
              </div>
              <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>{ql.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        className="module-card"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}
        data-testid="overview-phases"
      >
        <h3
          style={{
            fontSize: '11px',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-heading)',
            margin: '0 0 var(--sp-2)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Phase Summary
        </h3>
        {phases.length === 0 ? (
          <div style={{ color: 'var(--color-muted)', fontSize: 'var(--font-meta)', padding: 'var(--sp-2) 0' }}>
            No phases defined. Open Module 1 and add at least one phase.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-grey-pale)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--sp-1)', fontSize: 'var(--font-meta)' }}>Phase</th>
                <th style={{ textAlign: 'left', padding: 'var(--sp-1)', fontSize: 'var(--font-meta)' }}>Construction</th>
                <th style={{ textAlign: 'left', padding: 'var(--sp-1)', fontSize: 'var(--font-meta)' }}>Operations</th>
                <th style={{ textAlign: 'left', padding: 'var(--sp-1)', fontSize: 'var(--font-meta)' }}>Overlap</th>
                <th style={{ textAlign: 'left', padding: 'var(--sp-1)', fontSize: 'var(--font-meta)' }}>Assets</th>
                <th style={{ textAlign: 'right', padding: 'var(--sp-1)', fontSize: 'var(--font-meta)' }}>CapEx</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p) => {
                const phaseCapex = computePhaseCost(p, costLines, parcels, assets, subUnits).total;
                return (
                  <tr
                    key={p.id}
                    data-testid={`overview-phase-${p.id}`}
                    style={{ borderTop: '1px solid var(--color-border-light)' }}
                  >
                    <td style={{ padding: 'var(--sp-1)' }}>{p.name}</td>
                    <td style={{ padding: 'var(--sp-1)' }}>{p.constructionPeriods}</td>
                    <td style={{ padding: 'var(--sp-1)' }}>{p.operationsPeriods}</td>
                    <td style={{ padding: 'var(--sp-1)' }}>{p.overlapPeriods}</td>
                    <td style={{ padding: 'var(--sp-1)' }}>{assets.filter((a) => a.phaseId === p.id).length}</td>
                    <td style={{ padding: 'var(--sp-1)', textAlign: 'right' }}>
                      {formatCurrency(phaseCapex, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="module-card" style={{ padding: 'var(--sp-3)' }} data-testid="overview-versions">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <h3
            style={{
              fontSize: '11px',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)',
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Version History
          </h3>
          {can('canSave') && (
            <button
              className="btn-primary"
              style={{ fontSize: '12px', padding: '5px 12px' }}
              onClick={onSaveVersion}
            >
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
                  data-testid={`overview-version-${vid}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: isActive
                      ? '1px solid color-mix(in srgb, var(--color-success) 40%, transparent)'
                      : '1px solid var(--color-border)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--color-success) 6%, transparent)'
                      : 'transparent',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 'var(--fw-semibold)',
                        color: 'var(--color-heading)',
                        fontSize: 'var(--font-body)',
                        marginBottom: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {ver.name}
                      {isActive && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 7px',
                            borderRadius: '20px',
                            background: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                            color: 'var(--color-success)',
                          }}
                        >
                          LOADED
                        </span>
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
