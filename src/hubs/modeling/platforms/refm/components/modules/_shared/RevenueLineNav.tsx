/**
 * RevenueLineNav (2026-09-13)
 *
 * The quick-nav strip at the top of the Module 2 tabs, ONE PILL PER LINE,
 * bucketed by the one filing rule (`revenueSection`, lib/revenueLines.ts) in
 * the founder's reading order. It replaced `AssetQuickNav` on Module 2, which
 * bucketed by strategy and by the bare companion flag and so listed a retail
 * strip under Hospitality AND Retail, two pills for one card.
 *
 * Clicking a pill fires the same `fmp:asset-nav-expand` event the section and
 * card components already listen for, carrying the LINE key as the id, then
 * scrolls to `${idPrefix}-${line.key}`.
 */

import React from 'react';
import {
  groupRevenueLines, REVENUE_SECTION_KEY, type RevenueLine, type RevenueSection,
} from '../../../lib/revenueLines';

const SECTION_COLOR: Record<RevenueSection, { color: string; background: string }> = {
  'Residential': { color: 'var(--color-navy, #0f2e4c)', background: 'color-mix(in srgb, var(--color-navy, #0f2e4c) 12%, transparent)' },
  'Hospitality': { color: 'var(--color-success, #166534)', background: 'color-mix(in srgb, var(--color-success, #166534) 12%, transparent)' },
  'Standalone Commercial': { color: 'var(--color-warning, #92400e)', background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)' },
  'Retail Ground Floor': { color: 'var(--color-info, #1d4ed8)', background: 'color-mix(in srgb, var(--color-info, #1d4ed8) 12%, transparent)' },
  'Other': { color: 'var(--color-meta)', background: 'color-mix(in srgb, var(--color-meta) 12%, transparent)' },
};

export function scrollToRevenueLine(idPrefix: string, lineKey: string): void {
  if (typeof document === 'undefined') return;
  window.dispatchEvent(new CustomEvent('fmp:asset-nav-expand', { detail: { assetId: lineKey } }));
  window.setTimeout(() => {
    const el = document.getElementById(`${idPrefix}-${lineKey}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid var(--color-primary, #1d4ed8)';
    el.style.outlineOffset = '2px';
    el.style.transition = 'outline-color 0.6s ease-out';
    window.setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 1200);
  }, 60);
}

export function RevenueLineNav({
  lines, idPrefix, testidPrefix = 'm2-line-nav',
}: {
  lines: readonly RevenueLine[];
  idPrefix: string;
  testidPrefix?: string;
}): React.JSX.Element | null {
  const groups = groupRevenueLines(lines);
  if (groups.length === 0) return null;
  return (
    <div
      data-testid={testidPrefix}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        marginBottom: 'var(--sp-2)',
        padding: '8px 10px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 2px 4px color-mix(in srgb, var(--color-text, #000) 6%, transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>
          Jump to line
        </span>
        {groups.map((g) => {
          const c = SECTION_COLOR[g.section];
          return (
            <div key={g.section} data-testid={`${testidPrefix}-${REVENUE_SECTION_KEY[g.section]}`} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: c.color }}>
                {g.section}:
              </span>
              {g.lines.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => scrollToRevenueLine(idPrefix, l.key)}
                  data-testid={`${testidPrefix}-${l.key}`}
                  title={`Jump to ${l.label}${l.phaseName ? `, ${l.phaseName}` : ''}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 8px',
                    background: c.background,
                    color: c.color,
                    border: `1px solid ${c.color}`,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {l.label}{l.phaseName ? ` · ${l.phaseName}` : ''}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
