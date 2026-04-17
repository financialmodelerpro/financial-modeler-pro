'use client';

import React from 'react';
import type { ProjectType, ModelType } from '@/src/types/project.types';
import { formatCurrency, formatNumber } from '@/src/core/core-formatters';
import type { StorageShape } from './RealEstatePlatform';

interface DashboardProps {
  projectName: string;
  projectType: ProjectType;
  currency: string;
  totalLandArea: number;
  totalLandValue: number;
  totalProjectGFA: number;
  totalCapex: number;
  totalDebt: number;
  totalEquity: number;
  constructionPeriods: number;
  operationsPeriods: number;
  modelType: ModelType;
  storageData: StorageShape;
  setActiveModule: (m: string) => void;
}

export default function Dashboard({
  projectName, projectType, currency,
  totalLandArea, totalLandValue, totalProjectGFA,
  totalCapex, totalDebt, totalEquity,
  constructionPeriods, operationsPeriods, modelType,
  storageData, setActiveModule,
}: DashboardProps) {
  const projects = Object.entries(storageData.projects);
  const totalProjects = projects.length;
  const periodLabel = modelType === 'monthly' ? 'mo' : 'yr';

  const kpis = [
    {
      label: 'Total Land Area',
      value: totalLandArea > 0 ? `${formatNumber(totalLandArea)} sqm` : '-',
      sub: 'Net Developable Area',
      color: 'var(--color-navy)',
    },
    {
      label: 'Land Value',
      value: totalLandValue > 0 ? formatCurrency(totalLandValue, currency) : '-',
      sub: 'Total land acquisition cost',
      color: 'var(--color-green-dark)',
    },
    {
      label: 'Total GFA',
      value: totalProjectGFA > 0 ? `${formatNumber(totalProjectGFA)} sqm` : '-',
      sub: 'Gross Floor Area',
      color: '#7C2D12',
    },
    {
      label: 'Total CapEx',
      value: totalCapex > 0 ? formatCurrency(totalCapex, currency) : '-',
      sub: `${formatCurrency(totalDebt, currency)} debt / ${formatCurrency(totalEquity, currency)} equity`,
      color: 'var(--color-navy)',
    },
    {
      label: 'Construction',
      value: `${constructionPeriods} ${periodLabel}`,
      sub: `${operationsPeriods} ${periodLabel} operations`,
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
    <div className="module-view">
      {/* Header */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{
          fontSize: 'var(--font-h1)', fontWeight: 'var(--fw-bold)',
          color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.02em',
        }}>
          Dashboard
        </h1>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-body)', marginTop: '6px' }}>
          Portfolio overview - {projectName} · {projectType}
        </p>
      </div>

      {/* KPI Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 'var(--sp-2)',
        marginBottom: 'var(--sp-3)',
      }}>
        {kpis.map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-card__accent" style={{ background: kpi.color }} />
            <div className="kpi-card__body">
              <div className="kpi-card__label">{kpi.label}</div>
              <div className="kpi-card__value">{kpi.value}</div>
              <div className="kpi-card__sub">{kpi.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <div className="module-card" style={{ padding: 'var(--sp-3)', cursor: 'pointer' }}
          onClick={() => setActiveModule('module1')}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🧱</div>
          <h3 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 6px' }}>
            Module 1 - Project Setup
          </h3>
          <p style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', margin: 0 }}>
            Timeline, land & area, development costs, financing structure.
          </p>
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <span style={{
              background: 'rgba(22,101,52,0.12)', color: 'var(--color-success)',
              border: '1px solid rgba(22,101,52,0.25)', borderRadius: '20px',
              fontSize: '10px', fontWeight: 700, padding: '2px 8px',
            }}>✓ COMPLETE</span>
          </div>
        </div>

        <div className="module-card" style={{ padding: 'var(--sp-3)', cursor: 'pointer' }}
          onClick={() => setActiveModule('projects')}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏗️</div>
          <h3 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 6px' }}>
            Projects
          </h3>
          <p style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', margin: 0 }}>
            Manage your portfolio - create, save, and load project versions.
          </p>
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <span style={{
              background: 'rgba(30,58,138,0.1)', color: 'var(--color-primary)',
              border: '1px solid rgba(30,58,138,0.2)', borderRadius: '20px',
              fontSize: '10px', fontWeight: 700, padding: '2px 8px',
            }}>{totalProjects} PROJECT{totalProjects !== 1 ? 'S' : ''}</span>
          </div>
        </div>
      </div>

      {/* Module status grid */}
      <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
        <h3 style={{
          fontSize: '11px', fontWeight: 'var(--fw-semibold)',
          color: 'var(--color-heading)', marginBottom: 'var(--sp-2)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Module Roadmap
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[
            { num: 1, label: 'Project Setup & Financial Structure', done: true },
            { num: 2, label: 'Revenue & Sales Projections',         done: false },
            { num: 3, label: 'Operating Expenses & Cash Flow',      done: false },
            { num: 4, label: 'Returns & Valuation Analysis',        done: false },
            { num: 5, label: 'Financial Statements',                done: false },
            { num: 6, label: 'Reports & Visualizations',            done: false },
          ].map(m => (
            <div key={m.num} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 0',
              borderBottom: m.num < 6 ? '1px solid var(--color-border-light)' : 'none',
            }}>
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 7px',
                borderRadius: '20px', flexShrink: 0,
                background: m.done ? 'rgba(22,101,52,0.12)' : 'rgba(0,0,0,0.04)',
                color: m.done ? 'var(--color-success)' : 'var(--color-muted)',
                border: `1px solid ${m.done ? 'rgba(22,101,52,0.25)' : 'var(--color-border)'}`,
              }}>
                {m.done ? '✓ DONE' : 'SOON'}
              </span>
              <span style={{
                fontSize: 'var(--font-meta)',
                color: m.done ? 'var(--color-body)' : 'var(--color-muted)',
                fontWeight: m.done ? 'var(--fw-semibold)' : 'var(--fw-normal)',
              }}>
                Module {m.num} - {m.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
