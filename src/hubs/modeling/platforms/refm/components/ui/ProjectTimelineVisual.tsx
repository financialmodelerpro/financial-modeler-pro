'use client';

/**
 * ProjectTimelineVisual, M1.11/C3.
 *
 * Renders the schedule as a horizontal bar (or one bar per phase when
 * the project is multi-phase) with semantic dates labelled at every
 * transition point: Project Start, Operations Start, Construction End,
 * Project End. When overlap > 0 a gradient strip visualises the window
 * where construction and operations run concurrently.
 *
 * Replaces the M1.9 single-bar block that only labelled Start and End.
 *
 * Pure visual component. Reads project schedule and phase array from
 * the Module 1 store directly via useShallow so the visual stays in
 * sync as users edit per-phase windows in the Project Structure tree
 * below it.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ModelType } from '@/src/core/types/project.types';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Phase } from '../../lib/state/module1-types';

interface ProjectTimelineVisualProps {
  projectStart: string;
  modelType: ModelType;
  fallbackConstruction: number;
  fallbackOperations: number;
  fallbackOverlap: number;
}

interface PhaseTimingDerived {
  id: string;
  name: string;
  constructionStart: number;
  constructionPeriods: number;
  operationsStart: number;
  operationsPeriods: number;
  overlapPeriods: number;
}

function advanceDate(isoDate: string, periods: number, modelType: ModelType): Date {
  const base = new Date(isoDate);
  if (Number.isNaN(base.getTime())) return new Date();
  if (modelType === 'monthly') {
    base.setMonth(base.getMonth() + periods);
  } else {
    base.setFullYear(base.getFullYear() + periods);
  }
  return base;
}

function formatShort(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(d);
}

const labelCellStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--color-muted)',
  fontWeight: 600,
  lineHeight: 1.2,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const dateValueStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-heading)',
  fontWeight: 'var(--fw-semibold)',
  lineHeight: 1.3,
};

export default function ProjectTimelineVisual({
  projectStart,
  modelType,
  fallbackConstruction,
  fallbackOperations,
  fallbackOverlap,
}: ProjectTimelineVisualProps) {
  const phases = useModule1Store(useShallow(s => s.phases));

  const periodLabel = modelType === 'monthly' ? 'months' : 'years';

  const derived: PhaseTimingDerived[] = useMemo(() => {
    if (phases.length > 0) {
      return phases.map((p: Phase) => ({
        id: p.id,
        name: p.name || p.id,
        constructionStart: p.constructionStart,
        constructionPeriods: p.constructionPeriods,
        operationsStart: p.operationsStart,
        operationsPeriods: p.operationsPeriods,
        overlapPeriods: p.overlapPeriods ?? 0,
      }));
    }
    // No phases (defensive). Use the project-level scalars as a single
    // synthesised phase so the visual still renders.
    return [{
      id: 'phase_synth',
      name: 'Phase 1',
      constructionStart: 1,
      constructionPeriods: fallbackConstruction,
      operationsStart: Math.max(1, fallbackConstruction - fallbackOverlap + 1),
      operationsPeriods: fallbackOperations,
      overlapPeriods: fallbackOverlap,
    }];
  }, [phases, fallbackConstruction, fallbackOperations, fallbackOverlap]);

  // Project anchors: earliest construction start, latest operations end.
  const phaseEnd = (p: PhaseTimingDerived): number =>
    Math.max(
      p.constructionStart + p.constructionPeriods - 1,
      p.operationsStart + p.operationsPeriods - 1,
    );

  return (
    <div>
      {derived.map((p, idx) => {
        const cStart = p.constructionStart;
        const cEnd = cStart + p.constructionPeriods - 1;
        const oStart = p.operationsStart;
        const oEnd = oStart + p.operationsPeriods - 1;
        const phaseEndPeriod = phaseEnd(p);

        // Date math: advance projectStart by (period - 1) units to land
        // on each boundary's calendar date.
        const dateAt = (period: number): string => formatShort(advanceDate(projectStart, period - 1, modelType));

        // Bar segments. We render up to 3 sections:
        //   1) construction-only (before overlap, if any),
        //   2) overlap (if overlapPeriods > 0),
        //   3) operations-only (after overlap).
        const constructionOnlyPeriods = Math.max(0, oStart - cStart);
        const overlapPeriods = Math.min(cEnd, oEnd) - oStart + 1;
        const operationsOnlyPeriods = Math.max(0, oEnd - cEnd);

        const showOverlap = p.overlapPeriods > 0 && overlapPeriods > 0;

        return (
          <div key={p.id} style={{ marginBottom: idx === derived.length - 1 ? 0 : 'var(--sp-3)' }}>
            {/* Phase label (only shown when more than 1 phase) */}
            {derived.length > 1 && (
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginBottom: 6,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-heading)' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>
                  Period {cStart} to {phaseEndPeriod} ({periodLabel})
                </div>
              </div>
            )}

            {/* Bar */}
            <div
              data-testid={`timeline-bar-${p.id}`}
              style={{ display: 'flex', gap: 2, height: 40, borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}
            >
              {constructionOnlyPeriods > 0 && (
                <div style={{
                  flex: constructionOnlyPeriods,
                  background: 'color-mix(in srgb, var(--color-primary) 75%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-on-primary-navy)', fontSize: 11, fontWeight: 700,
                }}>
                  Construction
                </div>
              )}
              {showOverlap && (
                <div
                  data-testid={`timeline-overlap-${p.id}`}
                  style={{
                    flex: overlapPeriods,
                    background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 75%, transparent), color-mix(in srgb, var(--color-success) 75%, transparent))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--color-on-primary-navy)', fontSize: 10, fontWeight: 700,
                  }}
                >
                  Overlap
                </div>
              )}
              {operationsOnlyPeriods > 0 && (
                <div style={{
                  flex: operationsOnlyPeriods,
                  background: 'color-mix(in srgb, var(--color-success) 75%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-on-primary-navy)', fontSize: 11, fontWeight: 700,
                }}>
                  Operations
                </div>
              )}
            </div>

            {/* Boundary date axis (4 columns, evenly spaced) */}
            <div
              data-testid={`timeline-axis-${p.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                marginTop: 8,
                gap: 4,
              }}
            >
              <div>
                <div style={labelCellStyle}>Project start</div>
                <div style={dateValueStyle}>{dateAt(cStart)}</div>
              </div>
              <div style={{ textAlign: showOverlap ? 'left' : 'center' }}>
                <div style={labelCellStyle}>Operations start</div>
                <div style={dateValueStyle}>{dateAt(oStart)}</div>
              </div>
              <div style={{ textAlign: showOverlap ? 'right' : 'center' }}>
                <div style={labelCellStyle}>Construction end</div>
                <div style={dateValueStyle}>{dateAt(cEnd)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={labelCellStyle}>Project end</div>
                <div style={dateValueStyle}>{dateAt(oEnd)}</div>
              </div>
            </div>

            {/* Overlap window callout (only visible when overlap > 0) */}
            {showOverlap && (
              <div
                data-testid={`timeline-overlap-callout-${p.id}`}
                style={{
                  marginTop: 6,
                  fontSize: 10,
                  color: 'var(--color-muted)',
                  fontStyle: 'italic',
                }}
              >
                Overlap window: {dateAt(oStart)} to {dateAt(cEnd)} ({p.overlapPeriods} {periodLabel})
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
