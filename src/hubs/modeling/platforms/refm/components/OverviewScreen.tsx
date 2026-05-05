'use client';

/**
 * OverviewScreen.tsx (v5 schema, M2.0 stub)
 *
 * Project overview page. M2.0 stub shows project meta + phase
 * summary; richer KPIs (revenue, returns, statements) land when
 * Modules 2-5 are built on top of v5.
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StorageShape } from './RealEstatePlatform';
import { useModule1Store } from '../lib/state/module1-store';
import { computePhaseCost, computeLandAggregate } from '@/src/core/calculations';

interface OverviewScreenProps {
  storage: StorageShape;
}

export default function OverviewScreen({ storage }: OverviewScreenProps): React.JSX.Element {
  const { project, phases, assets, parcels, subUnits, costLines } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      parcels: s.parcels,
      subUnits: s.subUnits,
      costLines: s.costLines,
    })),
  );
  const land = computeLandAggregate(parcels);
  const totalCapex = phases.reduce(
    (sum, phase) => sum + computePhaseCost(phase, costLines, parcels, assets, subUnits).total,
    0,
  );
  const activeId = storage.activeProjectId;

  return (
    <div data-testid="overview-screen">
      <h2 style={{ marginTop: 0 }}>Overview {activeId ? `· ${project.name}` : ''}</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <Card label="Project" value={project.name} />
        <Card label="Location" value={project.location || '-'} />
        <Card label="Currency" value={project.currency} />
        <Card label="Granularity" value={project.modelType} />
        <Card label="Phases" value={String(phases.length)} />
        <Card label="Assets" value={String(assets.length)} />
        <Card label="Land Area" value={`${land.totalAreaSqm.toLocaleString()} sqm`} />
        <Card label="Total CapEx" value={`${totalCapex.toLocaleString()} ${project.currency}`} />
      </div>
      <h3>Phases</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-grey-pale)' }}>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Name</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Construction</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Operations</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Overlap</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Assets</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p.id} data-testid={`overview-phase-${p.id}`} style={{ borderTop: '1px solid var(--color-border)' }}>
              <td style={{ padding: 'var(--sp-1)' }}>{p.name}</td>
              <td style={{ padding: 'var(--sp-1)' }}>{p.constructionPeriods}</td>
              <td style={{ padding: 'var(--sp-1)' }}>{p.operationsPeriods}</td>
              <td style={{ padding: 'var(--sp-1)' }}>{p.overlapPeriods}</td>
              <td style={{ padding: 'var(--sp-1)' }}>{assets.filter((a) => a.phaseId === p.id).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--sp-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        background: 'var(--color-surface)',
      }}
    >
      <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 'var(--font-h3)', fontWeight: 'var(--fw-bold)' }}>{value}</div>
    </div>
  );
}
