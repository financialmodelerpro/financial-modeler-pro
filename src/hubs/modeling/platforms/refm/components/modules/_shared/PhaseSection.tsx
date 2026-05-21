'use client';

/**
 * Shared phase section wrapper for Module 2-6 output tabs.
 *
 * Renders the universal navy phase header bar (white text per [[feedback_ui_universal_defaults]] rule 1),
 * collapse chevron with localStorage memory (rule 4), and asset count chip.
 * Reuses the same visual language as Module 1 Tab 2 phase headers so the
 * whole platform reads as one product.
 */

import React, { useEffect, useState } from 'react';

const phaseHeaderStyle: React.CSSProperties = {
  background: 'var(--color-navy)',
  color: 'var(--color-on-primary-navy)',
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--sp-2)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'pointer',
};

const assetHeaderStyle: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--color-navy) 8%, transparent)',
  color: 'var(--color-heading)',
  padding: 'var(--sp-1) var(--sp-2)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--sp-1)',
  marginTop: 'var(--sp-1)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'pointer',
  border: '1px solid color-mix(in srgb, var(--color-navy) 14%, transparent)',
};

interface PhaseSectionProps {
  phaseId: string;
  title: string;
  meta?: string;
  countLabel?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  /** Asset ids contained inside this section. When AssetQuickNav fires
   *  for one of these ids, this section auto-expands. Unset means the
   *  section ignores quick-nav events. */
  assetIds?: string[];
  children: React.ReactNode;
}

export function PhaseSection({ phaseId, title, meta, countLabel, storageKey, defaultOpen = true, assetIds, children }: PhaseSectionProps): React.JSX.Element {
  // Default key uses the fmp:m2 namespace per [[feedback_ui_universal_defaults]].
  // Callers should pass storageKey explicitly with the surface name baked in
  // (e.g. `fmp:m2:revenue:phase:${id}:collapsed`) so tabs keep independent
  // collapse state.
  const key = storageKey ?? `fmp:m2:phase:${phaseId}:collapsed`;
  const read = (): boolean => {
    if (typeof window === 'undefined') return !defaultOpen;
    try { return window.localStorage.getItem(key) === 'true'; }
    catch { return !defaultOpen; }
  };
  const [collapsed, setCollapsed] = useState<boolean>(read);
  useEffect(() => {
    try { window.localStorage.setItem(key, String(collapsed)); } catch { /* noop */ }
  }, [collapsed, key]);
  // M4 Pass 2N-Fix (2026-05-21): AssetQuickNav dispatches an event with
  // the target asset id. Only expand if this section contains that
  // asset (via the assetIds prop). Sections without an assetIds prop
  // ignore quick-nav events and keep their existing collapse state.
  const assetIdsKey = (assetIds ?? []).join(',');
  useEffect(() => {
    if (!assetIds || assetIds.length === 0) return;
    const ids = new Set(assetIds);
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ assetId?: string }>).detail;
      if (detail?.assetId && ids.has(detail.assetId)) setCollapsed(false);
    };
    window.addEventListener('fmp:asset-nav-expand', handler);
    return () => window.removeEventListener('fmp:asset-nav-expand', handler);
  }, [assetIdsKey]);

  return (
    <div data-testid={`phase-section-${phaseId}`} style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={phaseHeaderStyle} onClick={() => setCollapsed(!collapsed)}>
        <div>
          <strong style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</strong>
          {meta && (
            <span style={{ marginLeft: 12, fontSize: 11, opacity: 0.85 }}>{meta}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {countLabel && (
            <span style={{ fontSize: 11, opacity: 0.85 }}>{countLabel}</span>
          )}
          <span style={{ fontSize: 14, opacity: 0.85 }}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>
      {!collapsed && children}
    </div>
  );
}

interface AssetSectionProps {
  assetId: string;
  title: string;
  meta?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  /** Optional DOM id for quick-nav scroll targets. When unset no id is rendered. */
  domId?: string;
  children: React.ReactNode;
}

export function AssetSection({ assetId, title, meta, storageKey, defaultOpen = true, domId, children }: AssetSectionProps): React.JSX.Element {
  const key = storageKey ?? `fmp:m2:asset:${assetId}:collapsed`;
  const read = (): boolean => {
    if (typeof window === 'undefined') return !defaultOpen;
    try { return window.localStorage.getItem(key) === 'true'; }
    catch { return !defaultOpen; }
  };
  const [collapsed, setCollapsed] = useState<boolean>(read);
  useEffect(() => {
    try { window.localStorage.setItem(key, String(collapsed)); } catch { /* noop */ }
  }, [collapsed, key]);
  // M4 Pass 2N-Fix (2026-05-21): expand ONLY when the AssetQuickNav
  // event names this specific asset.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ assetId?: string }>).detail;
      if (detail?.assetId === assetId) setCollapsed(false);
    };
    window.addEventListener('fmp:asset-nav-expand', handler);
    return () => window.removeEventListener('fmp:asset-nav-expand', handler);
  }, [assetId]);

  return (
    <div
      id={domId}
      data-testid={`asset-section-${assetId}`}
      style={{ marginBottom: 'var(--sp-2)', scrollMarginTop: domId ? '70px' : undefined }}
    >
      <div style={assetHeaderStyle} onClick={() => setCollapsed(!collapsed)}>
        <div>
          <strong style={{ fontSize: 12 }}>{title}</strong>
          {meta && (
            <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--color-meta)', fontWeight: 400 }}>{meta}</span>
          )}
        </div>
        <span style={{ fontSize: 12 }}>{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div style={{ paddingLeft: 'var(--sp-2)' }}>{children}</div>}
    </div>
  );
}
