'use client';

/**
 * M4 Pass 2 (2026-05-20): shared PeriodTable + Row helper for the
 * Module 4 surfaces (Schedules / P&L / CF / BS). Extracted to one
 * place so the four new module files stay focused on their content
 * rather than re-declaring the same table renderer four times.
 *
 * Pass 2L (2026-05-20): added collapsible groups + an optional Phase
 * column. Each row may declare a `collapseGroup` + `collapseRole`:
 *   - 'header': clickable; toggles whether members in the same group show.
 *   - 'member': hidden when the group is collapsed.
 * Rows with no collapseGroup are always shown. Phase column renders
 * row.phaseLabel between Line and Total when showPhaseColumn is true.
 */

import React, { useState } from 'react';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct, periodTableStyle, PERIOD_PHASE_PX,
} from './tableStyles';
import { ScrollableTable } from './ScrollableTable';

export interface M4Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
  totalOverride?: string;
  rowFmt?: (v: number) => string;
  /** M4 Pass 2j: prior-year column value for stock lines. */
  priorValue?: number;
  /** M4 Pass 2L (2026-05-20): collapsible group key. Header + members
   *  share the same key; toggling the header hides/shows the members. */
  collapseGroup?: string;
  /** 'header' = clickable toggle row; 'member' = hidden on collapse. */
  collapseRole?: 'header' | 'member';
  /** Whether the group starts collapsed. Only consulted on the header
   *  row's first render. Defaults to true (collapsed) so the table
   *  initially shows totals only. */
  defaultCollapsed?: boolean;
  /** M4 Pass 2L: Phase column value (shown only when showPhaseColumn). */
  phaseLabel?: string;
  /** M4 Pass 2N-Fix (2026-05-21): Excel-style trace-to-source. When
   *  set, renders a small "⤴" icon next to the label; click navigates
   *  to the named module + tab and (optionally) scrolls to a section
   *  via its DOM id. Implemented via a global custom event listened
   *  to by RealEstatePlatform. */
  trace?: {
    module: 'module1' | 'module2' | 'module3' | 'module4';
    tab: string;
    sectionId?: string;
    label?: string;
  };
}

