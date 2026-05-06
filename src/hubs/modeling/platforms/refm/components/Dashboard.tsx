'use client';

/**
 * Dashboard.tsx (M2.0b restored brand-styled dashboard)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand dashboard
 * that the M2.0 slim shell stripped, KPI grid + Quick Actions
 * + Module Roadmap.
 *
 * Adapted to v5: KPIs derive from the v5 Zustand store
 * (parcels[], assets[], phases[], costLines[], financingTranches[],
 * equityContributions[]) via the calc helpers in @core. The
 * legacy v3/v4 cascade outputs (Net Developable Area, FAR-driven
 * GFA, etc.) are gone, totals come from MAAD-Spec inputs directly.
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency, formatNumber } from '@/src/core/formatters';
import {
  computeLandAggregate,
  computePhaseCost,
} from '@/src/core/calculations';
import type { StorageShape } from './RealEstatePlatform';
import { MODULES, type ModuleStatus } from '../lib/modules-config';
import { useModule1Store } from '../lib/state/module1-store';

const STATUS_BADGE: Record<ModuleStatus, { label: string; bg: string; fg: string; border: string }> = {
  done: {
    label: '✓ DONE',
    bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
    fg: 'var(--color-success)',
    border: 'color-mix(in srgb, var(--color-success) 25%, transparent)',
  },
  soon: {
    label: 'SOON',
    bg: 'color-mix(in srgb, var(--color-heading) 4%, transparent)',
    fg: 'var(--color-muted)',
    border: 'var(--color-border)',
  },
  pro: {
    label: 'PRO',
    bg: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
    fg: 'var(--color-primary)',
    border: 'color-mix(in srgb, var(--color-primary) 25%, transparent)',
  },
  enterprise: {
    label: 'ENTERPRISE',
    bg: 'color-mix(in srgb, var(--color-gold-dark) 10%, transparent)',
    fg: 'var(--color-gold-dark)',
    border: 'color-mix(in srgb, var(--color-gold-dark) 25%, transparent)',
  },
};

interface DashboardProps {
  storage: StorageShape;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onSelectModule: (m: string) => void;
}

export default function Dashboard({
  storage,
  onCreateProject,
  onSelectProject,
  onSelectModule,
}: DashboardProps): React.JSX.Element {
  const { project, phases, parcels, assets, costLines, costOverrides, financingTranches, equityContributions, landAllocationMode } =
    useModule1Store(
      useShallow((s) => ({
        project: s.project,
        phases: s.phases,
        parcels: s.parcels,
        assets: s.assets,
        subUnits: s.subUnits,
        costLines: s.costLines,
        costOverrides: s.costOverrides,
        financingTranches: s.financingTranches,
        equityContributions: s.equityContributions,
        landAllocationMode: s.landAllocationMode,
      })),
    );
  const subUnits = useModule1Store((s) => s.subUnits);

  const projects = Object.entries(storage.projects);
  const totalProjects = projects.length;
  const periodLabel = project.modelType === 'monthly' ? 'mo' : 'yr';
  const currency = project.currency;

  const landAgg = computeLandAggregate(parcels);
  const totalLandArea = landAgg.totalAreaSqm;
  const totalLandValue = landAgg.totalValue;

  const totalProjectGFA = assets.reduce((s, a) => s + (a.gfaSqm || 0), 0);

  const totalCapex = phases.reduce(
    (s, p) => s + computePhaseCost(p, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode).total,
    0,
  );

  const totalDebt = financingTranches.reduce((s, t) => {
    const phase = phases.find((p) => p.id === t.phaseId);
    if (!phase) return s;
    const phaseCapex = computePhaseCost(phase, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode).total;
    return s + phaseCapex * (Math.max(0, Math.min(100, t.ltvPct)) / 100);
  }, 0);

  const totalEquity = equityContributions.reduce((s, e) => s + (e.amount || 0), 0);

  const constructionPeriods = phases.reduce((s, p) => Math.max(s, p.constructionStart - 1 + p.constructionPeriods), 0);
  const operationsPeriods = phases.reduce(
    (s, p) => Math.max(s, p.constructionStart - 1 + p.constructionPeriods + p.operationsPeriods - p.overlapPeriods),
    0,
  ) - constructionPeriods;

  const kpis = [
    {
      label: 'Total Land Area',
      value: totalLandArea > 0 ? `${formatNumber(totalLandArea)} sqm` : 'n/a',
      sub: 'Across all parcels',
      color: 'var(--color-navy)',
    },
    {
      label: 'Land Value',
      value: totalLandValue > 0 ? formatCurrency(totalLandValue, currency) : 'n/a',
      sub: 'Total land acquisition cost',
      color: 'var(--color-green-dark)',
    },
    {
      label: 'Total GFA',
      value: totalProjectGFA > 0 ? `${formatNumber(totalProjectGFA)} sqm` : 'n/a',
      sub: 'Gross Floor Area across assets',
      color: 'var(--color-accent-warm)',
    },
    {
      label: 'Total CapEx',
      value: totalCapex > 0 ? formatCurrency(totalCapex, currency) : 'n/a',
      sub: `${formatCurrency(totalDebt, currency)} debt, ${formatCurrency(totalEquity, currency)} equity`,
      color: 'var(--color-navy)',
    },
    {
      label: 'Construction',
      value: `${constructionPeriods} ${periodLabel}`,
      sub: `${Math.max(0, operationsPeriods)} ${periodLabel} operations`,
      color: 'var(--color-navy-mid)',
    },
    {
      label: 'Saved Projects',
      value: String(totalProjects),
      sub: totalProjects === 1 ? '1 project in portfolio' : `${totalProjects} projects in portfolio`,
      color: 'var(--color-green-dark)',
    },
  ];

  return (
    <div className="module-view" data-testid="dashboard">
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1
          style={{
            fontSize: 'var(--font-h1)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-heading)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          Dashboard
        </h1>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-body)', marginTop: '6px' }}>
          Portfolio overview, {project.name || 'No active project'} · {project.location || 'No location'}
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--sp-2)' }}>
        <button
          type="button"
          onClick={onCreateProject}
          className="btn-primary"
          style={{ padding: 'var(--sp-1) var(--sp-2)' }}
          data-testid="dashboard-create"
        >
          + New Project
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
        }}
        data-testid="dashboard-kpi-grid"
      >
        {kpis.map((kpi, i) => (
          <div key={i} className="kpi-card" data-testid={`dashboard-kpi-${i}`}>
            <div className="kpi-card__accent" style={{ background: kpi.color }} />
            <div className="kpi-card__body">
              <div className="kpi-card__label">{kpi.label}</div>
              <div className="kpi-card__value">{kpi.value}</div>
              <div className="kpi-card__sub">{kpi.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {projects.length > 0 && (
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <h3
            style={{
              fontSize: '11px',
              fontWeight: 'var(--fw-semibold)',
              color: 'var(--color-heading)',
              marginBottom: 'var(--sp-2)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Recent Projects
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--sp-2)',
            }}
          >
            {projects.slice(0, 6).map(([id, p]) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelectProject(id)}
                data-testid={`dashboard-project-${id}`}
                className="module-card"
                style={{
                  textAlign: 'left',
                  padding: 'var(--sp-2)',
                  border: 'none',
                  cursor: 'pointer',
                  background: 'var(--color-grey-white)',
                }}
              >
                <strong style={{ color: 'var(--color-heading)' }}>{p.name}</strong>
                <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 2 }}>
                  {p.location || 'No location'} · {p.status}
                </div>
                <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-muted)', marginTop: 6 }}>
                  Updated {new Date(p.lastModified).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <div
          className="module-card"
          style={{ padding: 'var(--sp-3)', cursor: 'pointer' }}
          onClick={() => onSelectModule('module1')}
          data-testid="dashboard-card-module1"
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🧱</div>
          <h3
            style={{
              fontSize: 'var(--font-section)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)',
              margin: '0 0 6px',
            }}
          >
            Module 1, Project Setup
          </h3>
          <p style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', margin: 0 }}>
            Project &amp; phases, assets &amp; sub-units, costs, financing structure.
          </p>
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <span
              style={{
                background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                color: 'var(--color-success)',
                border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
                borderRadius: '20px',
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 8px',
              }}
            >
              ✓ COMPLETE
            </span>
          </div>
        </div>

        <div
          className="module-card"
          style={{ padding: 'var(--sp-3)', cursor: 'pointer' }}
          onClick={() => onSelectModule('projects')}
          data-testid="dashboard-card-projects"
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏗️</div>
          <h3
            style={{
              fontSize: 'var(--font-section)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)',
              margin: '0 0 6px',
            }}
          >
            Projects
          </h3>
          <p style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', margin: 0 }}>
            Manage your portfolio, create, save, and load project versions.
          </p>
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <span
              style={{
                background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                color: 'var(--color-primary)',
                border: '1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)',
                borderRadius: '20px',
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 8px',
              }}
            >
              {totalProjects} PROJECT{totalProjects !== 1 ? 'S' : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="module-card" style={{ padding: 'var(--sp-3)' }} data-testid="dashboard-roadmap">
        <h3
          style={{
            fontSize: '11px',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--color-heading)',
            marginBottom: 'var(--sp-2)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Module Roadmap
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {MODULES.map((m, i) => {
            const isLast = i === MODULES.length - 1;
            const badge = STATUS_BADGE[m.status];
            return (
              <div
                key={m.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 0',
                  borderBottom: isLast ? 'none' : '1px solid var(--color-border-light)',
                }}
                data-testid={`dashboard-roadmap-${m.key}`}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '20px',
                    flexShrink: 0,
                    background: badge.bg,
                    color: badge.fg,
                    border: `1px solid ${badge.border}`,
                  }}
                >
                  {badge.label}
                </span>
                <span
                  style={{
                    fontSize: 'var(--font-meta)',
                    color: m.status === 'done' ? 'var(--color-body)' : 'var(--color-muted)',
                    fontWeight: m.status === 'done' ? 'var(--fw-semibold)' : 'var(--fw-normal)',
                  }}
                >
                  Module {m.num}, {m.longLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
