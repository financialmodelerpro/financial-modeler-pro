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

export function AssetQuickNav({ assets, idPrefix, testidPrefix = 'm2-asset-nav' }: AssetQuickNavProps): React.JSX.Element | null {
  const visible = assets.filter((a) => a.visible !== false);
  const residential = visible.filter(
    (a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && a.isCompanion !== true,
  );
  const hospitality = visible.filter(
    (a) => a.strategy === 'Operate' || a.isCompanion === true,
  );
  const retail = visible.filter((a) => a.strategy === 'Lease');

  const buckets: BucketCfg[] = [
    { key: 'residential', label: 'Residential', color: 'var(--color-navy, #0f2e4c)', background: 'color-mix(in srgb, var(--color-navy, #0f2e4c) 12%, transparent)', assets: residential },
    { key: 'hospitality', label: 'Hospitality', color: 'var(--color-success, #166534)', background: 'color-mix(in srgb, var(--color-success, #166534) 12%, transparent)', assets: hospitality },
    { key: 'retail', label: 'Retail', color: 'var(--color-warning, #92400e)', background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)', assets: retail },
  ].filter((b) => b.assets.length > 0);

  if (buckets.length === 0) return null;

  const scrollToAsset = (assetId: string): void => {
    const targetId = `${idPrefix}-${assetId}`;
    if (typeof document === 'undefined') return;
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Brief highlight pulse so the user sees where they landed.
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid var(--color-primary, #1d4ed8)';
    el.style.outlineOffset = '2px';
    el.style.transition = 'outline-color 0.6s ease-out';
    window.setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 1200);
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
