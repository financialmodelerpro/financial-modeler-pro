'use client';

/**
 * StrategyChangeNotice.tsx (M1 Assets, 2026-08-11)
 *
 * The two halves of telling a user what a strategy change did.
 *
 * `StrategyChangeConfirm` runs BEFORE the change. It shows what will activate,
 * what will be retained and what will be left empty, from a DRY RUN of the same
 * pure `applyStrategySwitch` the store commits, so the preview cannot describe
 * something other than what happens.
 *
 * `StrategyReviewBanner` stays AFTER the change until the user dismisses it. It
 * exists because the empty assumptions live on other tabs: a modal that is gone
 * the moment you navigate away is exactly the wrong shape for "go to Module 2
 * and set the ADR".
 *
 * Why both: a modal alone is missed as soon as the user leaves the tab, and a
 * banner alone lets a destructive-looking switch happen before the user knows
 * what it will touch. Nothing here is destructive (every outgoing assumption is
 * retained), which is itself the most important thing the confirm has to say.
 *
 * No em dashes in this file.
 */
import React from 'react';
import type { StrategySwitchReport } from '../../../lib/state/strategySwitch';

const listStyle: React.CSSProperties = { margin: '2px 0 8px', paddingLeft: 18, fontSize: 12, lineHeight: 1.5 };
const headStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--color-meta)', margin: '6px 0 2px' };

function Group({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div>
      <div style={{ ...headStyle, ...(tone === 'warn' ? { color: 'var(--color-warning-fg, #92400E)' } : {}) }}>{title}</div>
      <ul style={listStyle}>
        {items.map((t) => (<li key={t} style={tone === 'warn' ? { color: 'var(--color-warning-fg, #92400E)', fontWeight: 600 } : undefined}>{t}</li>))}
      </ul>
    </div>
  );
}

/** The body shared by the modal and the banner, so the two cannot describe the
 *  same switch differently. */
function ReportBody({ report }: { report: StrategySwitchReport }): React.JSX.Element {
  const nothingMoved = report.retained.length === 0 && report.restored.length === 0 && report.seeded.length === 0;
  return (
    <div>
      <Group title="Needs your review" items={report.needsReview} tone="warn" />
      <Group title="Restored from the last time this asset was here" items={report.restored} />
      <Group title="Created for the new strategy" items={report.seeded} />
      <Group title="Retained, and restored if you switch back" items={report.retained} />
      {nothingMoved && (
        <div style={{ fontSize: 12, color: 'var(--color-meta)' }}>
          This asset has no strategy-specific assumptions set up yet, so nothing moves.
        </div>
      )}
    </div>
  );
}

export function StrategyChangeConfirm({ report, onConfirm, onCancel }: {
  report: StrategySwitchReport;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm strategy change"
      data-testid="strategy-change-confirm"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
          width: 'min(560px, 100%)', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', padding: '10px 16px', borderRadius: 'var(--radius) var(--radius) 0 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Change strategy: {report.from} to {report.to}</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>{report.assetName}</div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            Nothing is deleted. The assumptions belonging to <strong>{report.from}</strong> are kept on this asset and
            come back exactly as they are if you switch back.
          </div>
          <ReportBody report={report} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--color-border)' }}>
          <button type="button" onClick={onCancel} data-testid="strategy-change-cancel" className="btn-secondary" style={{ fontSize: 12 }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} data-testid="strategy-change-apply" className="btn-primary" style={{ fontSize: 12 }}>
            Change to {report.to}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StrategyReviewBanner({ report, onDismiss }: {
  report: StrategySwitchReport;
  onDismiss: () => void;
}): React.JSX.Element {
  const warn = report.needsReview.length > 0;
  return (
    <div
      data-testid="strategy-review-banner"
      style={{
        border: `1px solid ${warn ? 'var(--color-warning-fg, #92400E)' : 'var(--color-border)'}`,
        borderLeft: `4px solid ${warn ? 'var(--color-warning-fg, #92400E)' : 'var(--color-navy)'}`,
        background: warn ? 'var(--color-warning-bg, #FEF3C7)' : 'var(--color-grey-pale, #f3f4f6)',
        borderRadius: 'var(--radius)', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          Strategy changed from {report.from} to {report.to}
          {warn ? '. Review the assumptions below before relying on this model.' : '. Nothing is outstanding.'}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          data-testid="strategy-review-dismiss"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--color-meta)', flexShrink: 0 }}
        >
          Dismiss
        </button>
      </div>
      <ReportBody report={report} />
    </div>
  );
}
