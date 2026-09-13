/**
 * AssetQuickNav (2026-05-21)
 *
 * Quick-nav strip rendered at the top of M2 Revenue Inputs + Output tabs.
 * Lets the user jump directly to a specific asset's card / section by
 * clicking its name pill instead of scrolling through every asset.
 *
 * Pills are grouped by strategy bucket (Residential / Hospitality /
 * Retail), matching the in-page order. Click smooth-scrolls to the
 * anchor `${idPrefix}-${asset.id}` (and expands the card if the user
 * has collapsed it, via a small click on the same id's header).
 */

import React from 'react';
import type { Asset } from '../../../lib/state/module1-types';
import { useModule1Store } from '../../../lib/state/module1-store';
import { revenueSection, REVENUE_SECTIONS, REVENUE_SECTION_KEY, type RevenueSection } from '../../../lib/revenueLines';

interface BucketCfg {
  key: string;
  label: string;
  color: string;
  background: string;
  assets: Asset[];
}

interface AssetQuickNavProps {
  /** All assets (visible OR not, companions included). Filtering done internally. */
  assets: Asset[];
  /** DOM id prefix used for the scroll target (e.g., 'm2-input-asset' or 'm2-out-asset'). */
  idPrefix: string;
  /** Test id prefix for the nav bar root + each pill. */
  testidPrefix?: string;
}

const BUCKET_STYLE: Record<RevenueSection, { color: string; background: string }> = {
  'Residential': { color: 'var(--color-navy, #0f2e4c)', background: 'color-mix(in srgb, var(--color-navy, #0f2e4c) 12%, transparent)' },
  'Hospitality': { color: 'var(--color-success, #166534)', background: 'color-mix(in srgb, var(--color-success, #166534) 12%, transparent)' },
  'Standalone Commercial': { color: 'var(--color-warning, #92400e)', background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)' },
  'Retail Ground Floor': { color: 'var(--color-info, #1d4ed8)', background: 'color-mix(in srgb, var(--color-info, #1d4ed8) 12%, transparent)' },
  'Other': { color: 'var(--color-meta)', background: 'color-mix(in srgb, var(--color-meta) 12%, transparent)' },
};

export function AssetQuickNav({ assets, idPrefix, testidPrefix = 'm2-asset-nav' }: AssetQuickNavProps): React.JSX.Element | null {
  // THE ONE FILING RULE (2026-09-13). This bucketed by strategy and by the
  // bare companion flag, so a retail strip (a Lease companion) was listed
  // under Hospitality AND Retail: two pills for one card. Every asset now
  // lands in exactly one bucket, the one `revenueSection` names.
  const project = useModule1Store((s) => s.project);
  const visible = assets.filter((a) => a.visible !== false);
  const buckets: BucketCfg[] = REVENUE_SECTIONS.map((section) => ({
    key: REVENUE_SECTION_KEY[section],
    label: section,
    ...BUCKET_STYLE[section],
    assets: visible.filter((a) => revenueSection(a, project) === section),
  })).filter((b) => b.assets.length > 0);

  if (buckets.length === 0) return null;

  const scrollToAsset = (assetId: string): void => {
    const targetId = `${idPrefix}-${assetId}`;
    if (typeof document === 'undefined') return;
    // M4 Pass 2N-Fix (2026-05-21): event carries the target asset id so
    // only the parent section containing this asset AND only this asset
    // card expand themselves. Other strategy sections and other asset
    // cards keep their existing collapse state.
    window.dispatchEvent(new CustomEvent('fmp:asset-nav-expand', {
      detail: { assetId },
    }));
    // Defer the lookup + scroll one tick so React's re-render
    // (triggered by the event handlers above) flushes first and the
    // target element is in the DOM.
    window.setTimeout(() => {
      const el = document.getElementById(targetId);
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
  };

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
          Jump to asset
        </span>
        {buckets.map((b) => (
          <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: b.color,
              }}
            >
              {b.label}:
            </span>
            {b.assets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => scrollToAsset(a.id)}
                data-testid={`${testidPrefix}-${a.id}`}
                title={`Jump to ${a.name}`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 8px',
                  background: b.background,
                  color: b.color,
                  border: `1px solid ${b.color}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {a.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
