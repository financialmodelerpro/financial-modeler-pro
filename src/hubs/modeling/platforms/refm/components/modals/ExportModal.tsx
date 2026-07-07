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
import { REFM_PLATFORM_SLUG } from '../../lib/usePlatformModules';
import { moduleComponentNumber } from '@/src/shared/entitlements/moduleCatalog';
import { useModule1Store, modelFromSnapshot, pickModel } from '../../lib/state/module1-store';
import { hydrationFromAnySnapshot } from '../../lib/state/module1-migrate';
import { applyOverrides, buildOverrides, baseCaseId, normaliseCases } from '../../lib/cases/applyOverrides';
import { PDF_MODULE_TABS } from '../../lib/pdf/pdfModuleTabs';
import { listVersions, loadVersion } from '../../lib/persistence/client';
import type { RefmProjectVersionListItem } from '../../lib/persistence/types';
import type { HydrateSnapshot } from '../../lib/state/module1-store';
import type { ProjectCase } from '../../lib/state/module1-types';
import type { CaseComparisonInput } from '../../lib/reports/caseComparisonReport';

// Modules with a real PDF builder (full content). A selected module NOT in this
// set still exports, as a roadmap placeholder page. Kept as a code fact (does a
// builder exist) separate from the DB `status` (which drives active vs coming).
const BUILT = new Set(['module1', 'module2', 'module3', 'module4', 'module5', 'module6']);

// One export row, derived from the live platform_modules registry (same source as
// the sidebar) so the export list auto-links to what is active / coming and to
// the admin's per-module "Include in PDF" choice. `key` is the moduleN routing
// key the PDF builders + PDF_MODULE_TABS use; `live` (status === 'live') decides
// whether the row is selectable, mirroring the sidebar.
interface ExportModuleRow {
  key: string;
  displayNum: number;
  icon: string;
  shortLabel: string;
  longLabel: string;
  live: boolean;
}

// Raw platform_modules row shape from GET /api/platforms/[slug]/modules.
interface FetchedExportModule {
  slug: string;
  number: number;
  name: string;
  short_name: string;
  icon_emoji: string | null;
  status: string;
  include_in_pdf?: boolean;
}

/** Offline / pre-fetch fallback: the built modules, all treated as live, so the
 *  modal still works if the registry fetch fails. */
function fallbackExportModules(): ExportModuleRow[] {
  return MODULES.filter((m) => BUILT.has(m.key)).map((m, i) => ({
    key: m.key, displayNum: i + 1, icon: m.icon, shortLabel: m.shortLabel, longLabel: m.longLabel, live: true,
  }));
}

/** Map live registry rows -> export rows: drop hidden + admin-excluded (include_in_pdf
 *  false), key by the moduleN routing key, and carry status -> live. Order follows
 *  the registry (display_order). */
function toExportRows(mods: FetchedExportModule[]): ExportModuleRow[] {
  return mods
    .filter((m) => m.include_in_pdf !== false && m.status !== 'hidden')
    .map((m, i) => {
      const key = `module${moduleComponentNumber(m.slug, m.number)}`;
      const stat = MODULES.find((x) => x.key === key);
      return {
        key,
        displayNum: i + 1,
        icon: m.icon_emoji || stat?.icon || '·',
        shortLabel: m.short_name || stat?.shortLabel || m.name,
        longLabel: m.name || stat?.longLabel || '',
        live: m.status === 'live',
      };
    });
}

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  canAccess?: (featureKey: string) => boolean;
  /** True when the workspace is in read-only GRACE (plan expired, within the
   *  1-month grace). Export is denied: the live app generates files client-side,
   *  so this is the genuine enforcement point (the export API routes also guard). */
  readOnly?: boolean;
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

// Which entitlement feature each export format requires. PDF reports gate on
// pdf_export; the Excel model is the formula-linked workbook, gating on
// excel_formula. (A future snapshot-only Excel export would gate on
// excel_snapshot.)
const FEATURE_FOR_KIND: Record<'full' | 'summary' | 'excel', string> = {
  full: 'pdf_export',
  summary: 'pdf_export',
  excel: 'excel_formula',
};

