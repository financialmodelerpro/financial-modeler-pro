'use client';

/**
 * EditChoiceModal (2026-06-17, version edit choice).
 *
 * Shown when the user clicks Edit on a project that is open in VIEW mode.
 * Before any editing starts, the user picks HOW to edit so we stop piling up a
 * new version on every Edit:
 *
 *   - 'in-place'    (default) overwrite the current / recently-opened version.
 *                   No new version is created.
 *   - 'different'   open a DIFFERENT existing version and edit that one in
 *                   place (routes through the version history picker).
 *   - 'create-new'  branch a brand-new version from the current state (the old
 *                   always-create behaviour), named via NameVersionModal.
 *
 * The current version name is shown clearly so the user confirms which version
 * they are about to edit before choosing in-place.
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';

export type EditChoice = 'in-place' | 'different' | 'create-new';

interface EditChoiceModalProps {
  open: boolean;
  projectName?: string | null;
  /** Name of the version currently loaded (shown so the user confirms it). */
  currentVersionName?: string | null;
  /** False when there is no known saved version to overwrite (e.g. a cache-only
   *  load); in-place is then disabled and create-new is the default. */
  canEditInPlace: boolean;
  onChoose: (choice: EditChoice) => void;
  onCancel: () => void;
}

export default function EditChoiceModal({
  open,
  projectName,
  currentVersionName,
  canEditInPlace,
  onChoose,
  onCancel,
}: EditChoiceModalProps): React.JSX.Element | null {
  // Default to in-place when a saved version is loaded, else create-new. The
  // parent mounts this modal fresh on each open (so this initializer re-runs and
  // the default is always correct without a resetting effect).
  const [choice, setChoice] = useState<EditChoice>(canEditInPlace ? 'in-place' : 'create-new');

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const versionLabel = currentVersionName && currentVersionName.trim().length > 0
    ? currentVersionName
    : 'the current version';

  const options: Array<{ value: EditChoice; title: string; desc: string; disabled?: boolean }> = [
    {
      value: 'in-place',
      title: 'Edit this version in place',
      desc: canEditInPlace
        ? `Changes overwrite "${versionLabel}". No new version is created.`
        : 'Unavailable: no saved version is loaded to overwrite. Create a new version instead.',
      disabled: !canEditInPlace,
    },
    {
      value: 'different',
      title: 'Edit a different version',
      desc: 'Pick an existing version from history, then edit that one in place.',
    },
    {
      value: 'create-new',
      title: 'Create a new version to work in',
      desc: 'Branch a brand-new version from the current state, leaving this one untouched.',
    },
  ];

  const content = (
    <div
      className="pm-modal-overlay"
      data-testid="edit-choice-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-choice-modal-title"
      style={{ zIndex: 9500 }}
    >
      <div className="pm-modal" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
        <div className="pm-modal-header">
          <div>
            <div id="edit-choice-modal-title" style={{ fontSize: '15px', fontWeight: 700 }}>
              ✏️ Edit model
            </div>
            <div style={{ fontSize: '11px', color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)', marginTop: '2px' }}>
              {projectName ?? 'No project selected'}
            </div>
          </div>
          <button
            onClick={onCancel}
            data-testid="edit-choice-modal-close"
            style={{ background: 'color-mix(in srgb, var(--color-on-primary-navy) 10%, transparent)', border: 'none', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--color-on-primary-navy)', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ✕
          </button>
        </div>

        <div className="pm-modal-body">
          {/* Current version, shown clearly so the user confirms what they edit. */}
          <div
            data-testid="edit-choice-current-version"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: 'var(--sp-2)',
              fontSize: '12px',
            }}
          >
            <span style={{ color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Current version</span>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--color-heading)', wordBreak: 'break-all', marginTop: 2 }}>
              {currentVersionName && currentVersionName.trim().length > 0 ? currentVersionName : '(unnamed / unsaved draft)'}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.map((opt) => {
              const selected = choice === opt.value;
              return (
                <label
                  key={opt.value}
                  data-testid={`edit-choice-option-${opt.value}`}
                  aria-disabled={opt.disabled ? true : undefined}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    padding: '10px 12px',
                    border: selected ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    background: selected ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : 'transparent',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    opacity: opt.disabled ? 0.55 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name="edit-choice"
                    value={opt.value}
                    checked={selected}
                    disabled={opt.disabled}
                    onChange={() => setChoice(opt.value)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-heading)', fontSize: 'var(--font-body)' }}>{opt.title}</span>
                    <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-muted)', marginTop: 2 }}>{opt.desc}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="pm-modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel} data-testid="edit-choice-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onChoose(choice)}
            data-testid="edit-choice-continue"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
