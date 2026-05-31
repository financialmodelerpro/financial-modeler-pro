'use client';

/**
 * NameVersionModal (Phase M-Versioning, 2026-05-31).
 *
 * Triggered automatically when the user makes their first edit after
 * opening a project (or after loading a historical version). The
 * sync module fires `fmp:refm-session-needs-name`; the
 * RealEstatePlatform shell opens this modal. The user names the
 * version they're about to edit; from that point on, every keystroke
 * PATCHes the same version row in place. The version is also stamped
 * with a pre-computed change_log diff against the version it
 * branched from, so the history UI can render "what changed in this
 * version" later.
 *
 * Two modes (driven by the `mode` prop):
 *
 *   'start-session'  ←  first-edit prompt. Cancel reverts the user's
 *                       edit back to the loaded version. Save
 *                       transitions to EDITING.
 *
 *   'rename'         ←  user clicked the topbar Save button while
 *                       already in EDITING. Cancel keeps the existing
 *                       label; Save updates the label only (snapshot
 *                       is auto-PATCHed every 1.5 s anyway).
 *
 * Pure presentational + minimal local state. All persistence happens
 * via the `onConfirm` / `onCancel` callbacks the parent wires to
 * sync.startEditSession() / sync.revertEditSession().
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type NameVersionModalMode = 'start-session' | 'rename';

interface NameVersionModalProps {
  open: boolean;
  mode: NameVersionModalMode;
  /** Default name suggestion (e.g. "Edits 2026-05-31 14:32"). */
  defaultLabel: string;
  /** Existing label, shown in rename mode. */
  currentLabel?: string | null;
  /** Project name for context in the header. */
  projectName?: string | null;
  /** Resolves with the chosen label (may be empty → server uses null). */
  onConfirm: (label: string) => Promise<void> | void;
  /** Called on Cancel / overlay click / Escape. */
  onCancel: () => void;
}

export default function NameVersionModal({
  open,
  mode,
  defaultLabel,
  currentLabel,
  projectName,
  onConfirm,
  onCancel,
}: NameVersionModalProps): React.JSX.Element | null {
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(mode === 'rename' ? (currentLabel ?? '') : '');
    setSubmitting(false);
    // Auto-focus on open; delay slightly to win against the React
    // portal mount timing.
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, mode, currentLabel]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const handleConfirm = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    const effectiveLabel = label.trim() || defaultLabel;
    try {
      await onConfirm(effectiveLabel);
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    mode === 'start-session' ? '📌 Name this version' : '✏️ Rename this version';
  const description =
    mode === 'start-session'
      ? 'You are about to edit this project. Give this version a name so its changes are tracked separately from the loaded version. All edits in this session will be saved into this version, and the change log will show exactly what changed.'
      : 'Update the name of the version you are currently editing. The snapshot is auto-saved every 1.5 seconds; this only changes the label.';

  const content = (
    <div
      className="pm-modal-overlay"
      onClick={mode === 'start-session' ? undefined : onCancel}
      data-testid="name-version-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-version-modal-title"
      style={{
        // Stack above the project-switching overlay added in
        // commit ca5c152 (z-index 9000).
        zIndex: 9500,
      }}
    >
      <div
        className="pm-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <div className="pm-modal-header">
          <div>
            <div id="name-version-modal-title" style={{ fontSize: '15px', fontWeight: 700 }}>
              {title}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)',
                marginTop: '2px',
              }}
            >
              {projectName ?? 'No project selected'}
            </div>
          </div>
          {mode === 'rename' && (
            <button
              onClick={onCancel}
              data-testid="name-version-modal-close"
              style={{
                background: 'color-mix(in srgb, var(--color-on-primary-navy) 10%, transparent)',
                border: 'none',
                borderRadius: '6px',
                width: '28px',
                height: '28px',
                cursor: 'pointer',
                color: 'var(--color-on-primary-navy)',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div className="pm-modal-body">
          <p
            style={{
              fontSize: 'var(--font-small)',
              color: 'var(--color-body)',
              lineHeight: 1.5,
              marginBottom: 'var(--sp-2)',
            }}
          >
            {description}
          </p>

          <label
            style={{
              display: 'block',
              fontSize: 'var(--font-meta)',
              fontWeight: 'var(--fw-semibold)',
              color: 'var(--color-body)',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Version Name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConfirm();
            }}
            placeholder={defaultLabel}
            data-testid="name-version-modal-input"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-body)',
              fontFamily: 'Inter, sans-serif',
            }}
          />
          <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px' }}>
            {mode === 'start-session'
              ? `Leave blank to use "${defaultLabel}" (the default).`
              : 'Leave blank to clear the label (version still appears in history by date).'}
          </div>

          {mode === 'start-session' && (
            <div
              style={{
                background: 'var(--color-amber-light, color-mix(in srgb, #f59e0b 15%, transparent))',
                border: '1px solid var(--color-amber, #f59e0b)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                fontSize: '12px',
                color: 'var(--color-amber-dark, #92400e)',
                marginTop: 'var(--sp-2)',
              }}
            >
              ⓘ If you cancel, your last edit will be discarded and the project
              will return to the previously loaded version.
            </div>
          )}
        </div>

        <div className="pm-modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            data-testid="name-version-modal-cancel"
            disabled={submitting}
          >
            {mode === 'start-session' ? 'Discard Edit' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleConfirm()}
            data-testid="name-version-modal-save"
            disabled={submitting}
          >
            {submitting
              ? 'Saving...'
              : mode === 'start-session'
                ? 'Start Editing'
                : 'Save Name'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

/** Helper used by callers to build a sensible default label. */
export function defaultSessionLabel(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `Edits ${y}-${m}-${d} ${hh}:${mm}`;
}