export default function ExportModal({
  open,
  onClose,
  canAccess,
  readOnly = false,
  projectId,
  projectName,
  versionLabel,
}: ExportModalProps): React.JSX.Element | null {
  // Plan gate, layered in. Defaults to allowed when no resolver is passed.
  const allows = (featureKey: string): boolean => (canAccess ? canAccess(featureKey) : true);
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
        // The version default stays "Current working draft" (set in the open
        // effect below) so the export reflects the LIVE active case. The saved
        // versions populate the dropdown for explicit selection.
      })
      .catch(() => { if (!cancelled) setVersions([]); })
      .finally(() => { if (!cancelled) setVersionsLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId]);

  // On open, follow the LIVE active case + current working draft so every export
  // defaults to exactly the case the user has active across the platform (the
  // topbar / Module 6 selection). Without this, the modal stays mounted and these
  // selections would freeze at their mount-time values, so an export after a case
  // switch would render the wrong (stale) case. The case / version pickers below
  // still let the user choose a different case or a saved version explicitly.
  useEffect(() => {
    if (!open) return;
    setSelectedCaseId(useModule1Store.getState().activeCaseId);
    setSelectedVersionId(CURRENT);
  }, [open]);

  // The export module list, auto-linked to the live platform_modules registry
  // (same source as the sidebar) so active / coming status and the admin's
  // per-module "Include in PDF" choice stay in sync. Starts from the built-module
  // fallback so the list never blanks, then the registry fetch replaces it.
  const [exportModules, setExportModules] = useState<ExportModuleRow[]>(fallbackExportModules);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/platforms/${REFM_PLATFORM_SLUG}/modules`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !Array.isArray(j.modules)) return;
        const rows = toExportRows(j.modules as FetchedExportModule[]);
        if (rows.length) setExportModules(rows);
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, [open]);

  // Only LIVE modules are selectable / exported; coming-soon rows appear greyed
  // (mirroring the sidebar). Default: every live module on, with all its tabs.
  // Re-derived whenever the module list changes (registry fetch resolves).
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Per-module tab selection. A module key maps to the set of tabs to include;
  // default = all of that module's tabs (from the static manifest). Drilling
  // below part level lets the user export only specific statements / tabs.
  const [selectedTabs, setSelectedTabs] = useState<Record<string, string[]>>({});
  // GROUP-level filter (top of the hierarchy): Inputs / Schedules / Output. These
  // apply across every selected module (via moduleSections) BEFORE the per-module
  // and per-tab checks, so the user can, e.g., export inputs-only across the whole
  // model. Default: all three on.
  const [groupSel, setGroupSel] = useState<{ inputs: boolean; outputs: boolean; schedules: boolean }>({ inputs: true, outputs: true, schedules: true });
  useEffect(() => {
    setSelected(Object.fromEntries(exportModules.map((m) => [m.key, m.live])));
    setSelectedTabs(Object.fromEntries(exportModules.filter((m) => m.live).map((m) => [m.key, [...(PDF_MODULE_TABS[m.key] ?? [])]])));
  }, [exportModules]);
  useEffect(() => { if (open) setGroupSel({ inputs: true, outputs: true, schedules: true }); }, [open]);
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

  // Registry-driven module rows (live + admin-included). Live modules are
  // selectable; coming-soon rows appear greyed.
  const moduleRows = exportModules;

  // Only live modules can be toggled; coming-soon rows stay unchecked.
  const toggle = (m: ExportModuleRow): void => {
    if (!m.live) return;
    setSelected((s) => ({ ...s, [m.key]: !s[m.key] }));
  };
  const toggleTab = (key: string, tab: string): void =>
    setSelectedTabs((s) => {
      const cur = s[key] ?? [...(PDF_MODULE_TABS[key] ?? [])];
      const next = cur.includes(tab) ? cur.filter((t) => t !== tab) : [...cur, tab];
      return { ...s, [key]: next };
    });
  const selectedKeys = moduleRows.filter((m) => selected[m.key]).map((m) => m.key);

  const handleGenerate = async (): Promise<void> => {
    setError(null);
    // Read-only grace: export is denied entirely (the file is built client-side,
    // so this is the genuine enforcement point; the export API routes also guard).
    if (readOnly) {
      setError('Your subscription has expired. Access is read-only during the grace period, renew to export.');
      return;
    }
    // Entitlement gate for the chosen format. Server export paths are pure
    // client-side here, so this is the enforcement point for export access.
    const requiredFeature = FEATURE_FOR_KIND[reportKind];
    if (!allows(requiredFeature)) {
      setError(`This export format is not included in your current plan. Upgrade to unlock it.`);
      return;
    }
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
        const buf = await generateModelWorkbookBuffer({ state, projectName: name, dateLabel, displayScale: pdfScale, displayDecimals: pdfDecimals });
        triggerDownload(`${safeName}_Model.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        close();
        return;
      }

      const common = { state, projectName: name, versionLabel: pdfVersionLabel, dateLabel, displayScale: pdfScale, displayDecimals: pdfDecimals };
      // Per-tab selection: renderModule filters emitted tabs to the listed set.
      const moduleTabs: Record<string, string[]> = {};
      for (const k of selectedKeys) if (selectedTabs[k]) moduleTabs[k] = selectedTabs[k];
      // GROUP-level filter: apply the Inputs / Schedules / Output choice to every
      // selected module (the top of the filter hierarchy). renderModule ANDs this
      // part filter with the per-tab selection.
      const moduleSections: Record<string, { inputs: boolean; outputs: boolean; schedules: boolean }> = {};
      for (const k of selectedKeys) moduleSections[k] = { ...groupSel };
      const bytes = reportKind === 'summary'
        ? await generateSummaryPdf({ ...common, selectedModuleKeys: [], caseComparison })
        : await generateProjectPdf({
            ...common,
            selectedModuleKeys: selectedKeys,
            moduleTabs,
            moduleSections,
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
              onClick={() => { if (!allows('pdf_export')) { setError('PDF export is not included in your current plan. Upgrade to unlock it.'); return; } setReportKind('full'); setStep('modules'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px',
                borderRadius: 8, border: '1.5px solid var(--color-navy)', background: 'var(--color-navy-pale, #F4F7FC)',
                cursor: 'pointer', textAlign: 'left', opacity: allows('pdf_export') ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 22 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>PDF, Full Financial Model</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>All inputs &amp; outputs, module by module, platform-styled</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-on-primary-navy)', background: 'var(--color-primary)', padding: '5px 12px', borderRadius: 6 }}>{allows('pdf_export') ? 'Continue' : '🔒 Upgrade'}</span>
            </button>
            <button
              type="button"
              data-testid="export-option-pdf_summary"
              onClick={() => { if (!allows('pdf_export')) { setError('PDF export is not included in your current plan. Upgrade to unlock it.'); return; } setReportKind('summary'); setStep('modules'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px',
                borderRadius: 8, border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                cursor: 'pointer', textAlign: 'left', opacity: allows('pdf_export') ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 22 }}>📈</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>PDF, Executive Summary</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>Key inputs, headline P&amp;L / cash flow / balance sheet, and returns, on a few pages</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)', border: '1px solid var(--color-border)', padding: '5px 12px', borderRadius: 6 }}>{allows('pdf_export') ? 'Continue' : '🔒 Upgrade'}</span>
            </button>
            <button
              type="button"
              data-testid="export-option-excel"
              onClick={() => { if (!allows('excel_formula')) { setError('Excel export is not included in your current plan. Upgrade to unlock it.'); return; } setReportKind('excel'); setStep('modules'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px',
                borderRadius: 8, border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                cursor: 'pointer', textAlign: 'left', opacity: allows('excel_formula') ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 22 }}>📗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>Excel Model</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>Hardcoded platform mirror: every figure is the platform-computed value as a constant, across all tabs (Inputs, Capex, Financing, statements, Returns)</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)', border: '1px solid var(--color-border)', padding: '5px 12px', borderRadius: 6 }}>{allows('excel_formula') ? 'Continue' : '🔒 Upgrade'}</span>
            </button>
          </div>
        )}

        {step === 'modules' && (
          <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', padding: '0 2px 4px' }}>
              {reportKind === 'excel'
                ? 'The Excel model is a hardcoded mirror of the platform: one consolidated Inputs tab plus a tab per module (Timeline, Land & Area, Capex, Revenue, Cost of Sales, Opex, Financing, P&L, Cash Flow, Balance Sheet, Returns, Checks). Every figure is the platform-computed value written as a constant; editing a cell does not recalculate, re-export after changing inputs. Pick the scale and version below.'
                : reportKind === 'summary'
                  ? 'The Executive Summary report includes the cover, executive summary, key inputs (phases), the headline P&L / cash flow / balance sheet, and returns. Pick the number scale and version below.'
                  : 'The Cover and Executive Summary pages are always included. First choose the sections (Inputs / Schedules / Output) to include across the whole model, then pick the live modules, and use Tabs to include for specific tabs per module. The module list mirrors the platform; modules still in development show greyed until they go live.'}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)' }}>Number scale:</span>
              {(['thousands', 'millions', 'full'] as const).map((s) => (
                <label key={s} data-testid={`export-scale-${s}`} style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 10px', textTransform: 'capitalize',
                  color: pdfScale === s ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
                  background: pdfScale === s ? 'var(--color-navy)' : 'var(--color-surface)',
                }}>
                  <input type="radio" name="pdf-scale" checked={pdfScale === s} onChange={() => { setPdfScale(s); if (reportKind === 'excel') setPdfDecimals(s === 'millions' ? 1 : 0); }} style={{ display: 'none' }} />
                  {s === 'full' ? 'Full' : s}
                </label>
              ))}
              {/* Money decimals (display only). Excel: default 0 for full / thousands,
                  1 for millions; percentages stay 2 decimals regardless. */}
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
                <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>The report renders this case; Modules 5 &amp; 6 compare all cases.</span>
              </div>
            )}
            {reportKind === 'full' && (
              <div data-testid="export-groups" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)' }}>Sections to include (applies to every module)</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {([['inputs', 'Inputs'], ['schedules', 'Schedules'], ['outputs', 'Output']] as const).map(([k, label]) => (
                    <label key={k} data-testid={`export-group-${k}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: groupSel[k] ? 'var(--color-heading)' : 'var(--color-muted)' }}>
                      <input type="checkbox" checked={groupSel[k]} onChange={() => setGroupSel((g) => ({ ...g, [k]: !g[k] }))} />
                      {label}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>Filters what renders in every module first; the per-module and per-tab choices below still apply.</div>
              </div>
            )}
            {reportKind === 'full' && moduleRows.map((m) => {
              const live = m.live;
              const checked = !!selected[m.key];
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
                    opacity: live ? 1 : 0.55,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: live ? 'pointer' : 'not-allowed' }}>
                    <input type="checkbox" checked={live && checked} disabled={!live} onChange={() => toggle(m)} style={{ cursor: live ? 'pointer' : 'not-allowed' }} />
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        Module {m.displayNum}, {m.shortLabel}
                        {!live && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-muted)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '1px 8px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                            Coming soon
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                        {live ? m.longLabel : `${m.longLabel} · available to export once live`}
                      </div>
                    </div>
                  </label>
                  {live && checked && tabs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 30 }}>
                      <button
                        type="button"
                        data-testid={`export-tabs-toggle-${m.key}`}
                        onClick={() => setTabsOpen((o) => ({ ...o, [m.key]: !o[m.key] }))}
                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--color-navy)' }}
                      >
                        {open ? '▾ Tabs to include' : `▸ Tabs to include (${tabSel.length}/${tabs.length})`}
                      </button>
                      {open && (
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