export function M4PeriodTable({ title, caption, yearLabels, rows, currency, fmt, priorYearLabel, showPhaseColumn }: {
  title: string; caption?: string; yearLabels: number[]; rows: M4Row[]; currency: string;
  fmt: (v: number) => string;
  /** M4 Pass 2j: when set, an extra "Prior" column is rendered between
   *  Total and the first year. Use Row.priorValue to populate per row. */
  priorYearLabel?: number;
  /** M4 Pass 2L: when true, a "Phase" column appears between Line and
   *  Total. Per-row data comes from row.phaseLabel. */
  showPhaseColumn?: boolean;
}): React.JSX.Element {
  // Track which collapse groups are currently collapsed.
  // Initialise from rows' defaultCollapsed flag on first render. Per
  // Ahmad's request: totals visible by default, click to expand.
  const initialCollapsed = (): Set<string> => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.collapseRole === 'header' && r.collapseGroup) {
        if (r.defaultCollapsed !== false) s.add(r.collapseGroup);
      }
    }
    return s;
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsed);
  const toggleGroup = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (rows.length === 0) return <></>;
  const hasPrior = priorYearLabel !== undefined;
  const hasPhase = showPhaseColumn === true;
  // Excel-grid (2026-06-01): every non-label column is a fixed px width
  // so the year axis never compresses; the table scrolls horizontally
  // instead. nonLabelColCount = Total + prior + each year column (the
  // Phase column is sized separately and passed to periodTableStyle as
  // extra fixed width).
  const nonLabelColCount = 1 + (hasPrior ? 1 : 0) + yearLabels.length;
  const nonLabelPct = nonLabelColumnPct(nonLabelColCount);
  const phaseColWidth = hasPhase ? `${PERIOD_PHASE_PX}px` : undefined;

  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <ScrollableTable>
        <table style={periodTableStyle(nonLabelColCount, hasPhase ? PERIOD_PHASE_PX : 0)}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            {hasPhase && (<col style={{ width: phaseColWidth }} />)}
            <col style={{ width: nonLabelPct }} />
            {hasPrior && (<col style={{ width: nonLabelPct }} />)}
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              {hasPhase && (<th style={{ ...CELL_HEADER, textAlign: 'center', fontSize: 10 }}>Phase</th>)}
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {hasPrior && (<th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{priorYearLabel}</th>)}
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              // Hide member rows when their group is collapsed.
              if (r.collapseRole === 'member' && r.collapseGroup && collapsed.has(r.collapseGroup)) {
                return null;
              }
              const colSpan = 1 + (hasPhase ? 1 : 0) + 1 + (hasPrior ? 1 : 0) + yearLabels.length;
              const isCollapsibleHeader = r.collapseRole === 'header' && r.collapseGroup;
              const isCollapsed = isCollapsibleHeader && collapsed.has(r.collapseGroup!);
              const cellFmt = r.rowFmt ?? fmt;

              // M4 Pass 2N (2026-05-21): collapsible headers that carry
              // inline subtotal values render as a subtotal-styled row
              // (with caret + per-year cells) instead of a colSpan'd
              // banner. Mega section headers without values keep the
              // colSpan banner. The user's cleanup ask: drop the separate
              // "Total <strategy> revenue" subtotal row, surface the
              // total inline on the header itself, and default-open.
              if (r.isSection && (!isCollapsibleHeader || r.values.length === 0)) {
                return (
                  <tr key={`section-${idx}`}>
                    <td colSpan={colSpan}
                      onClick={isCollapsibleHeader ? () => toggleGroup(r.collapseGroup!) : undefined}
                      style={{
                        padding: '8px 10px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--color-navy)',
                        background: 'color-mix(in srgb, var(--color-navy) 5%, transparent)',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                        cursor: isCollapsibleHeader ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                      data-testid={isCollapsibleHeader ? `m4-collapse-toggle-${r.collapseGroup}` : undefined}
                    >
                      {isCollapsibleHeader && (
                        <span style={{ marginRight: 8, fontSize: 10, color: 'var(--color-meta)' }}>
                          {isCollapsed ? '▶' : '▼'}
                        </span>
                      )}
                      {r.label}
                    </td>
                  </tr>
                );
              }
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : (r.isSubtotal || isCollapsibleHeader) ? ROW_SUBTOTAL : ROW_DATA;
              const indent = r.indent ?? 0;
              const total = r.totalOverride ?? cellFmt(r.values.reduce((s, v) => s + (v ?? 0), 0));
              const priorCellStyle = { ...tokens.num, color: 'var(--color-meta)', fontStyle: 'italic' as const };
              const trace = r.trace;
              const onTrace = trace
                ? (e: React.MouseEvent): void => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent('fmp:trace-to', { detail: trace }));
                  }
                : undefined;
              return (
                <tr key={r.label + idx}>
                  <td
                    style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px`, cursor: isCollapsibleHeader ? 'pointer' : undefined, userSelect: isCollapsibleHeader ? 'none' : undefined }}
                    onClick={isCollapsibleHeader ? () => toggleGroup(r.collapseGroup!) : undefined}
                    data-testid={isCollapsibleHeader ? `m4-collapse-toggle-${r.collapseGroup}` : undefined}
                  >
                    {isCollapsibleHeader && (
                      <span style={{ marginRight: 6, fontSize: 10, color: 'var(--color-meta)' }}>
                        {isCollapsed ? '▶' : '▼'}
                      </span>
                    )}
                    {r.label}
                    {trace && (
                      <button
                        type="button"
                        onClick={onTrace}
                        title={trace.label ?? `Jump to source schedule`}
                        data-testid={`m4-trace-${r.label.replace(/\s+/g, '-')}`}
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          padding: '0 4px',
                          background: 'transparent',
                          color: 'var(--color-primary, #1d4ed8)',
                          border: '1px solid var(--color-primary, #1d4ed8)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          lineHeight: '14px',
                        }}
                      >⤴</button>
                    )}
                  </td>
                  {hasPhase && (
                    <td style={{ ...tokens.num, textAlign: 'center', fontSize: 10, color: 'var(--color-meta)' }}>
                      {r.phaseLabel ?? ''}
                    </td>
                  )}
                  <td style={tokens.numTotal}>{total}</td>
                  {hasPrior && (<td style={priorCellStyle}>{cellFmt(r.priorValue ?? 0)}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{cellFmt(v ?? 0)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
