'use client';

/**
 * Module2RevenueOutput.tsx (M2 Pass 7b: phase-wise + vintage matrix)
 *
 * Per [[feedback_ui_universal_defaults]]:
 *  - Rule 3: phase-then-asset organisation
 *  - Rule 4: every phase + asset collapsible with localStorage memory
 *  - Rule 5: cohort vintage matrix mandatory for cash + recognition
 *  - Rule 1: every navy header uses white text (uses universal tokens)
 *  - Rule 2: project-setup formatting via formatAccounting (no hardcode)
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import type { SellAssetResult } from '@/src/core/calculations/revenue';
import { computeProjectTimeline } from '@/src/core/calculations';
import { formatAccounting } from '@/src/core/formatters';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_GRAND_TOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';
import VintageMatrix from './_shared/VintageMatrix';

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) < 0.5) return '-';
  return formatAccounting(v, 'full', 0);
}

interface Row { label: string; values: number[]; isTotal?: boolean }

function PeriodTable({ title, caption, yearLabels, rows, currency }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string;
}): React.JSX.Element {
  const nonLabelPct = nonLabelColumnPct(1 + yearLabels.length);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : ROW_DATA;
              const total = r.values.reduce((s, v) => s + v, 0);
              return (
                <tr key={r.label + idx}>
                  <td style={tokens.name}>{r.label}</td>
                  <td style={tokens.numTotal}>{fmt(total)}</td>
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{fmt(v)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Module2RevenueOutput(): React.JSX.Element {
  const { project, phases, assets, subUnits } = useModule1Store(
    useShallow((s) => ({ project: s.project, phases: s.phases, assets: s.assets, subUnits: s.subUnits })),
  );

  const snap = useMemo(
    () => computeAllSellResults({ project, phases, assets, subUnits }),
    [project, phases, assets, subUnits],
  );
  const currency = project.currency || '';
  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();

  const sellAssets = assets.filter((a) => a.visible !== false && a.isCompanion !== true && a.strategy === 'Sell');

  if (sellAssets.length === 0) {
    return (
      <div data-testid="m2-revenue-output" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Revenue (Output)</h1>
        <div style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-small)',
        }}>
          No Sell-strategy assets configured. Add Sell assets in Module 1 Tab 2, then enter revenue inputs in Module 2 Tab 1.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="m2-revenue-output" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Revenue (Output)</h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Per-phase, per-asset revenue streams. Each phase collapses; each asset within collapses. Vintage matrices show cohort sold in row N collected / recognised in column M (diagonal shaded).
        </p>
      </div>

      {phases.map((p) => {
        const phaseAssets = sellAssets.filter((a) => a.phaseId === p.id);
        if (phaseAssets.length === 0) return null;
        const handoverYearIdx = Math.max(0, Math.min(snap.axisLength - 1,
          (p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear)
            + (p.constructionPeriods ?? 0) - 1 - projectStartYear));

        return (
          <PhaseSection
            key={p.id}
            phaseId={p.id}
            title={p.name}
            meta={`${p.status ?? 'planning'} · handover ${snap.yearLabels[handoverYearIdx] ?? '?'}`}
            countLabel={`${phaseAssets.length} Sell asset${phaseAssets.length === 1 ? '' : 's'}`}
            storageKey={`m2-rev-phase-collapsed-${p.id}`}
          >
            {phaseAssets.map((a) => {
              const r = snap.bySellAsset.get(a.id);
              if (!r) return null;
              return (
                <AssetSection
                  key={a.id}
                  assetId={a.id}
                  title={a.name}
                  meta={a.type ? `${a.type}` : undefined}
                  storageKey={`m2-rev-asset-collapsed-${a.id}`}
                >
                  <PeriodTable
                    title="Pre-Sales Revenue (sales value year-on-year)"
                    caption="Pre-sales velocity × sub-unit area × indexed rate, per period."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Pre-Sales Revenue', values: r.presalesRevenuePerPeriod },
                      { label: 'Post-Sales Revenue', values: r.postSalesRevenuePerPeriod },
                      { label: 'Recognition (P&L)', values: r.recognitionPerPeriod },
                      { label: 'Cash Collected', values: r.cashCollectedPerPeriod },
                    ]}
                    currency={currency}
                  />
                  <VintageMatrix
                    title="Cash Vintage Matrix (cohort sold ↓ × cash collected →)"
                    caption="Cohort sold in row N catches up to its cumulative profile at year N, then pays per profile in later years. Diagonal shaded."
                    yearLabels={snap.yearLabels}
                    matrix={r.cashVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
                  />
                  <VintageMatrix
                    title="Recognition Vintage Matrix (cohort sold ↓ × revenue recognised →)"
                    caption="Point-in-Time lumps cohort at handover (or sale year). Over-Time uses the configured profile."
                    yearLabels={snap.yearLabels}
                    matrix={r.recognitionVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
                  />
                </AssetSection>
              );
            })}
          </PhaseSection>
        );
      })}

      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="all phases combined"
        storageKey="m2-rev-phase-collapsed-project"
      >
        <PeriodTable
          title="Project-wide Streams"
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Project Pre-Sales Revenue', values: snap.projectTotals.presalesRevenuePerPeriod, isTotal: true },
            { label: 'Project Post-Sales Revenue', values: snap.projectTotals.postSalesRevenuePerPeriod, isTotal: true },
            { label: 'Project Recognition (P&L)', values: snap.projectTotals.recognitionPerPeriod, isTotal: true },
            { label: 'Project Cash Collected', values: snap.projectTotals.cashCollectedPerPeriod, isTotal: true },
          ]}
          currency={currency}
        />
        <VintageMatrix
          title="Project Cash Vintage Matrix"
          yearLabels={snap.yearLabels}
          matrix={snap.projectTotals.cashVintageMatrix}
          currency={currency}
        />
        <VintageMatrix
          title="Project Recognition Vintage Matrix"
          yearLabels={snap.yearLabels}
          matrix={snap.projectTotals.recognitionVintageMatrix}
          currency={currency}
        />
      </PhaseSection>
    </div>
  );
}

// Type guard helper for stripping cohort-only rows
export type { SellAssetResult };
