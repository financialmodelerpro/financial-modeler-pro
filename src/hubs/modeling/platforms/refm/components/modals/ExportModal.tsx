'use client';

/**
 * ExportModal.tsx
 *
 * Export picker for the REFM platform. Two steps:
 *   1. Format grid (PDF full report is live; the rest are flagged as upcoming,
 *      Excel is the next pass).
 *   2. Module selection: pick which modules to include AND, per module, which
 *      of Inputs / Outputs / Schedules to render, then Generate PDF. The module
 *      list is driven from the MODULES registry (modules-config.ts), not
 *      hardcoded, so new modules auto-appear here when they ship. Default = all
 *      enabled modules with all three parts. The Cover + Project Description
 *      pages are mandatory and always rendered.
 *
 * The PDF itself is rendered by lib/pdf/generateProjectPdf.ts, which reads the
 * same store state the UI reads (no new calculations). pdf-lib is imported
 * lazily so it stays out of the initial bundle.
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { MODULES } from '../../lib/modules-config';
import { useModule1Store } from '../../lib/state/module1-store';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  canAccess?: (featureKey: string) => boolean;
  projectName?: string | null;
  versionLabel?: string | null;
}

// Modules that currently have a PDF exporter wired (lib/pdf/generateProjectPdf).
// A module not in this set still appears in the picker (so the list stays
// registry-driven) but is disabled with a "no export yet" hint.
const EXPORTABLE = new Set(['module1', 'module2', 'module3', 'module4', 'module5']);

export default function ExportModal({
  open,
  onClose,
  projectName,
  versionLabel,
}: ExportModalProps): React.JSX.Element | null {
  const [step, setStep] = useState<'options' | 'modules'>('options');
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODULES.filter((m) => !m.disabled && EXPORTABLE.has(m.key)).map((m) => [m.key, true])),
  );
  // Per-module Inputs / Outputs / Schedules toggles. Default all on.
  const [sections, setSections] = useState<Record<string, { inputs: boolean; outputs: boolean; schedules: boolean }>>(() =>
    Object.fromEntries(MODULES.filter((m) => EXPORTABLE.has(m.key)).map((m) => [m.key, { inputs: true, outputs: true, schedules: true }])),
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const close = (): void => { setStep('options'); setError(null); onClose(); };

  // Registry-driven module rows: every enabled module appears; ones without an
  // exporter yet are shown disabled so the list is honest + future-proof.
  const moduleRows = MODULES.filter((m) => !m.disabled || EXPORTABLE.has(m.key));

  const toggle = (key: string): void => setSelected((s) => ({ ...s, [key]: !s[key] }));
  const togglePart = (key: string, part: 'inputs' | 'outputs' | 'schedules'): void =>
    setSections((s) => ({ ...s, [key]: { ...(s[key] ?? { inputs: true, outputs: true, schedules: true }), [part]: !(s[key]?.[part] ?? true) } }));
  const selectedKeys = moduleRows.filter((m) => EXPORTABLE.has(m.key) && selected[m.key]).map((m) => m.key);

  const handleGenerate = async (): Promise<void> => {
    setError(null);
    setGenerating(true);
    try {
      const { generateProjectPdf } = await import('../../lib/pdf/generateProjectPdf');
      const state = useModule1Store.getState();
      const name = projectName || state.project?.name || 'Project';
      const dateLabel = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      const bytes = await generateProjectPdf({
        state,
        projectName: name,
        versionLabel: versionLabel ?? null,
        dateLabel,
        selectedModuleKeys: selectedKeys,
        moduleSections: Object.fromEntries(selectedKeys.map((k) => [k, sections[k] ?? { inputs: true, outputs: true, schedules: true }])),
      });
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || 'project';
      a.download = `${safeName}_report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 24px 16px', borderBottom: '1px solid var(--color-border)',
  };

  const content = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'color-mix(in srgb, var(--color-heading) 55%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      data-testid="export-modal"
    >
      <div
        style={{
          background: 'var(--color-surface)', borderRadius: 14, boxShadow: 'var(--shadow-modal)',
          width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', fontFamily: 'Inter, sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-heading)' }}>
              {step === 'options' ? 'Export' : 'Export PDF, Select Modules'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-meta)', marginTop: 2 }}>
              {step === 'options' ? 'Choose an export format' : 'Pick the modules to include in the report'}
            </div>
          </div>
          <button
            onClick={close}
            data-testid="export-modal-close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 20, lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        </div>

        {step === 'options' && (
          <div style={{ padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              data-testid="export-option-pdf_full"
              onClick={() => setStep('modules')}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px',
                borderRadius: 8, border: '1.5px solid var(--color-navy)', background: 'var(--color-navy-pale, #F4F7FC)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 22 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>PDF, Full Report</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>All inputs &amp; outputs, module by module, platform-styled</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-on-primary-navy)', background: 'var(--color-primary)', padding: '5px 12px', borderRadius: 6 }}>Continue</span>
            </button>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', padding: '8px 4px 0' }}>
              Excel export (static values + live formula model) is the next pass.
            </div>
          </div>
        )}

        {step === 'modules' && (
          <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', padding: '0 2px 4px' }}>
              The Cover and Project Description pages are always included. Pick modules and which parts of each to render.
            </div>
            {moduleRows.map((m) => {
              const exportable = EXPORTABLE.has(m.key);
              const checked = exportable && !!selected[m.key];
              const sec = sections[m.key] ?? { inputs: true, outputs: true, schedules: true };
              return (
                <div
                  key={m.key}
                  data-testid={`export-module-${m.key}`}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 8, padding: '9px 12px', borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    background: checked ? 'var(--color-navy-pale, #F4F7FC)' : 'var(--color-surface)',
                    opacity: exportable ? 1 : 0.5,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: exportable ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={checked} disabled={!exportable} onChange={() => exportable && toggle(m.key)} />
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>Module {m.num}, {m.shortLabel}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{exportable ? m.longLabel : 'Export coming with this module'}</div>
                    </div>
                  </label>
                  {exportable && checked && (
                    <div style={{ display: 'flex', gap: 8, paddingLeft: 30 }}>
                      {(['inputs', 'outputs', 'schedules'] as const).map((part) => (
                        <label
                          key={part}
                          data-testid={`export-part-${m.key}-${part}`}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                            color: sec[part] ? 'var(--color-navy)' : 'var(--color-muted)',
                            border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 8px',
                            background: sec[part] ? 'var(--color-surface)' : 'transparent', cursor: 'pointer', textTransform: 'capitalize',
                          }}
                        >
                          <input type="checkbox" checked={sec[part]} onChange={() => togglePart(m.key, part)} />
                          {part}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {error && (
              <div role="alert" data-testid="export-modal-error" style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--color-heading)' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <button type="button" onClick={() => setStep('options')} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                ← Back
              </button>
              <button
                type="button"
                data-testid="export-generate-pdf"
                onClick={handleGenerate}
                disabled={generating || selectedKeys.length === 0}
                style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--color-on-primary-navy)',
                  background: selectedKeys.length === 0 ? 'var(--color-grey-mid)' : 'var(--color-primary)',
                  padding: '8px 18px', borderRadius: 8, border: 'none',
                  cursor: generating || selectedKeys.length === 0 ? 'default' : 'pointer',
                  opacity: generating ? 0.7 : 1,
                }}
              >
                {generating ? 'Generating…' : `Generate PDF (${selectedKeys.length})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
