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
import { useModule1Store, modelFromSnapshot, pickModel } from '../../lib/state/module1-store';
import { hydrationFromAnySnapshot } from '../../lib/state/module1-migrate';
import { applyOverrides, buildOverrides, baseCaseId, normaliseCases } from '../../lib/cases/applyOverrides';
import { PDF_MODULE_TABS } from '../../lib/pdf/pdfModuleTabs';
import { listVersions, loadVersion } from '../../lib/persistence/client';
import type { RefmProjectVersionListItem } from '../../lib/persistence/types';
import type { HydrateSnapshot } from '../../lib/state/module1-store';
import type { ProjectCase } from '../../lib/state/module1-types';
import type { CaseComparisonInput } from '../../lib/reports/caseComparisonReport';

// Built modules (full content). Others render a roadmap placeholder page.
const BUILT = new Set(['module1', 'module2', 'module3', 'module4', 'module5']);

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

/** Build the live (possibly unsaved) model from the store, for case resolution. */
function liveModelFromStore(): HydrateSnapshot {
  return pickModel(useModule1Store.getState() as unknown as Record<string, unknown>);
}

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

  // Every module is selectable: built ones render content, future ones render a
  // roadmap placeholder so the report covers the whole platform. Default all on.
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODULES.map((m) => [m.key, true])),
  );
  // Per-module Inputs / Outputs / Schedules toggles. Default all on.
  const [sections, setSections] = useState<Record<string, { inputs: boolean; outputs: boolean; schedules: boolean }>>(() =>
    Object.fromEntries(MODULES.filter((m) => BUILT.has(m.key)).map((m) => [m.key, { inputs: true, outputs: true, schedules: true }])),
  );
  // Per-module tab selection. A module key maps to the set of tabs to include;
  // default = all of that module's tabs (from the static manifest). Drilling
  // below part level lets the user export only specific statements / tabs.
  const [selectedTabs, setSelectedTabs] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(MODULES.filter((m) => BUILT.has(m.key)).map((m) => [m.key, [...(PDF_MODULE_TABS[m.key] ?? [])]])),
  );
  // Which tabs are expanded for editing in the UI (collapsed by default to keep
  // the list compact).
  const [tabsOpen, setTabsOpen] = useState<Record<string, boolean>>({});
  // PDF display scale (default Millions for readability on large projects).
  const [pdfScale, setPdfScale] = useState<'thousands' | 'millions' | 'full'>('millions');
  // Decimal places for figures. Default 1 (matches the millions default).
  const [pdfDecimals, setPdfDecimals] = useState<0 | 1 | 2>(1);
  // Case picker: which case the report renders. Cases come from the live store.
  const cases: ProjectCase[] = normaliseCases(useModule1Store.getState().cases);
  const storeActiveCaseId = useModule1Store.getState().activeCaseId;
  const [selectedCaseId, setSelectedCaseId] = useState<string>(storeActiveCaseId);
  // Full detailed PDF, concise executive-summary PDF, or the Excel model.
  const [reportKind, setReportKind] = useState<'full' | 'summary' | 'excel'>('full');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const close = (): void => { setStep('options'); setError(null); onClose(); };

  // Registry-driven module rows: EVERY module appears. Built modules render full
  // content; future modules render a roadmap placeholder page.
  const moduleRows = MODULES;

  const toggle = (key: string): void => setSelected((s) => ({ ...s, [key]: !s[key] }));
  const togglePart = (key: string, part: 'inputs' | 'outputs' | 'schedules'): void =>
    setSections((s) => ({ ...s, [key]: { ...(s[key] ?? { inputs: true, outputs: true, schedules: true }), [part]: !(s[key]?.[part] ?? true) } }));
  const toggleTab = (key: string, tab: string): void =>
    setSelectedTabs((s) => {
      const cur = s[key] ?? [...(PDF_MODULE_TABS[key] ?? [])];
      const next = cur.includes(tab) ? cur.filter((t) => t !== tab) : [...cur, tab];
      return { ...s, [key]: next };
    });
  const selectedKeys = moduleRows.filter((m) => selected[m.key]).map((m) => m.key);

  const handleGenerate = async (): Promise<void> => {
    setError(null);
    setGenerating(true);
    try {
      const { generateProjectPdf, generateSummaryPdf } = await import('../../lib/pdf/generateProjectPdf');
      // Resolve the state + naming for the chosen version. "Current" exports the
      // live working draft; a saved version is loaded (pure, never touches the
      // live store). For both, the chosen case's model is resolved (base +
      // overrides) and a comparison bundle of every case is assembled.
      let state: Parameters<typeof generateProjectPdf>[0]['state'];
      let caseComparison: CaseComparisonInput;
      let name = projectName || useModule1Store.getState().project?.name || 'Project';
      let pdfVersionLabel = versionLabel ?? null;
      let fileBase = name;
      if (selectedVersionId !== CURRENT && projectId) {
        const res = await loadVersion(projectId, selectedVersionId);
        if (res.error || !res.data?.version) throw new Error(res.error || 'Could not load the selected version.');
        const row = res.data.version;
        // Migrate the persisted snapshot to the current schema (same pipeline
        // the store uses on load). Its top-level fields are the base model; cases
        // carry the scenario overrides.
        const migrated = hydrationFromAnySnapshot(row.snapshot);
        const vCases = normaliseCases(migrated.cases);
        const vActiveId = migrated.activeCaseId && vCases.some((c) => c.id === migrated.activeCaseId) ? migrated.activeCaseId : baseCaseId(vCases);
        const vBase = pickModel(migrated as unknown as Record<string, unknown>);
        const chosen = vCases.find((c) => c.id === selectedCaseId);
        // Picker untouched / case not in this version -> the version's own active
        // model (original behaviour); otherwise the chosen case's model.
        state = (chosen
          ? (chosen.role === 'base' ? vBase : applyOverrides(vBase, chosen.overrides))
          : modelFromSnapshot(migrated)) as typeof state;
        caseComparison = { baseModel: vBase, cases: vCases, activeCaseId: vActiveId };
        const vName = versionDisplayName(row);
        name = migrated.project?.name || projectName || name;
        pdfVersionLabel = row.version_label ? `v${row.version_label}` : (row.label ?? versionLabel ?? null);
        // The downloaded file is named after the version it came from.
        fileBase = vName;
      } else {
        const st = useModule1Store.getState();
        const live = liveModelFromStore();
        const storeCases = normaliseCases(st.cases);
        const activeId = st.activeCaseId;
        const activeIsBase = activeId === baseCaseId(storeCases);
        const baseModel: HydrateSnapshot = activeIsBase ? live : (st.baseSnapshot as HydrateSnapshot);
        const activeOverrideCount = activeIsBase ? 0 : Object.keys(buildOverrides(st.baseSnapshot, live)).length;
        const chosen = storeCases.find((c) => c.id === selectedCaseId) ?? storeCases.find((c) => c.role === 'base');
        state = (!chosen || chosen.id === activeId
          ? live
          : chosen.role === 'base' ? baseModel : applyOverrides(baseModel, chosen.overrides)) as typeof state;
        caseComparison = { baseModel, cases: storeCases, activeCaseId: activeId, liveActiveModel: live, activeOverrideCount };
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

      const common = { state, projectName: name, versionLabel: pdfVersionLabel, dateLabel, displayScale: pdfScale, displayDecimals: pdfDecimals };
      // Per-tab selection: only pass for built + selected modules (placeholders
      // have no tabs). renderModule filters emitted tabs to the listed set.
      const moduleTabs: Record<string, string[]> = {};
      for (const k of selectedKeys) if (BUILT.has(k) && selectedTabs[k]) moduleTabs[k] = selectedTabs[k];
      const bytes = reportKind === 'summary'
        ? await generateSummaryPdf({ ...common, selectedModuleKeys: [] })
        : await generateProjectPdf({
            ...common,
            selectedModuleKeys: selectedKeys,
            moduleSections: Object.fromEntries(selectedKeys.filter((k) => BUILT.has(k)).map((k) => [k, sections[k] ?? { inputs: true, outputs: true, schedules: true }])),
            moduleTabs,
            caseComparison,
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
                  : 'The Cover and Executive Summary pages are always included. Pick modules and, per module, which parts (Inputs / Outputs / Schedules) and tabs to render. Modules still in development export a roadmap placeholder so the report covers the whole platform.'}
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
            <div style={{ display: reportKind === 'excel' ? 'none' : 'flex', alignItems: 'center', gap: 8, padding: '0 2px 8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)' }}>Number scale:</span>
              {(['thousands', 'millions', 'full'] as const).map((s) => (
                <label key={s} data-testid={`export-scale-${s}`} style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 10px', textTransform: 'capitalize',
                  color: pdfScale === s ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
                  background: pdfScale === s ? 'var(--color-navy)' : 'var(--color-surface)',
                }}>
                  <input type="radio" name="pdf-scale" checked={pdfScale === s} onChange={() => setPdfScale(s)} style={{ display: 'none' }} />
                  {s === 'full' ? 'Full' : s}
                </label>
              ))}
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)', marginLeft: 8 }}>Decimals:</span>
              {([0, 1, 2] as const).map((d) => (
                <label key={d} data-testid={`export-decimals-${d}`} style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 10px',
                  color: pdfDecimals === d ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
                  background: pdfDecimals === d ? 'var(--color-navy)' : 'var(--color-surface)',
                }}>
                  <input type="radio" name="pdf-decimals" checked={pdfDecimals === d} onChange={() => setPdfDecimals(d)} style={{ display: 'none' }} />
                  {d}
                </label>
              ))}
            </div>
            {reportKind !== 'excel' && cases.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)' }}>Case:</span>
                <select
                  data-testid="export-case-select"
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--color-heading)',
                    border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 8px',
                    background: 'var(--color-surface)', maxWidth: 320, cursor: 'pointer',
                  }}
                >
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.role === 'base' ? `${c.name} (base)` : c.name}</option>
                  ))}
                </select>
                <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>The report renders this case; Module 5 compares all cases.</span>
              </div>
            )}
            {reportKind === 'full' && moduleRows.map((m) => {
              const built = BUILT.has(m.key);
              const checked = !!selected[m.key];
              const sec = sections[m.key] ?? { inputs: true, outputs: true, schedules: true };
              const tabs = PDF_MODULE_TABS[m.key] ?? [];
              const tabSel = selectedTabs[m.key] ?? tabs;
              const open = !!tabsOpen[m.key];
              return (
                <div
                  key={m.key}
                  data-testid={`export-module-${m.key}`}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 8, padding: '9px 12px', borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    background: checked ? 'var(--color-navy-pale, #F4F7FC)' : 'var(--color-surface)',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(m.key)} />
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>Module {m.num}, {m.shortLabel}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                        {built ? m.longLabel : `${m.longLabel} · roadmap placeholder (${m.disabledReason ?? 'coming soon'})`}
                      </div>
                    </div>
                  </label>
                  {built && checked && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 30 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                        {tabs.length > 0 && (
                          <button
                            type="button"
                            data-testid={`export-tabs-toggle-${m.key}`}
                            onClick={() => setTabsOpen((o) => ({ ...o, [m.key]: !o[m.key] }))}
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--color-navy)' }}
                          >
                            {open ? '▾ Tabs' : `▸ Tabs (${tabSel.length}/${tabs.length})`}
                          </button>
                        )}
                      </div>
                      {open && tabs.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' }}>
                          {tabs.map((t) => (
                            <label key={t} data-testid={`export-tab-${m.key}-${t}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: tabSel.includes(t) ? 'var(--color-heading)' : 'var(--color-muted)', cursor: 'pointer' }}>
                              <input type="checkbox" checked={tabSel.includes(t)} onChange={() => toggleTab(m.key, t)} />
                              {t}
                            </label>
                          ))}
                        </div>
                      )}
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
