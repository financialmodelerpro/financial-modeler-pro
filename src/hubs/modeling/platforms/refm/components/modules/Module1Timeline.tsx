'use client';

/**
 * Module1Timeline — REFM "Schedule" tab (renamed in M1.9).
 *
 * Pre-M1.9 this tab also hosted Project Identity (project name, type,
 * country, currency, model granularity, start date). All four duplicated
 * data the wizard captures upfront and the Hierarchy tab edits per
 * sub-project, which led to "which tab is canonical?" confusion (the
 * thing Ahmad flagged on 2026-05-04).
 *
 * M1.9 strips Project Identity out: project name + type live in
 * Hierarchy (Sub-Project editor); country + currency live in the wizard
 * (now driving each other). What's left here is the schedule itself —
 * model granularity, start date, construction / operations / overlap
 * periods, plus the visual bar.
 *
 * The props interface keeps the (now-unused) identity setters so the
 * RealEstatePlatform binding doesn't have to change in this commit;
 * future cleanup can prune them once a downstream commit absorbs
 * Hierarchy's per-asset editor + the merged Project & Schedule surface
 * lands. Snapshot diffs untouched (no calc input changes).
 */

import React from 'react';
import type { ModelType, ProjectType } from '@/src/core/types/project.types';

interface Module1TimelineProps {
  // Identity props kept on the interface for backward compat with the
  // RealEstatePlatform binding; their setters are no longer wired to UI.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  projectName: string; setProjectName: (v: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  projectType: ProjectType; setProjectType: (v: ProjectType) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  country: string; setCountry: (v: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  currency: string; setCurrency: (v: string) => void;
  modelType: ModelType; setModelType: (v: ModelType) => void;
  projectStart: string; setProjectStart: (v: string) => void;
  constructionPeriods: number; setConstructionPeriods: (v: number) => void;
  operationsPeriods: number; setOperationsPeriods: (v: number) => void;
  overlapPeriods: number; setOverlapPeriods: (v: number) => void;
  getProjectEndDate: () => string;
  readOnly: boolean;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showAiButtons?: boolean;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  fontWeight: 'var(--fw-semibold)',
};

const calcOutputStyle: React.CSSProperties = {
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  fontWeight: 'var(--fw-semibold)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)',
  marginBottom: '5px',
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function Module1Timeline({
  modelType, setModelType,
  projectStart, setProjectStart,
  constructionPeriods, setConstructionPeriods,
  operationsPeriods, setOperationsPeriods,
  overlapPeriods, setOverlapPeriods,
  getProjectEndDate,
  readOnly,
}: Module1TimelineProps) {
  const periodLabel = modelType === 'monthly' ? 'months' : 'years';
  const effectivePeriods = constructionPeriods + operationsPeriods - overlapPeriods;
  const endDate = getProjectEndDate();

  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--sp-2)',
    marginBottom: 'var(--sp-2)',
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 4px' }}>
          Project Schedule
        </h2>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', margin: 0 }}>
          Set the model granularity, start date, and per-phase construction
          / operations window. Project name, type, country, and currency
          live in the create wizard and the Hierarchy tab.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--sp-3)' }}>

        <div className="module-card" style={{ padding: 'var(--sp-3)' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            Model Structure
          </h3>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Model Granularity</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['annual', 'monthly'] as ModelType[]).map(mt => (
                <button
                  key={mt}
                  onClick={() => !readOnly && setModelType(mt)}
                  disabled={readOnly}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)',
                    border: modelType === mt ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: modelType === mt ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'var(--color-surface)',
                    cursor: readOnly ? 'not-allowed' : 'pointer',
                    fontWeight: modelType === mt ? 'var(--fw-bold)' : 'var(--fw-normal)',
                    color: modelType === mt ? 'var(--color-primary)' : 'var(--color-body)',
                    fontSize: 'var(--font-body)', textTransform: 'capitalize',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {mt === 'annual' ? '📅 Annual' : '📆 Monthly'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Project Start Date</label>
            <input
              style={inputStyle}
              type="date"
              value={projectStart}
              onChange={e => setProjectStart(e.target.value)}
              disabled={readOnly}
            />
          </div>

          <div style={rowStyle}>
            <div>
              <label style={labelStyle}>Construction ({periodLabel})</label>
              <input
                style={inputStyle}
                type="number"
                min={1}
                max={modelType === 'monthly' ? 120 : 20}
                value={constructionPeriods}
                onChange={e => setConstructionPeriods(Number(e.target.value))}
                disabled={readOnly}
              />
            </div>
            <div>
              <label style={labelStyle}>Operations ({periodLabel})</label>
              <input
                style={inputStyle}
                type="number"
                min={1}
                max={modelType === 'monthly' ? 360 : 30}
                value={operationsPeriods}
                onChange={e => setOperationsPeriods(Number(e.target.value))}
                disabled={readOnly}
              />
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <label style={labelStyle}>Overlap ({periodLabel})</label>
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={Math.min(constructionPeriods, operationsPeriods)}
              value={overlapPeriods}
              onChange={e => setOverlapPeriods(Number(e.target.value))}
              disabled={readOnly}
            />
            <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px' }}>
              Overlap of construction & operations phases
            </div>
          </div>

          {/* Timeline summary — calculated outputs (FAST formula black-on-grey) */}
          <div style={{
            background: calcOutputStyle.background,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px',
            marginTop: 'var(--sp-1)',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Timeline Summary
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { label: 'Start', value: projectStart },
                { label: 'End',   value: endDate },
                { label: 'Total Periods', value: `${effectivePeriods} ${periodLabel}` },
                { label: 'Type', value: modelType === 'annual' ? 'Annual model' : 'Monthly model' },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: '10px', color: 'var(--color-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{item.label}</div>
                  <div style={{ fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-heading)' }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline visual */}
      <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
        <h3 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
          Project Timeline Visual
        </h3>
        <div style={{ display: 'flex', gap: '4px', height: '40px', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <div style={{
            flex: constructionPeriods,
            background: 'color-mix(in srgb, var(--color-primary) 75%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-on-primary-navy)', fontSize: '11px', fontWeight: 700,
          }}>
            Construction · {constructionPeriods} {periodLabel}
          </div>
          {overlapPeriods > 0 && (
            <div style={{
              flex: overlapPeriods,
              background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 75%, transparent), color-mix(in srgb, var(--color-success) 75%, transparent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-on-primary-navy)', fontSize: '10px', fontWeight: 700,
            }}>
              Overlap
            </div>
          )}
          <div style={{
            flex: operationsPeriods,
            background: 'color-mix(in srgb, var(--color-success) 75%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-on-primary-navy)', fontSize: '11px', fontWeight: 700,
          }}>
            Operations · {operationsPeriods} {periodLabel}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>{projectStart}</span>
          <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>{endDate}</span>
        </div>
      </div>
    </div>
  );
}
