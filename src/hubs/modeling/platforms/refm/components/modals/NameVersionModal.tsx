'use client';

/**
 * NameVersionModal (Phase M-Versioning, 2026-05-31; auto-naming + comment
 * 2026-06-01).
 *
 * Two modes:
 *
 *   'start-session'  ←  first-edit prompt / "Create Version". The version
 *                       name is AUTO-GENERATED
 *                       ({ProjectName}_v{Major}.{Minor}_{MMDDYYYY}_{TaskName})
 *                       and shown read-only, updating live as the user types
 *                       the Task Name. The user must also enter a Comment
 *                       describing what changed. Save is disabled until both
 *                       Task Name and Comment are valid. Cancel reverts the
 *                       edit back to the loaded version.
 *
 *   'rename'         ←  user clicked the topbar Save while already editing.
 *                       Simple free-text label edit (the snapshot is auto-
 *                       PATCHed every 1.5 s anyway).
 *
 * Persistence happens via the `onConfirm` callback the parent wires to
 * sync.startEditSession().
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getNextVersionNumber,
  buildVersionName,
  validateTaskName,
  validateComment,
  TASK_NAME_MAX,
  COMMENT_MAX,
} from '../../lib/persistence/versionNaming';

export type NameVersionModalMode = 'start-session' | 'save-as-new' | 'rename';

export interface NameVersionConfirm {
  /** Final version label written to the row (the auto-name in create mode). */
  label: string;
  versionLabel?: string;
  taskName?: string;
  comment?: string;
}

interface ExistingVersionLite {
  name?: string | null;
  createdAt?: string | null;
}

interface NameVersionModalProps {
  open: boolean;
  mode: NameVersionModalMode;
  /** Default name suggestion for rename mode (e.g. "Edits 2026-05-31 14:32"). */
  defaultLabel: string;
  /** Existing label, shown in rename mode. */
  currentLabel?: string | null;
  /** Project name, used to build the auto-generated version name. */
  projectName?: string | null;
  /** Existing versions of this project, used to compute the next X.Y label.
   *  versionLabel is parsed from each version's name (which embeds _vX.Y_). */
  existingVersions?: ExistingVersionLite[];
  /** create mode only. When true (default), cancelling discards the in-flight
   *  edit. When false (promoting an already-persisting auto-session), cancel
   *  just closes the dialog and keeps the edits. Controls the button label +
   *  the warning copy so they never lie about what Cancel does. */
  discardOnCancel?: boolean;
  onConfirm: (result: NameVersionConfirm) => Promise<void> | void;
  onCancel: () => void;
}

/** Pull "1.5" out of a generated version name like "Proj_v1.5_06152026_Task". */
function extractVersionLabelFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /_v(\d+\.\d+)_/.exec(name);
  return m ? m[1] : null;
}

