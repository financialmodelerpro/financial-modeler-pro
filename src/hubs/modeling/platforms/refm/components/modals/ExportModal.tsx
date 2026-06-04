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

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MODULES } from '../../lib/modules-config';
import { useModule1Store, modelFromSnapshot } from '../../lib/state/module1-store';
import { hydrationFromAnySnapshot } from '../../lib/state/module1-migrate';
import { listVersions, loadVersion } from '../../lib/persistence/client';
import type { RefmProjectVersionListItem } from '../../lib/persistence/types';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  canAccess?: (featureKey: string) => boolean;
  projectId?: string | null;
  projectName?: string | null;
  versionLabel?: string | null;
}

const CURRENT = '__current__';

function triggerDownload(filename: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Display name for a saved version (used in the picker AND as the PDF filename
 *  base, so a downloaded report is named after the version it came from). */
function versionDisplayName(v: RefmProjectVersionListItem): string {
  if (v.label && v.label.trim()) return v.label.trim();
  if (v.version_label) return `v${v.version_label}${v.task_name ? ` ${v.task_name}` : ''}`;
  return `Version ${v.version_number}`;
}

// Modules that currently have a PDF exporter wired (lib/pdf/generateProjectPdf).
// A module not in this set still appears in the picker (so the list stays
// registry-driven) but is disabled with a "no export yet" hint.
const EXPORTABLE = new Set(['module1', 'module2', 'module3', 'module4', 'module5']);

export default function ExportModal({
  open,
  onClose,
  projectId,
  projectName,
  versionLabel,
}: ExportModalProps): React.JSX.Element | null {
  const [step, setStep] = useState<'options' | 'modules'>('options');
  // Version picker: which saved version's data to export. Defaults to the most
  // recent saved version (so the PDF matches the last version saved); the user
  // can pick any version, or "current working draft" for unsaved edits.
  const [versions, setVersions] = useState<RefmProjectVersionListItem[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>(CURRENT);
  const [versionsLoading, setVersionsLoading] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setVersionsLoading(true);
    listVersions(projectId)
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.versions ?? [];
        setVersions(list);
        // Default to the latest saved version (list is newest-first).
        setSelectedVersionId(list.length ? list[0].id : CURRENT);
      })
      .catch(() => { if (!cancelled) setVersions([]); })
      .finally(() => { if (!cancelled) setVersionsLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId]);

  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODULES.filter((m) => !m.disabled && EXPORTABLE.has(m.key)).map((m) => [m.key, true])),
  );
  // Per-module Inputs / Outputs / Schedules toggles. Default all on.
  const [sections, setSections] = useState<Record<string, { inputs: boolean; outputs: boolean; schedules: boolean }>>(() =>
    Object.fromEntries(MODULES.filter((m) => EXPORTABLE.has(m.key)).map((m) => [m.key, { inputs: true, outputs: true, schedules: true }])),
  );
  // PDF display scale (default Millions for readability on large projects).
  const [pdfScale, setPdfScale] = useState<'thousands' | 'millions'>('millions');
  // Full detailed PDF, concise executive-summary PDF, or the Excel model.
  const [reportKind, setReportKind] = useState<'full' | 'summary' | 'excel'>('full');
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
      const { generateProjectPdf, generateSummaryPdf } = await import('../../lib/pdf/generateProjectPdf');
      // Resolve the state + naming for the chosen version. "Current" exports the
      // live working draft; a saved version is loaded + resolved to its
      // active-case model (pure, never touches the live store).
      let state = useModule1Store.getState() as Parameters<typeof generateProjectPdf>[0]['state'];
      let name = projectName || useModule1Store.getState().project?.name || 'Project';
      let pdfVersionLabel = versionLabel ?? null;
      let fileBase = name;
      if (selectedVersionId !== CURRENT && projectId) {
        const res = await loadVersion(projectId, selectedVersionId);
        if (res.error || !res.data?.version) throw new Error(res.error || 'Could not load the selected version.');
        const row = res.data.version;
        // Migrate the persisted snapshot to the current schema (same pipeline
        // the store uses on load), then resolve its active-case model, so a
        // legacy version exports exactly as it would if loaded into the UI.
        const migrated = hydrationFromAnySnapshot(row.snapshot);
        state = modelFromSnapshot(migrated) as typeof state;
        const vName = versionDisplayName(row);
        name = migrated.project?.name || projectName || name;
        pdfVersionLabel = row.version_label ? `v${row.version_label}` : (row.label ?? versionLabel ?? null);
        // The downloaded file is named after the version it came from.
        fileBase = vName;
      }
      const dateLabel = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      const safeName = fileBase.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80) || 'project';

      if (reportKind === 'excel') {
        const { generateModelWorkbookBuffer } = await import('../../lib/excel/buildModelWorkbook');
        const buf = await generateModelWorkbookBuffer({ state, projectName: name, dateLabel });
        triggerDownload(`${safeName}_Model.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        close();
        return;
      }

      const common = { state, projectName: name, versionLabel: pdfVersionLabel, dateLabel, displayScale: pdfScale };
      const bytes = reportKind === 'summary'
        ? await generateSummaryPdf({ ...common, selectedModuleKeys: [] })
        : await generateProjectPdf({
            ...common,
            selectedModuleKeys: selectedKeys,
            moduleSections: Object.fromEntries(selectedKeys.map((k) => [k, sections[k] ?? { inputs: true, outputs: true, schedules: true }])),
          });
      triggerDownload(`${safeName}${reportKind === 'summary' ? '_Summary' : ''}.pdf`, bytes as BlobPart, 'application/pdf');
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
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
              onClick={() => { setReportKind('full'); setStep('modules'); }}
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
            <button
              type="button"
              data-testid="export-option-pdf_summary"
              onClick={() => { setReportKind('summary'); setStep('modules'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px',
                borderRadius: 8, border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 22 }}>📈</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>PDF, Executive Summary</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>Key inputs, headline P&amp;L / cash flow / balance sheet, and returns, on a few pages</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)', border: '1px solid var(--color-border)', padding: '5px 12px', borderRadius: 6 }}>Continue</span>
            </button>
            <button
              type="button"
              data-testid="export-option-excel"
              onClick={() => { setReportKind('excel'); setStep('modules'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px',
                borderRadius: 8, border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 22 }}>📗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>Excel Model (beta)</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>Formula-driven workbook: Assumptions, Timeline and checks (calculation sheets are being added)</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)', border: '1px solid var(--color-border)', padding: '5px 12px', borderRadius: 6 }}>Continue</span>
            </button>
          </div>
        )}

        {step === 'modules' && (
          <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', padding: '0 2px 4px' }}>
              {reportKind === 'excel'
                ? 'The Excel model is a formula-driven workbook: a centralised Assumptions (inputs) sheet, a formula-linked Timeline, and a Checks/legend sheet, with the calculation and statement sheets being added. Pick the version to export below.'
                : reportKind === 'summary'
                  ? 'The Executive Summary report includes the cover, executive summary, key inputs (phases), the headline P&L / cash flow / balance sheet, and returns. Pick the number scale and version below.'
                  : 'The Cover and Executive Summary pages are always included. Pick modules and which parts of each to render.'}
            </div>
            {projectId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)' }}>Version:</span>
                <select
                  data-testid="export-version-select"
                  value={selectedVersionId}
                  onChange={(e) => setSelectedVersionId(e.target.value)}
                  disabled={versionsLoading}
                  style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--color-heading)',
                    border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 8px',
                    background: 'var(--color-surface)', maxWidth: 320, cursor: 'pointer',
                  }}
                >
                  <option value={CURRENT}>Current working draft (unsaved)</option>
                  {versions.map((v, i) => (
                    <option key={v.id} value={v.id}>
                      {versionDisplayName(v)}{i === 0 ? ' (latest saved)' : ''}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>
                  {versionsLoading ? 'Loading versions…' : 'The file is named after the chosen version.'}
                </span>
              </div>
            )}
            <div style={{ display: reportKind === 'excel' ? 'none' : 'flex', alignItems: 'center', gap: 8, padding: '0 2px 8px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)' }}>Number scale:</span>
              {(['thousands', 'millions'] as const).map((s) => (
                <label key={s} data-testid={`export-scale-${s}`} style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 10px', textTransform: 'capitalize',
                  color: pdfScale === s ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
                  background: pdfScale === s ? 'var(--color-navy)' : 'var(--color-surface)',
                }}>
                  <input type="radio" name="pdf-scale" checked={pdfScale === s} onChange={() => setPdfScale(s)} style={{ display: 'none' }} />
                  {s}
                </label>
              ))}
              <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>(Millions recommended)</span>
            </div>
            {reportKind === 'full' && moduleRows.map((m) => {
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
              {(() => {
                const disabled = generating || (reportKind === 'full' && selectedKeys.length === 0);
                return (
                  <button
                    type="button"
                    data-testid="export-generate-pdf"
                    onClick={handleGenerate}
                    disabled={disabled}
                    style={{
                      fontSize: 13, fontWeight: 700, color: 'var(--color-on-primary-navy)',
                      background: disabled && !generating ? 'var(--color-grey-mid)' : 'var(--color-primary)',
                      padding: '8px 18px', borderRadius: 8, border: 'none',
                      cursor: disabled ? 'default' : 'pointer',
                      opacity: generating ? 0.7 : 1,
                    }}
                  >
                    {generating ? 'Generating…' : reportKind === 'excel' ? 'Generate Excel Model' : reportKind === 'summary' ? 'Generate Summary PDF' : `Generate PDF (${selectedKeys.length})`}
                  </button>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
