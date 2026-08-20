'use client';

/**
 * FirstRunGuidePrompt.tsx (2026-08-20)
 *
 * A short one-time prompt on a user's FIRST platform open, shown BEFORE the
 * tour offer: the written guide is detailed and worth reading before starting
 * a project, with a button that opens it full screen.
 *
 * ONE CLICK, PERMANENTLY. Both actions (Open the guide / Continue) mark
 * `guidePromptAt` in the SAME per-user state blob the tour uses (mig 217,
 * users.refm_tour, through tourState.ts which MERGES writes), so this never
 * reappears, needed no second store, and Continue does not block the tour
 * offer: the caller runs the tour decision after either action.
 *
 * Re-showable from inside the guide overlay, beside the tour restart, so a
 * dismissed prompt is a choice and not a dead end.
 *
 * Palette: design tokens only.
 *
 * No em dashes in this file.
 */
import React from 'react';
import { createPortal } from 'react-dom';

export default function FirstRunGuidePrompt({
  open,
  onOpenGuide,
  onContinue,
}: {
  open: boolean;
  /** Marks the prompt seen AND opens the full-screen guide. */
  onOpenGuide: () => void;
  /** Marks the prompt seen and proceeds (to the tour offer, if due). */
  onContinue: () => void;
}): React.JSX.Element | null {
  if (!open || typeof document === 'undefined') return null;

  const btn = (primary: boolean): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 700, padding: '9px 18px', borderRadius: 8, cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--color-border)',
    background: primary ? 'var(--color-primary)' : 'var(--color-surface)',
    color: primary ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
  });

  const content = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2050,
        background: 'color-mix(in srgb, var(--color-heading) 55%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      data-testid="first-run-guide-prompt"
    >
      <div style={{
        background: 'var(--color-surface)', borderRadius: 14, boxShadow: 'var(--shadow-modal)',
        width: 'min(460px, 100%)', padding: '22px 24px', fontFamily: 'Inter, sans-serif',
        borderTop: '4px solid var(--color-navy)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-heading)', marginBottom: 8 }}>
          Before you start: the platform guide
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text)', margin: '0 0 6px' }}>
          The written guide is detailed and worth reading before you build your first project.
          It walks every module and tab, explains what each surface is for, and you can search it.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--color-meta)', margin: '0 0 16px' }}>
          It stays one click away: the Guide button in the top bar opens it from anywhere.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" style={btn(false)} onClick={onContinue} data-testid="first-run-continue">
            Continue
          </button>
          <button type="button" style={btn(true)} onClick={onOpenGuide} data-testid="first-run-open-guide">
            Open the guide
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