export default function NameVersionModal({
  open,
  mode,
  defaultLabel,
  currentLabel,
  projectName,
  existingVersions,
  discardOnCancel = true,
  onConfirm,
  onCancel,
}: NameVersionModalProps): React.JSX.Element | null {
  const [label, setLabel] = useState('');      // rename mode free text
  const [taskName, setTaskName] = useState(''); // create mode
  const [comment, setComment] = useState('');   // create mode
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(mode === 'rename' ? (currentLabel ?? '') : '');
    setTaskName('');
    setComment('');
    setSubmitting(false);
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, mode, currentLabel]);

  // Next version label + live preview (create mode only).
  const nextVersionLabel = useMemo(() => {
    const list = (existingVersions ?? []).map((v) => ({
      versionLabel: extractVersionLabelFromName(v.name),
      createdAt: v.createdAt ?? null,
    }));
    return getNextVersionNumber(list);
  }, [existingVersions]);

  const previewName = useMemo(
    () => buildVersionName(projectName ?? 'Project', nextVersionLabel, taskName),
    [projectName, nextVersionLabel, taskName],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  // 'start-session' (first edit / create-new) and 'save-as-new' (mid-session
  // branch) share the same auto-name + Task + Comment form; only 'rename' is the
  // free-text label edit.
  const isCreate = mode === 'start-session' || mode === 'save-as-new';

  const taskV = validateTaskName(taskName);
  const commentV = validateComment(comment);
  const createValid = taskV.ok && commentV.ok;

  const handleConfirm = async (): Promise<void> => {
    if (submitting) return;
    if (isCreate && !createValid) return;
    setSubmitting(true);
    try {
      if (isCreate) {
        await onConfirm({
          label: previewName,
          versionLabel: nextVersionLabel,
          taskName: taskName.trim(),
          comment: comment.trim(),
        });
      } else {
        await onConfirm({ label: label.trim() || defaultLabel });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'rename'
    ? '✏️ Rename this version'
    : mode === 'save-as-new'
      ? '🌿 Save as new version'
      : '📌 Create version';

  const fieldLabel: React.CSSProperties = {
    display: 'block',
    fontSize: 'var(--font-meta)',
    fontWeight: 'var(--fw-semibold)',
    color: 'var(--color-body)',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-body)',
    fontFamily: 'Inter, sans-serif',
  };

  const content = (
    <div
      className="pm-modal-overlay"
      onClick={isCreate ? undefined : onCancel}
      data-testid="name-version-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-version-modal-title"
      style={{ zIndex: 9500 }}
    >
      <div
        className="pm-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      >
        <div className="pm-modal-header">
          <div>
            <div id="name-version-modal-title" style={{ fontSize: '15px', fontWeight: 700 }}>
              {title}
            </div>
            <div style={{ fontSize: '11px', color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)', marginTop: '2px' }}>
              {projectName ?? 'No project selected'}
            </div>
          </div>
          {mode === 'rename' && (
            <button
              onClick={onCancel}
              data-testid="name-version-modal-close"
              style={{ background: 'color-mix(in srgb, var(--color-on-primary-navy) 10%, transparent)', border: 'none', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--color-on-primary-navy)', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ✕
            </button>
          )}
        </div>

        <div className="pm-modal-body">
          {isCreate ? (
            <>
              <label style={fieldLabel}>Version Name (auto-generated)</label>
              <div
                data-testid="name-version-modal-preview"
                style={{
                  ...inputStyle,
                  background: 'var(--color-surface)',
                  color: 'var(--color-body)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '12px',
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {previewName}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px', marginBottom: 'var(--sp-2)' }}>
                {`Version v${nextVersionLabel} - auto-managed (v1.0 to v1.9 then v2.0). Date is today.`}
              </div>

              <label style={fieldLabel}>Task Name *</label>
              <input
                ref={firstFieldRef}
                type="text"
                value={taskName}
                maxLength={TASK_NAME_MAX}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="e.g. Debt Assumptions"
                data-testid="name-version-modal-task"
                style={{ ...inputStyle, borderColor: taskName.length > 0 && !taskV.ok ? 'var(--color-danger, #dc2626)' : 'var(--color-border)' }}
              />
              <div style={{ fontSize: '11px', color: taskName.length > 0 && !taskV.ok ? 'var(--color-danger, #dc2626)' : 'var(--color-muted)', marginTop: '4px', marginBottom: 'var(--sp-2)' }}>
                {taskName.length > 0 && !taskV.ok ? taskV.error : `Letters, numbers, spaces, underscores. ${taskName.length}/${TASK_NAME_MAX}.`}
              </div>

              <label style={fieldLabel}>Comment *</label>
              <textarea
                value={comment}
                maxLength={COMMENT_MAX}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Explain what changed in this version (e.g. updated debt rate assumptions, added Phase 3 capex, fixed escrow logic)"
                data-testid="name-version-modal-comment"
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', minHeight: '88px', borderColor: comment.length > 0 && !commentV.ok ? 'var(--color-danger, #dc2626)' : 'var(--color-border)' }}
              />
              <div style={{ fontSize: '11px', color: comment.length > 0 && !commentV.ok ? 'var(--color-danger, #dc2626)' : 'var(--color-muted)', marginTop: '4px' }}>
                {comment.length > 0 && !commentV.ok ? commentV.error : `Required. ${comment.length}/${COMMENT_MAX}.`}
              </div>

              <div style={{ background: 'var(--color-amber-light, color-mix(in srgb, #f59e0b 15%, transparent))', border: '1px solid var(--color-amber, #f59e0b)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: '12px', color: 'var(--color-amber-dark, #92400e)', marginTop: 'var(--sp-2)' }}>
                {discardOnCancel
                  ? 'ⓘ If you cancel, your last edit will be discarded and the project will return to the previously loaded version.'
                  : 'ⓘ Your edits are already saved to the current version. Cancel just closes this dialog without naming it yet; nothing is lost.'}
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 'var(--font-small)', color: 'var(--color-body)', lineHeight: 1.5, marginBottom: 'var(--sp-2)' }}>
                Update the name of the version you are currently editing. The snapshot is auto-saved every 1.5 seconds; this only changes the label.
              </p>
              <label style={fieldLabel}>Version Name</label>
              <input
                ref={firstFieldRef}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirm(); }}
                placeholder={defaultLabel}
                data-testid="name-version-modal-input"
                style={inputStyle}
              />
              <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px' }}>
                Leave blank to clear the label (version still appears in history by date).
              </div>
            </>
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
            {isCreate && discardOnCancel ? 'Discard Edit' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleConfirm()}
            data-testid="name-version-modal-save"
            disabled={submitting || (isCreate && !createValid)}
          >
            {submitting ? 'Saving...' : mode === 'save-as-new' ? 'Save as New Version' : isCreate ? 'Save Version' : 'Save Name'}
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
