'use client';

/**
 * Module7Reports.tsx (REFM Module 7 Reports, Phase 1 + 2)
 *
 * On-screen report PREVIEW only (no export yet, Phase 3 covers PPT/PDF). Three
 * report types share one pipeline:
 *   - financials auto from the computed snapshot (read-only, no recompute),
 *   - narrative + chrome + fonts from a per-project report-inputs form,
 *   - parties from M1 by role,
 *   - a pure per-report builder assembles a display model, rendered with brand
 *     styling, with per-report show/hide + reorder.
 *
 * IC Report (Phase 1) + Lender Package + Investor One-Pager (Phase 2). No engine
 * change: computeFinancialsSnapshot + computeReturnsSnapshot are the same pure
 * calls the Returns tab uses; this surface only reads them.
 *
 * No em dashes in this file.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store, type HydrateSnapshot } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { buildICReportModel, icVisibleSections, icScenarioChartRows, icFindingLine, IC_CHART_PALETTE, type ICReportModel } from '../../lib/reports/icReport';
import { buildLenderReportModel, type LenderReportModel, type LenderCovenantRow } from '../../lib/reports/lenderReport';
import { buildOnePagerReportModel, type OnePagerReportModel } from '../../lib/reports/onePagerReport';
import { buildCaseComparisonReport } from '../../lib/reports/caseComparisonReport';
import { buildOverrides, baseCaseId } from '../../lib/cases/applyOverrides';
import { listParties, getReportInputs, saveReportInputs } from '../../lib/persistence/client';
import type { Party } from '../../lib/parties';
import {
  REPORT_TYPES, ACTIVE_REPORT_TYPES, SECTIONS, FONT_CHOICES, KSA_REGULATORY_PRESET,
  defaultReportInputs, normalizeAllSectionConfigs, icMoneyScaleSpec,
  type ReportType, type ReportInputs, type ICSectionKey, type SectionSetting,
  type MarketStat, type MarketPoint, type RiskItem, type RegulatoryItem, type ExecPoint,
} from '../../lib/reportInputs';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { fmtPct, fmtX } from './Module5Shared';

// ── Brand palette. Navy / white / slate / pale + mid blue / green + red (fail). ──
const BRAND = {
  navy: '#1B4F8A',
  white: '#FFFFFF',
  slate: '#5A6675',
  pale: '#DDE7F3',
  mid: '#7FA8D9',
  green: '#2E7D52',
  red: '#DC2626',
  neg: '#B23A3A',
  border: '#C9D8EC',
};

// Linear blend between two '#rrggbb' colours (t: 0 -> a, 1 -> b). Sensitivity heatmap.
const blendHex = (a: string, b: string, t: number): string => {
  const cl = Math.max(0, Math.min(1, t));
  const ai = parseInt(a.slice(1), 16), bi = parseInt(b.slice(1), 16);
  const ch = (sh: number): number => { const av = (ai >> sh) & 0xff, bv = (bi >> sh) & 0xff; return Math.round(av + (bv - av) * cl); };
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

export default function Module7Reports({ activeProjectId = null }: { activeProjectId?: string | null } = {}): React.JSX.Element {
  const s = useModule1Store(
    useShallow((st) => ({
      project: st.project, phases: st.phases, parcels: st.parcels,
      landAllocationMode: st.landAllocationMode, assets: st.assets, subUnits: st.subUnits,
      costLines: st.costLines, costOverrides: st.costOverrides,
      financingTranches: st.financingTranches, equityContributions: st.equityContributions,
      migrationsApplied: st.migrationsApplied,
      cases: st.cases, activeCaseId: st.activeCaseId, baseSnapshot: st.baseSnapshot,
    })),
  );

  const scale: DisplayScale = (s.project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (s.project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(s.project.currency ?? 'SAR', scale);
  // Live model = the ACTIVE-case model (what the rest of the platform shows).
  // Base model = the Management (base) case model. The IC deck pins to Management
  // by default (see inputs.icDeckCase) so the base deck is stable regardless of
  // the active case; the scenario section still compares every case either way.
  const liveModel = useMemo<HydrateSnapshot>(() => ({
    project: s.project, phases: s.phases, parcels: s.parcels, landAllocationMode: s.landAllocationMode,
    assets: s.assets, subUnits: s.subUnits, costLines: s.costLines, costOverrides: s.costOverrides,
    financingTranches: s.financingTranches, equityContributions: s.equityContributions, migrationsApplied: s.migrationsApplied,
  }), [s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions, s.migrationsApplied]);
  const baseModel = useMemo<HydrateSnapshot>(() => {
    const activeIsBase = !s.cases || s.cases.length <= 1 || s.activeCaseId === baseCaseId(s.cases);
    return activeIsBase ? liveModel : (s.baseSnapshot ?? liveModel);
  }, [liveModel, s.cases, s.activeCaseId, s.baseSnapshot]);

  // Active-case snapshot (drives Lender + One-Pager, which follow the platform).
  const rsPair = useMemo(() => {
    const snap = computeFinancialsSnapshot(liveModel as never);
    return { snap, returns: computeReturnsSnapshot(snap, liveModel.project) };
  }, [liveModel]);

  const scenarios = useMemo(() => {
    if ((s.cases?.length ?? 0) <= 1) return null;
    const activeIsBase = s.activeCaseId === baseCaseId(s.cases);
    const activeOverrideCount = activeIsBase ? 0 : Object.keys(buildOverrides(s.baseSnapshot, liveModel)).length;
    return buildCaseComparisonReport({ baseModel, cases: s.cases, activeCaseId: s.activeCaseId, liveActiveModel: liveModel, activeOverrideCount });
  }, [baseModel, liveModel, s.cases, s.activeCaseId, s.baseSnapshot]);

  // ── Parties + report inputs (per project) ──
  const [parties, setParties] = useState<Party[]>([]);
  const [inputs, setInputs] = useState<ReportInputs>(defaultReportInputs());
  const [reportType, setReportType] = useState<ReportType>('ic');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!activeProjectId) { setParties([]); setInputs(defaultReportInputs()); setDirty(false); return; }
    void listParties(activeProjectId).then(({ data }) => { if (alive && data) setParties(data.parties); });
    void getReportInputs(activeProjectId).then(({ data }) => {
      if (!alive) return;
      setInputs(data?.inputs ? { ...data.inputs, sectionConfig: normalizeAllSectionConfigs(data.inputs.sectionConfig) } : defaultReportInputs());
      setDirty(false);
    });
    return () => { alive = false; };
  }, [activeProjectId]);

  const patch = useCallback((p: Partial<ReportInputs>) => { setInputs((prev) => ({ ...prev, ...p })); setDirty(true); }, []);

  const save = useCallback(async () => {
    if (!activeProjectId || saving) return;
    setSaving(true);
    const { data, error } = await saveReportInputs(activeProjectId, inputs);
    setSaving(false);
    if (error) { setNotice({ text: error, type: 'error' }); return; }
    if (data?.inputs) setInputs({ ...data.inputs, sectionConfig: normalizeAllSectionConfigs(data.inputs.sectionConfig) });
    setDirty(false);
    setNotice({ text: 'Report inputs saved.', type: 'success' });
    setTimeout(() => setNotice(null), 2600);
  }, [activeProjectId, inputs, saving]);

  // Active report's section config (per-report show/hide + order).
  const orderedSections = useMemo(
    () => [...(inputs.sectionConfig[reportType] ?? [])].sort((a, b) => a.order - b.order),
    [inputs.sectionConfig, reportType],
  );
  const setActiveSections = (list: SectionSetting[]): void =>
    patch({ sectionConfig: { ...inputs.sectionConfig, [reportType]: list.map((x, i) => ({ ...x, order: i })) } });
  const moveSection = (key: string, dir: -1 | 1): void => {
    const list = [...orderedSections];
    const i = list.findIndex((x) => x.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setActiveSections(list);
  };
  const toggleSection = (key: string): void =>
    setActiveSections(orderedSections.map((x) => (x.key === key ? { ...x, visible: !x.visible } : x)));

  const asOf = new Date().toISOString().slice(0, 10);

  // The IC deck numbers come from the pinned case (Management by default, or the
  // active case when icDeckCase === 'active'). Its own snapshot is computed here.
  const icSourceModel = inputs.icDeckCase === 'active' ? liveModel : baseModel;
  const icPair = useMemo(() => {
    const snap = computeFinancialsSnapshot(icSourceModel as never);
    return { snap, returns: computeReturnsSnapshot(snap, icSourceModel.project) };
  }, [icSourceModel]);

  // Scale-aware money formatter (millions default, or thousands) + unit note,
  // shared by IC tables/tiles and chart axes so the deck is consistent.
  const { fmtM, moneyUnit } = useMemo(() => {
    const spec = icMoneyScaleSpec(inputs.icMoneyScale, s.project.currency ?? 'SAR');
    const snapT = spec.decimals > 0 ? 0.05 : 0.5;
    const f = (v: number): string => {
      if (!Number.isFinite(v)) return 'n/a';
      const m = v / spec.divisor;
      if (Math.abs(m) < snapT) return (0).toFixed(spec.decimals);
      const t = Math.abs(m).toLocaleString('en-US', { minimumFractionDigits: spec.decimals, maximumFractionDigits: spec.decimals });
      return m < 0 ? `(${t})` : t;
    };
    return { fmtM: f, moneyUnit: spec.unit };
  }, [inputs.icMoneyScale, s.project.currency]);

  const icModel = useMemo(() => buildICReportModel({
    project: icSourceModel.project, phases: icSourceModel.phases, assets: icSourceModel.assets, subUnits: icSourceModel.subUnits, rs: icPair.returns, snap: icPair.snap, parties, asOf, scenarios, cases: s.cases,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [icPair, icSourceModel, parties, scenarios, s.cases]);
  const lenderModel = useMemo(() => buildLenderReportModel({
    project: s.project, financingTranches: s.financingTranches, rs: rsPair.returns, snap: rsPair.snap, parties, asOf,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rsPair, parties, s.project, s.financingTranches]);
  const onePagerModel = useMemo(() => buildOnePagerReportModel({
    project: s.project, phases: s.phases, assets: s.assets, rs: rsPair.returns, snap: rsPair.snap, parties, thesisLine: inputs.thesisLine, asOf,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rsPair, parties, s.project, s.phases, s.assets, inputs.thesisLine]);

  // Export the CURRENTLY SELECTED report type to an editable .pptx. Generated
  // SERVER-SIDE (pptxgenjs pulls node: built-ins that cannot bundle for the
  // browser): the client POSTs the ALREADY-ASSEMBLED model + inputs (no
  // recompute), the route builds the deck and streams it back. Mirrors the
  // preview: same model + inputs + ordered sections + display scale.
  const exportPptx = useCallback(async () => {
    if (exporting || !activeProjectId) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/refm/projects/${encodeURIComponent(activeProjectId)}/report-pptx`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType, projectName: s.project.name, inputs, scale, decimals, currency, asOf,
          ic: reportType === 'ic' ? icModel : undefined,
          lender: reportType === 'lender' ? lenderModel : undefined,
          onePager: reportType === 'onepager' ? onePagerModel : undefined,
          scenarios: reportType === 'ic' ? scenarios : undefined,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Export failed (${res.status})`); }
      const blob = await res.blob();
      const safe = (s.project.name || 'Report').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Report';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safe}_${reportType}.pptx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice({ text: 'PowerPoint exported.', type: 'success' });
      setTimeout(() => setNotice(null), 2600);
    } catch (err) {
      setNotice({ text: `Export failed: ${(err as Error).message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  }, [exporting, activeProjectId, reportType, s.project.name, inputs, scale, decimals, currency, asOf, icModel, lenderModel, onePagerModel, scenarios]);

  if (!activeProjectId) {
    return <div style={{ padding: 40, textAlign: 'center', color: BRAND.slate }}>Open or save a project first to build its reports.</div>;
  }

  const labelOf = (rt: ReportType, key: string): string => SECTIONS[rt].find((x) => x.key === key)?.label ?? key;
  const compact = reportType === 'onepager';

  return (
    <div data-testid="module7-reports" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: 'var(--sp-3)', alignItems: 'start', width: '100%' }}>
      {/* ── Left: report inputs form ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 8 }}>
        {/* Report type selector. Lender + One-Pager are PARKED (hidden here;
            code + fields retained). Only ACTIVE_REPORT_TYPES are selectable. */}
        {ACTIVE_REPORT_TYPES.length > 1 && (
          <div style={{ display: 'flex', gap: 4, background: '#EEF3FA', padding: 4, borderRadius: 9 }} data-testid="report-type-selector">
            {ACTIVE_REPORT_TYPES.map((rt) => (
              <button key={rt.key} type="button" onClick={() => setReportType(rt.key)} data-testid={`report-type-${rt.key}`}
                style={{ flex: 1, padding: '7px 6px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: reportType === rt.key ? BRAND.navy : 'transparent', color: reportType === rt.key ? '#fff' : BRAND.slate }}>
                {rt.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: BRAND.navy }}>Report inputs</h3>
          <button type="button" onClick={save} disabled={saving || !dirty} data-testid="report-save"
            style={{ background: dirty ? BRAND.navy : '#9CA3AF', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>
            {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
        <button type="button" onClick={exportPptx} disabled={exporting} data-testid="report-export-pptx"
          style={{ background: BRAND.green, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 16px', fontSize: 12, fontWeight: 700, cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.7 : 1 }}>
          {exporting ? 'Exporting...' : `Export ${REPORT_TYPES.find((r) => r.key === reportType)?.label} to PowerPoint`}
        </button>
        {notice && <div style={{ fontSize: 12, fontWeight: 600, color: notice.type === 'success' ? BRAND.green : '#B91C1C' }}>{notice.text}</div>}

        {/* Narrative fields relevant to the active report type. */}
        {reportType === 'ic' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="ic-narrative-form">
            <FormGroup title="Deck settings">
              <FormField label="Case for this report">
                <SegToggle value={inputs.icDeckCase} onChange={(v) => patch({ icDeckCase: v as ReportInputs['icDeckCase'] })} testid="rp-ic-case"
                  options={[{ value: 'management', label: 'Management (base)' }, { value: 'active', label: 'Active case' }]} />
              </FormField>
              <FormField label="Money scale">
                <SegToggle value={inputs.icMoneyScale} onChange={(v) => patch({ icMoneyScale: v as ReportInputs['icMoneyScale'] })} testid="rp-ic-scale"
                  options={[{ value: 'millions', label: `Millions (${icMoneyScaleSpec('millions', s.project.currency ?? 'SAR').unit})` }, { value: 'thousands', label: `Thousands (${icMoneyScaleSpec('thousands', s.project.currency ?? 'SAR').unit})` }]} />
              </FormField>
            </FormGroup>
            <FormGroup title="Executive summary">
              <FormField label="Summary / thesis (free text)"><Textarea value={inputs.executiveSummary} onChange={(v) => patch({ executiveSummary: v })} testid="rp-exec" /></FormField>
              <FormField label="Summary points (optional; replace the free text)">
                <PairRepeater items={inputs.execPoints as unknown as Array<Record<string, string>>} keyA="title" keyB="body" labelA="Title" labelB="Detail" addLabel="Add point" testid="rp-execpoints"
                  onChange={(v) => patch({ execPoints: v as unknown as ExecPoint[] })} />
              </FormField>
            </FormGroup>

            <FormGroup title="Project overview">
              <FormField label="Development concept"><Textarea value={inputs.developmentConcept} onChange={(v) => patch({ developmentConcept: v })} testid="rp-devconcept" /></FormField>
            </FormGroup>

            <FormGroup title="Market context">
              <FormField label="Headline stats">
                <PairRepeater items={inputs.marketContext.stats as unknown as Array<Record<string, string>>} keyA="value" keyB="label" labelA="Value" labelB="Caption" addLabel="Add stat" testid="rp-mktstats"
                  onChange={(v) => patch({ marketContext: { ...inputs.marketContext, stats: v as unknown as MarketStat[] } })} />
              </FormField>
              <FormField label="Points">
                <PairRepeater items={inputs.marketContext.points as unknown as Array<Record<string, string>>} keyA="title" keyB="body" labelA="Title" labelB="Detail" addLabel="Add point" testid="rp-mktpoints"
                  onChange={(v) => patch({ marketContext: { ...inputs.marketContext, points: v as unknown as MarketPoint[] } })} />
              </FormField>
              <FormField label="Sources note"><Input value={inputs.marketContext.sourcesNote} onChange={(v) => patch({ marketContext: { ...inputs.marketContext, sourcesNote: v } })} placeholder="e.g. Illustrative; align to market studies at IC stage." /></FormField>
            </FormGroup>

            <FormGroup title="Development programme">
              <FormField label="Key gates / milestones"><Textarea value={inputs.keyGates} onChange={(v) => patch({ keyGates: v })} testid="rp-keygates" /></FormField>
            </FormGroup>

            <FormGroup title="Commentary">
              <FormField label="Reading the returns"><Textarea value={inputs.returnsCommentary} onChange={(v) => patch({ returnsCommentary: v })} testid="rp-retcomm" /></FormField>
              <FormField label="Exit-year optionality"><Textarea value={inputs.exitCommentary} onChange={(v) => patch({ exitCommentary: v })} testid="rp-exitcomm" /></FormField>
              <FormField label="Scenario takeaway"><Textarea value={inputs.scenarioTakeaway} onChange={(v) => patch({ scenarioTakeaway: v })} testid="rp-scentake" /></FormField>
            </FormGroup>

            <FormGroup title="Risk assessment">
              <FormField label="Risks & mitigants">
                <PairRepeater items={inputs.risks as unknown as Array<Record<string, string>>} keyA="risk" keyB="mitigant" labelA="Risk" labelB="Mitigant" addLabel="Add risk" testid="rp-risks"
                  onChange={(v) => patch({ risks: v as unknown as RiskItem[] })} />
              </FormField>
              <FormField label="Risks (free-text fallback, used only when no rows above)"><Textarea value={inputs.keyRisks} onChange={(v) => patch({ keyRisks: v })} testid="rp-risks-text" /></FormField>
            </FormGroup>

            <FormGroup title="Regulatory & tax">
              <button type="button" onClick={() => patch({ regulatoryTax: KSA_REGULATORY_PRESET.map((r) => ({ ...r })) })} data-testid="rp-load-ksa"
                style={{ alignSelf: 'flex-start', border: `1px solid ${BRAND.border}`, background: '#fff', color: BRAND.navy, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Load KSA preset
              </button>
              <PairRepeater items={inputs.regulatoryTax as unknown as Array<Record<string, string>>} keyA="label" keyB="body" labelA="Item" labelB="Detail" addLabel="Add item" testid="rp-regtax"
                onChange={(v) => patch({ regulatoryTax: v as unknown as RegulatoryItem[] })} />
            </FormGroup>

            <FormGroup title="Recommendation & approvals">
              <FormField label="Recommendation / the ask"><Textarea value={inputs.recommendation} onChange={(v) => patch({ recommendation: v })} testid="rp-rec" /></FormField>
              <FormField label="Conditions precedent">
                <ListRepeater items={inputs.conditionsPrecedent} addLabel="Add condition" testid="rp-conditions"
                  onChange={(v) => patch({ conditionsPrecedent: v })} />
              </FormField>
              <FormField label="Next steps"><Textarea value={inputs.nextSteps} onChange={(v) => patch({ nextSteps: v })} testid="rp-nextsteps" /></FormField>
            </FormGroup>

            <FormGroup title="Disclaimers">
              <FormField label="Disclaimers"><Textarea value={inputs.disclaimers} onChange={(v) => patch({ disclaimers: v })} testid="rp-disc" /></FormField>
            </FormGroup>
          </div>
        )}
        {reportType === 'lender' && (
          <>
            <FormField label="Executive summary"><Textarea value={inputs.executiveSummary} onChange={(v) => patch({ executiveSummary: v })} testid="rp-exec" /></FormField>
            <FormField label="Security & collateral"><Textarea value={inputs.securityCollateral} onChange={(v) => patch({ securityCollateral: v })} testid="rp-security" /></FormField>
            <FormField label="Covenant commentary"><Textarea value={inputs.covenantCommentary} onChange={(v) => patch({ covenantCommentary: v })} testid="rp-covcomm" /></FormField>
            <FormField label="Disclaimers"><Textarea value={inputs.disclaimers} onChange={(v) => patch({ disclaimers: v })} testid="rp-disc" /></FormField>
          </>
        )}
        {reportType === 'onepager' && (
          <FormField label="Thesis line (short)"><Textarea value={inputs.thesisLine} onChange={(v) => patch({ thesisLine: v })} testid="rp-thesis" /></FormField>
        )}

        <FormField label="Header text"><Input value={inputs.headerText} onChange={(v) => patch({ headerText: v })} placeholder="e.g. Strictly Private & Confidential" /></FormField>
        <FormField label="Footer text"><Input value={inputs.footerText} onChange={(v) => patch({ footerText: v })} placeholder="e.g. Prepared for the Investment Committee" /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FormField label="Body font"><FontPicker value={inputs.fontBody} onChange={(v) => patch({ fontBody: v })} /></FormField>
          <FormField label="Heading font"><FontPicker value={inputs.fontHeading} onChange={(v) => patch({ fontHeading: v })} /></FormField>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.slate, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sections ({REPORT_TYPES.find((r) => r.key === reportType)?.label})</div>
          <div style={{ border: `1px solid ${BRAND.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {orderedSections.map((sec, i) => (
              <div key={sec.key} data-testid={`rp-section-row-${sec.key}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderTop: i ? `1px solid ${BRAND.pale}` : 'none', background: sec.visible ? '#fff' : '#F5F7FA' }}>
                <input type="checkbox" checked={sec.visible} onChange={() => toggleSection(sec.key)} data-testid={`rp-toggle-${sec.key}`} />
                <span style={{ flex: 1, fontSize: 12, color: sec.visible ? BRAND.navy : BRAND.slate, fontWeight: 600 }}>{labelOf(reportType, sec.key)}</span>
                <button type="button" onClick={() => moveSection(sec.key, -1)} disabled={i === 0} title="Move up" style={arrowBtn(i === 0)}>↑</button>
                <button type="button" onClick={() => moveSection(sec.key, 1)} disabled={i === orderedSections.length - 1} title="Move down" style={arrowBtn(i === orderedSections.length - 1)}>↓</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right: assembled preview ── */}
      <div data-testid="report-preview" style={{ background: '#fff', border: `1px solid ${BRAND.border}`, borderRadius: 10, overflow: 'hidden', fontFamily: `'${inputs.fontBody}', sans-serif`, color: '#1A2230', maxWidth: compact ? 720 : undefined }}>
        {inputs.headerText && (
          <div style={{ background: BRAND.navy, color: '#fff', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 24px', textAlign: 'right' }}>{inputs.headerText}</div>
        )}
        <div style={{ padding: compact ? '20px 24px' : '28px 32px', display: 'flex', flexDirection: 'column', gap: compact ? 16 : 26 }}>
          {reportType === 'ic'
            // IC: auto-omit empty AUTO + FORM sections (shared predicate).
            // Numbering excludes the cover so preview chip numbers match the PPT.
            ? (() => { const vis = icVisibleSections(icModel, inputs); const nonCover = vis.filter((k) => k !== 'cover');
                return vis.map((key) => (
                  <ICSection key={key} num={key === 'cover' ? '' : String(nonCover.indexOf(key) + 1).padStart(2, '0')} sectionKey={key} model={icModel} inputs={inputs} fmt={fmtM} moneyUnit={moneyUnit} scenarios={scenarios} />
                )); })()
            : orderedSections.filter((sec) => sec.visible).map((sec) => (
                reportType === 'lender'
                  ? <LenderSection key={sec.key} sectionKey={sec.key} model={lenderModel} inputs={inputs} fmt={fmt} currency={currency} />
                  : <OnePagerSection key={sec.key} sectionKey={sec.key} model={onePagerModel} inputs={inputs} fmt={fmt} currency={currency} />
              ))}
        </div>
        <div style={{ borderTop: `2px solid ${BRAND.navy}`, padding: '10px 24px', display: 'flex', justifyContent: 'space-between', color: BRAND.slate, fontSize: 10 }}>
          <span>{inputs.footerText || 'Strictly Private & Confidential'}</span>
          <span>{s.project.name} | {asOf}</span>
        </div>
      </div>
    </div>
  );
}

// ── shared heading + number helpers ──
const sectionHeading = (fontHeading: string): React.CSSProperties => ({ fontFamily: `'${fontHeading}', serif`, color: BRAND.navy, fontSize: 17, fontWeight: 800, margin: '0 0 12px', borderBottom: `2px solid ${BRAND.pale}`, paddingBottom: 6 });

// Composed IC section header: navy number chip + Cambria title + italic finding
// subtitle (the finding, never a units note) + optional right-aligned unit note.
function SectionHead({ num, title, finding, unit, fontHeading }: { num: string; title: string; finding: string; unit?: string; fontHeading: string }): React.JSX.Element {
  return (
    <div style={{ margin: '0 0 12px', borderBottom: `2px solid ${BRAND.pale}`, paddingBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {num && <span style={{ background: BRAND.navy, color: '#fff', fontFamily: `'${fontHeading}', serif`, fontWeight: 800, fontSize: 13, borderRadius: 5, minWidth: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{num}</span>}
        <h2 style={{ fontFamily: `'${fontHeading}', serif`, color: BRAND.navy, fontSize: 17, fontWeight: 800, margin: 0, flex: 1 }}>{title}</h2>
        {unit && <span style={{ fontSize: 10, color: BRAND.slate, whiteSpace: 'nowrap' }}>All figures in {unit}</span>}
      </div>
      {finding && <div style={{ fontSize: 12, fontStyle: 'italic', color: BRAND.slate, marginTop: 5 }}>{finding}</div>}
    </div>
  );
}

// Reading / caption block that pairs with a chart or table (spec rule 5).
function CaptionBlock({ heading, children, variant = 'pale' }: { heading: string; children: React.ReactNode; variant?: 'pale' | 'navy' | 'green' }): React.JSX.Element {
  const bg = variant === 'navy' ? BRAND.navy : variant === 'green' ? BRAND.green : '#EEF3FA';
  const fg = variant === 'pale' ? '#2A3444' : '#fff';
  const hc = variant === 'pale' ? BRAND.slate : 'rgba(255,255,255,0.85)';
  return (
    <div style={{ background: bg, border: variant === 'pale' ? `1px solid ${BRAND.border}` : 'none', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: hc, fontWeight: 700, marginBottom: 4 }}>{heading}</div>
      <div style={{ fontSize: 12, lineHeight: 1.45, color: fg }}>{children}</div>
    </div>
  );
}
const pctN = (v: number | null): string => (v == null || !Number.isFinite(v) ? 'n/a' : fmtPct(v));
const covFmt = (v: number | null, unit: 'x' | 'pct'): string => (v == null || !Number.isFinite(v) ? 'n/a' : unit === 'pct' ? fmtPct(v) : fmtX(v));

// ── IC section renderer (A+B full model-driven structure) ──
const sensVarLabel = (v: string): string => ({
  exit_cap_rate: 'Exit cap rate', discount_rate: 'Discount rate',
  sales_price_pct: 'Sales price', adr_pct: 'ADR', construction_cost_pct: 'Construction cost',
}[v] ?? v);
const sensValLabel = (variable: string, v: number): string =>
  (variable === 'exit_cap_rate' || variable === 'discount_rate')
    ? fmtPct(v)
    : `${v > 0 ? '+' : ''}${fmtPct(v)}`;

function ICSection({ num, sectionKey, model, inputs, fmt, moneyUnit, scenarios }: {
  num: string;
  sectionKey: ICSectionKey;
  model: ICReportModel;
  inputs: ReportInputs;
  fmt: (n: number) => string;
  moneyUnit: string;
  scenarios: ReturnType<typeof buildCaseComparisonReport> | null;
}): React.JSX.Element {
  const mult = (v: number): string => fmtX(v);
  const pctF = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : fmtPct(v));
  const multF = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : fmtX(v));
  const moneyF = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : fmt(v));
  const finding = icFindingLine(sectionKey, model, inputs, { money: moneyF, pct: pctF, mult: multF });
  // Composed section header: navy number chip + Cambria title + italic finding
  // subtitle (never a units note), optional right-aligned unit note.
  const head = (title: string, unit?: boolean): React.JSX.Element => (
    <SectionHead num={num} title={title} finding={finding} unit={unit ? moneyUnit : undefined} fontHeading={inputs.fontHeading} />
  );
  // Optional narrative: renders nothing when blank (empty FORM never shows a
  // blank prompt in output; wholly-empty FORM sections are auto-omitted upstream).
  const narrOpt = (text: string): React.JSX.Element | null =>
    text.trim() ? <p style={{ margin: '0 0 4px', fontSize: 13, lineHeight: 1.55, color: '#2A3444', whiteSpace: 'pre-wrap' }}>{text}</p> : null;

  switch (sectionKey) {
    case 'cover': {
      const h = model.headline;
      return (
        <section data-testid="ic-sec-cover" style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.mid})`, color: '#fff', borderRadius: 10, padding: '40px 32px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.85 }}>Investment Committee Report</div>
          <div style={{ fontFamily: `'${inputs.fontHeading}', serif`, fontSize: 32, fontWeight: 800, margin: '10px 0 6px' }}>{model.cover.projectName || 'Untitled Project'}</div>
          <div style={{ fontSize: 14, opacity: 0.92 }}>{model.cover.location || 'Location not set'}</div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <CoverStat label="Project IRR" value={pctN(h.projectIrr)} />
            <CoverStat label="Equity IRR" value={pctN(h.equityIrr)} />
            <CoverStat label="Equity Multiple" value={mult(h.equityMultiple)} />
            <CoverStat label="GDV" value={fmt(model.devEconomics.gdv)} />
            <CoverStat label="Total Dev Cost" value={fmt(model.devEconomics.tdc)} />
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 12 }}>
            <div><div style={{ opacity: 0.7 }}>As of</div><div style={{ fontWeight: 700 }}>{model.cover.asOf}</div></div>
            <div><div style={{ opacity: 0.7 }}>Figures in</div><div style={{ fontWeight: 700 }}>{moneyUnit}</div></div>
            {model.cover.preparedBy.length > 0 && (
              <div><div style={{ opacity: 0.7 }}>Prepared by</div><div style={{ fontWeight: 700 }}>{model.cover.preparedBy.map((p) => p.name).join(', ')}</div></div>
            )}
          </div>
          <div style={{ marginTop: 20, fontSize: 10, opacity: 0.8, borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: 10 }}>Strictly Private &amp; Confidential. For the intended recipient only.</div>
        </section>
      );
    }
    case 'executive_summary':
      return (
        <section data-testid="ic-sec-exec">
          {head('Executive Summary')}
          {inputs.execPoints.length > 0
            ? <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {inputs.execPoints.map((p, i) => (
                  <li key={i} style={{ fontSize: 13, color: '#2A3444', lineHeight: 1.5 }}>
                    {p.title && <strong style={{ color: BRAND.navy }}>{p.title}. </strong>}{p.body}
                  </li>
                ))}
              </ol>
            : narrOpt(inputs.executiveSummary)}
        </section>
      );
    case 'investment_recommendation': {
      const a = model.ask;
      return (
        <section data-testid="ic-sec-invrec">
          {head('Investment Recommendation', true)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: narrOpt(inputs.recommendation) ? 12 : 0 }}>
            <Kpi label="Equity Commitment" value={fmt(a.equityCommitment)} sub={`existing ${fmt(a.existingEquity)} + in-kind ${fmt(a.inKindEquity)}`} />
            {a.peakDebt > 0.5 && <Kpi label="Senior Debt (peak)" value={fmt(a.peakDebt)} sub={`existing ${fmt(a.existingDebt)} + new ${fmt(a.newDebt)}`} />}
            <Kpi label="Target Returns" value={`${pctN(a.projectIrr)} / ${pctN(a.equityIrr)}`} sub={`Project / Equity IRR, ${mult(a.equityMoic)} MOIC`} good />
          </div>
          {narrOpt(inputs.recommendation)}
        </section>
      );
    }
    case 'project_overview': {
      const o = model.overview;
      return (
        <section data-testid="ic-sec-overview">
          {head('Project Overview')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: inputs.developmentConcept.trim() ? 14 : 0 }}>
            <Fact label="Location">{[o.location, o.country].filter(Boolean).join(', ') || 'n/a'}</Fact>
            {o.landAreaSqm > 0 && <Fact label="Land area">{o.landAreaSqm.toLocaleString()} sqm</Fact>}
            {o.totalBua > 0 && <Fact label="Built-up area">{Math.round(o.totalBua).toLocaleString()} sqm across {o.assetMix.length} assets</Fact>}
            <Fact label="Strategy mix">{o.strategyMix || 'n/a'}</Fact>
            <Fact label="Model horizon">{o.startYear} to {o.exitYear} ({o.durationYears} yrs)</Fact>
            <Fact label="Funding">{o.fundingMethodLabel}</Fact>
            {o.sponsors.length > 0 && <Fact label="Sponsor">{o.sponsors.map((p) => p.name).join(', ')}</Fact>}
            {o.developers.length > 0 && <Fact label="Developer">{o.developers.map((p) => p.name).join(', ')}</Fact>}
            {o.investors.length > 0 && <Fact label="Investor(s)">{o.investors.map((p) => p.name).join(', ')}</Fact>}
          </div>
          {inputs.developmentConcept.trim() && (
            <div><div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>Development concept</div>{narrOpt(inputs.developmentConcept)}</div>
          )}
        </section>
      );
    }
    case 'master_plan':
      return (
        <section data-testid="ic-sec-masterplan">
          {head('Master Plan & Phasing', true)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {model.phasing.map((ph, i) => (
              <div key={i} style={{ border: `1px solid ${BRAND.border}`, borderRadius: 9, padding: '12px 14px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ fontFamily: `'${inputs.fontHeading}', serif`, fontSize: 26, fontWeight: 800, color: BRAND.mid, minWidth: 34 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.navy }}>{ph.name}{ph.startYear ? <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.slate }}> · from {ph.startYear}</span> : null}</div>
                  {ph.strategies && <div style={{ fontSize: 11, color: BRAND.slate, marginTop: 1 }}>{ph.strategies}</div>}
                  {ph.assetNames.length > 0 && <div style={{ fontSize: 12, color: '#2A3444', marginTop: 4 }}>{ph.assetNames.join(', ')}</div>}
                </div>
                <div style={{ textAlign: 'right', minWidth: 120 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: BRAND.slate, fontWeight: 700 }}>{ph.assetCount} {ph.assetCount === 1 ? 'asset' : 'assets'} · capex</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.navy }}>{fmt(ph.capex)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    case 'asset_mix': {
      const m = model.assetMix;
      const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11 };
      const td: React.CSSProperties = { textAlign: 'right', padding: '5px 10px', fontSize: 11, borderBottom: `1px solid ${BRAND.pale}` };
      return (
        <section data-testid="ic-sec-assetmix">
          {head('Asset Mix')}
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr style={{ background: BRAND.navy, color: '#fff' }}>
                <th style={{ ...th, textAlign: 'left' }}>Asset</th><th style={{ ...th, textAlign: 'left' }}>Strategy</th><th style={{ ...th, textAlign: 'left' }}>Phase</th><th style={th}>BUA (sqm)</th><th style={th}>Units</th>
              </tr></thead>
              <tbody>
                {m.rows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: 'left' }}>{row.name}</td>
                    <td style={{ ...td, textAlign: 'left', color: BRAND.slate }}>{row.strategy}</td>
                    <td style={{ ...td, textAlign: 'left', color: BRAND.slate }}>{row.phaseName || '-'}</td>
                    <td style={td}>{row.bua > 0 ? Math.round(row.bua).toLocaleString() : '-'}</td>
                    <td style={td}>{row.units > 0 ? row.units : '-'}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800, color: BRAND.navy }}>
                  <td style={{ ...td, textAlign: 'left' }}>Total</td><td style={td} /><td style={td} />
                  <td style={td}>{Math.round(m.totalBua).toLocaleString()}</td><td style={td}>{m.totalUnits}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>Built-up area by strategy</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {m.byStrategy.map((s2, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 600, color: BRAND.navy, background: BRAND.pale, padding: '4px 10px', borderRadius: 20 }}>{s2.strategy} {fmtPct(s2.pct)}</span>
            ))}
          </div>
          {m.byStrategy.length > 0 && <AssetMixDoughnut data={m.byStrategy} />}
          {m.byStrategy.length > 0 && <div style={{ marginTop: 8 }}><CaptionBlock heading="Reading the mix">{m.byStrategy.map((x) => `${x.strategy} ${fmtPct(x.pct)}`).join(', ')}. The blend balances near-term sales cash against recurring operating income.</CaptionBlock></div>}
        </section>
      );
    }
    case 'market_context': {
      const mc = inputs.marketContext;
      return (
        <section data-testid="ic-sec-market">
          {head('Market Context')}
          {mc.points.length > 0 && (
            <ol style={{ margin: '0 0 12px', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {mc.points.map((p, i) => <li key={i} style={{ fontSize: 13, color: '#2A3444', lineHeight: 1.5 }}>{p.title && <strong style={{ color: BRAND.navy }}>{p.title}. </strong>}{p.body}</li>)}
            </ol>
          )}
          {mc.stats.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 10 }}>
              {mc.stats.map((s2, i) => <Kpi key={i} label={s2.label} value={s2.value} />)}
            </div>
          )}
          {mc.sourcesNote.trim() && <p style={{ margin: 0, fontSize: 10, color: BRAND.slate, fontStyle: 'italic' }}>{mc.sourcesNote}</p>}
        </section>
      );
    }
    case 'development_programme':
      return (
        <section data-testid="ic-sec-programme">
          {head('Development Programme', true)}
          {model.phasing.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: inputs.keyGates.trim() ? 12 : 0 }}>
              {model.phasing.map((ph, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${BRAND.pale}` }}>
                  <span style={{ color: '#2A3444' }}><strong style={{ color: BRAND.navy }}>{ph.name}</strong>{ph.startYear ? ` · from ${ph.startYear}` : ''}{ph.strategies ? ` · ${ph.strategies}` : ''}</span>
                  <span style={{ color: BRAND.slate }}>{fmt(ph.capex)}</span>
                </div>
              ))}
            </div>
          )}
          <ProgrammeGantt programme={model.programme} />
          {inputs.keyGates.trim() && (
            <div style={{ marginTop: 12 }}><div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>Key gates</div>{narrOpt(inputs.keyGates)}</div>
          )}
        </section>
      );
    case 'development_costs':
      return (
        <section data-testid="ic-sec-devcosts">
          {head('Development Costs', true)}
          <BridgeTable rows={model.costStack} fmt={fmt} />
          <CostStackBar data={model.charts.costStack} fmt={fmt} />
          <div style={{ marginTop: 10 }}>
            <CaptionBlock heading="Cost efficiency" variant="navy">Profit on cost of {pctF(model.reMetrics.profitOnCost)}{model.devEconomics.costToValue != null ? ` and a cost-to-value ratio of ${pctF(model.devEconomics.costToValue)}` : ''} leaves headroom against construction inflation.</CaptionBlock>
          </div>
        </section>
      );
    case 'value_economics': {
      const d = model.devEconomics;
      return (
        <section data-testid="ic-sec-value">
          {head('Value & Development Economics', true)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Kpi label="GDV" value={fmt(d.gdv)} sub="gross development value" />
            <Kpi label="Profit before Financing" value={fmt(d.profitBeforeFinancing)} good={d.profitBeforeFinancing >= 0} />
            <Kpi label="Profit after Financing" value={fmt(d.profitAfterFinancing)} good={d.profitAfterFinancing >= 0} />
            <Kpi label="Development Margin" value={pctN(d.developmentMargin)} sub="profit / GDV" good={(d.developmentMargin ?? 0) >= 0} />
          </div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>Value bridge</div>
          <BridgeTable rows={model.valueBridge} fmt={fmt} />
          {model.charts.revenueRecognition.hasData && <RevenueRecognitionBars series={model.charts.revenueRecognition} fmt={fmt} />}
          {model.charts.revenueRecognition.hasData && <div style={{ marginTop: 10 }}><CaptionBlock heading="Revenue recognition">Sales cash front-loads the plan while hospitality and retail build a recurring income base toward exit.</CaptionBlock></div>}
        </section>
      );
    }
    case 'sources_uses':
      return (
        <section data-testid="ic-sec-sources">
          {head('Sources & Uses', true)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <SourcesUsesList title="Sources" rows={model.sourcesUses.sources} total={model.sourcesUses.totalSources} fmt={fmt} />
            <SourcesUsesList title="Uses" rows={model.sourcesUses.uses} total={model.sourcesUses.totalUses} fmt={fmt} />
          </div>
        </section>
      );
    case 'financing_structure': {
      const f = model.financing;
      return (
        <section data-testid="ic-sec-financing">
          {head('Financing Structure', true)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Fact label="Funding method">{f.fundingMethodLabel}</Fact>
            <Fact label="Existing debt">{fmt(f.existingDebt)}</Fact>
            <Fact label="New debt">{fmt(f.newDebt)}</Fact>
            <Fact label="Peak debt (max outstanding)">{fmt(f.peakDebt)}</Fact>
            <Fact label="Debt tenor">{f.tenorYears == null ? 'n/a' : `${f.tenorYears} yrs`}</Fact>
            <Fact label="Debt paydown">{f.paydownPct == null ? 'n/a' : `${fmtPct(f.paydownPct)} by exit`}</Fact>
            <Fact label="Debt at exit">{fmt(f.remainingDebtAtExit)}</Fact>
            {f.customerCollections > 0.5 && <Fact label="Customer collections">{fmt(f.customerCollections)}</Fact>}
            {f.minCashReserve > 0.5 && <Fact label="Minimum cash reserve">{fmt(f.minCashReserve)}</Fact>}
          </div>
          {model.charts.debtBalance.hasData && <DebtBalanceBars series={model.charts.debtBalance} fmt={fmt} />}
          {model.charts.debtBalance.hasData && <div style={{ marginTop: 10 }}><CaptionBlock heading="De-levering profile" variant="navy">The facility amortises from cash sweep{model.financing.paydownPct != null ? `, retiring ${pctF(model.financing.paydownPct)} of peak debt before exit` : ' across the hold'} and lifting equity returns.</CaptionBlock></div>}
        </section>
      );
    }
    case 'returns_analysis': {
      const h = model.headline;
      const m = model.reMetrics;
      return (
        <section data-testid="ic-sec-returns">
          {head('Returns Analysis', true)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Kpi label="Project IRR" value={pctN(h.projectIrr)} sub="unlevered (FCFF)" good />
            <Kpi label="Equity IRR" value={pctN(h.equityIrr)} sub="levered (FCFE)" good />
            <Kpi label="Distributed IRR" value={pctN(h.distributedEquityIrr)} sub="on dividends" />
            <Kpi label="Equity Multiple" value={mult(h.equityMultiple)} sub="distributions / invested" />
            <Kpi label="Equity MOIC" value={mult(h.equityMoic)} sub="FCFE" />
            <Kpi label="Terminal Equity" value={fmt(h.terminalEquity)} sub={`exit ${model.overview.exitYear}`} />
          </div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 6 }}>Real-estate metrics</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: inputs.returnsCommentary.trim() ? 12 : 0 }}>
            <Kpi label="Yield on Cost" value={pctN(m.yieldOnCost)} />
            <Kpi label="Cap Rate at Exit" value={pctN(m.capRateAtExit)} />
            <Kpi label="Profit on Cost" value={pctN(m.profitOnCost)} />
            <Kpi label="Avg Cash-on-Cash" value={pctN(m.cashOnCashAvg)} />
          </div>
          {narrOpt(inputs.returnsCommentary)}
        </section>
      );
    }
    case 'exit_optionality': {
      const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11 };
      const td: React.CSSProperties = { textAlign: 'right', padding: '5px 10px', fontSize: 11, borderBottom: `1px solid ${BRAND.pale}` };
      return (
        <section data-testid="ic-sec-exit">
          {head('Exit-Year Optionality', true)}
          <div style={{ overflowX: 'auto', marginBottom: inputs.exitCommentary.trim() ? 12 : 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr style={{ background: BRAND.navy, color: '#fff' }}>
                <th style={{ ...th, textAlign: 'left' }}>Exit year</th><th style={th}>Equity value</th><th style={th}>Project IRR</th><th style={th}>Equity IRR</th><th style={th}>Equity MOIC</th>
              </tr></thead>
              <tbody>
                {model.exitYears.map((row, i) => (
                  <tr key={i} style={row.selected ? { background: 'rgba(46,125,82,0.10)' } : undefined}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: row.selected ? 800 : 400, color: row.selected ? BRAND.green : '#2A3444' }}>{row.year}{row.selected ? ' (selected)' : ''}</td>
                    <td style={td}>{fmt(row.equityValue)}</td>
                    <td style={td}>{pctN(row.projectIrr)}</td>
                    <td style={td}>{pctN(row.equityIrr)}</td>
                    <td style={td}>{mult(row.equityMoic)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {model.charts.exitMoic.hasData && <ExitMoicLine series={model.charts.exitMoic} />}
          {narrOpt(inputs.exitCommentary)}
        </section>
      );
    }
    case 'scenario_cases':
      return (
        <section data-testid="ic-sec-scencases">
          {head('Scenario Analysis: Cases')}
          <ScenarioTable scenarios={scenarios} labels={['Equity IRR (FCFE)', 'Project IRR (FCFF)', 'Equity MOIC', 'Development Margin']} fmt={fmt} title="Headline returns by case" />
          {scenarios && <ScenarioIrrBars rows={icScenarioChartRows(scenarios)} />}
          <DriverMatrix scenarios={scenarios} />
        </section>
      );
    case 'scenario_economics':
      return (
        <section data-testid="ic-sec-scenecon">
          {head('Scenario Analysis: Economics', true)}
          <ScenarioTable scenarios={scenarios}
            labels={['NPV (FCFF)', 'Gross Development Value', 'Total Development Cost', 'Total Financing Cost', 'Profit after Financing', 'Development Margin', 'Peak Equity', 'Terminal Equity Value']}
            fmt={fmt} title="Economics by case" />
          {scenarios && <ScenarioNpvBars rows={icScenarioChartRows(scenarios)} fmt={fmt} />}
          {narrOpt(inputs.scenarioTakeaway)}
        </section>
      );
    case 'sensitivity': {
      const s2 = model.sensitivity;
      const th: React.CSSProperties = { textAlign: 'center', padding: '5px 8px', fontSize: 10 };
      const td: React.CSSProperties = { textAlign: 'center', padding: '4px 8px', fontSize: 10, borderBottom: `1px solid ${BRAND.pale}` };
      const flat = s2.irr.flat().filter((v): v is number => v != null && Number.isFinite(v));
      const mn = flat.length ? Math.min(...flat) : 0, mx = flat.length ? Math.max(...flat) : 1;
      return (
        <section data-testid="ic-sec-sensitivity">
          {head('Sensitivity')}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(160px, 1fr)', gap: 16, alignItems: 'start' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 380 }}>
                <thead><tr style={{ background: BRAND.navy, color: '#fff' }}>
                  <th style={{ ...th, textAlign: 'left' }}>{sensVarLabel(s2.yVariable)} \ {sensVarLabel(s2.xVariable)}</th>
                  {s2.xValues.map((xv, i) => <th key={i} style={th}>{sensValLabel(s2.xVariable, xv)}</th>)}
                </tr></thead>
                <tbody>
                  {s2.yValues.map((yv, yi) => (
                    <tr key={yi}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: BRAND.navy, background: '#EEF3FA' }}>{sensValLabel(s2.yVariable, yv)}</td>
                      {s2.xValues.map((_, xi) => {
                        const v = s2.irr[yi]?.[xi];
                        const ok = v != null && Number.isFinite(v);
                        const t = ok && mx > mn ? (v - mn) / (mx - mn) : 0.5;
                        return <td key={xi} style={{ ...td, color: '#fff', fontWeight: 600, background: ok ? blendHex(BRAND.neg, BRAND.green, t) : 'transparent' }}>{ok ? fmtPct(v) : 'n/a'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CaptionBlock heading="Reading the sensitivity">Equity IRR spans {fmtPct(mn)} to {fmtPct(mx)} across exit cap rate and sales price.{s2.baseEquityIrr != null ? ` The base case sits at ${fmtPct(s2.baseEquityIrr)}.` : ''} The plan stays return-accretive through the tested band.</CaptionBlock>
          </div>
        </section>
      );
    }
    case 'risk_assessment':
      return (
        <section data-testid="ic-sec-risk">
          {head('Risk Assessment')}
          {inputs.risks.length > 0
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {inputs.risks.map((r, i) => (
                  <div key={i} style={{ border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: BRAND.navy }}>{r.risk}</div>
                    {r.mitigant && <div style={{ fontSize: 12, color: '#2A3444', marginTop: 3 }}><strong style={{ color: BRAND.slate }}>Mitigant: </strong>{r.mitigant}</div>}
                  </div>
                ))}
              </div>
            : narrOpt(inputs.keyRisks)}
        </section>
      );
    case 'regulatory_tax':
      return (
        <section data-testid="ic-sec-regtax">
          {head('Regulatory & Tax')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {inputs.regulatoryTax.map((r, i) => (
              <div key={i} style={{ background: BRAND.pale, border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.navy }}>{r.label}</div>
                {r.body && <div style={{ fontSize: 11, color: '#2A3444', marginTop: 3, lineHeight: 1.45 }}>{r.body}</div>}
              </div>
            ))}
          </div>
        </section>
      );
    case 'recommendation_approvals': {
      const a = model.ask;
      return (
        <section data-testid="ic-sec-approvals">
          {head('Recommendation & Approvals', true)}
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>The Committee is asked to approve</div>
          <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13, color: '#2A3444', lineHeight: 1.5 }}>
            <li>Total equity commitment of {fmt(a.equityCommitment)} (existing {fmt(a.existingEquity)}; in-kind land {fmt(a.inKindEquity)})</li>
            {a.peakDebt > 0.5 && <li>Senior debt facility supporting peak drawn debt of {fmt(a.peakDebt)}</li>}
            <li>Target returns: {pctN(a.projectIrr)} project IRR, {pctN(a.equityIrr)} equity IRR, {mult(a.equityMoic)} equity multiple</li>
          </ul>
          {inputs.conditionsPrecedent.length > 0 && (
            <>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>Conditions precedent</div>
              <ol style={{ margin: '0 0 10px', paddingLeft: 20, fontSize: 13, color: '#2A3444', lineHeight: 1.5 }}>
                {inputs.conditionsPrecedent.map((c, i) => <li key={i}>{c}</li>)}
              </ol>
            </>
          )}
          {inputs.nextSteps.trim() && (
            <div><div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>Next steps</div>{narrOpt(inputs.nextSteps)}</div>
          )}
        </section>
      );
    }
    case 'disclaimers':
      return (
        <section data-testid="ic-sec-disc">
          {head('Disclaimers')}
          {narrOpt(inputs.disclaimers)}
          <p style={{ margin: '6px 0 0', fontSize: 10, color: BRAND.slate }}>This document is strictly private and confidential and is intended solely for the recipient. Figures are model outputs, not a guarantee of future performance.</p>
        </section>
      );
    default:
      return <></>;
  }
}

// ── IC render helpers ──
function CoverStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 7, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function BridgeTable({ rows, fmt }: { rows: Array<{ label: string; value: number; emphasis?: boolean }>; fmt: (n: number) => string }): React.JSX.Element {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0',
          borderTop: r.emphasis ? `1px solid ${BRAND.border}` : `1px solid ${BRAND.pale}`,
          fontWeight: r.emphasis ? 800 : 400, color: r.emphasis ? BRAND.navy : '#2A3444' }}>
          <span>{r.label}</span>
          <span>{r.value < 0 ? `(${fmt(Math.abs(r.value))})` : fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ScenarioTable({ scenarios, labels, fmt, title }: {
  scenarios: ReturnType<typeof buildCaseComparisonReport> | null; labels: string[]; fmt: (n: number) => string; title: string;
}): React.JSX.Element | null {
  if (!scenarios) return null;
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11 };
  const td: React.CSSProperties = { textAlign: 'right', padding: '5px 10px', fontSize: 11, borderBottom: `1px solid ${BRAND.pale}` };
  const kdef = (label: string) => scenarios.kpis.find((k) => k.label === label);
  const fmtKpi = (v: number | null | undefined, kind?: string): string => {
    if (v == null || !Number.isFinite(v)) return 'n/a';
    if (kind === 'pct') return fmtPct(v);
    if (kind === 'mult') return fmtX(v);
    return fmt(v);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead><tr style={{ background: BRAND.navy, color: '#fff' }}>
            <th style={{ ...th, textAlign: 'left' }}>Metric</th>
            {scenarios.columns.map((c) => <th key={c.id} style={th}>{c.role === 'base' ? '★ ' : ''}{c.name}</th>)}
          </tr></thead>
          <tbody>
            {labels.map((label) => {
              const def = kdef(label);
              return (
                <tr key={label}>
                  <td style={{ ...td, textAlign: 'left', color: BRAND.slate }}>{label}</td>
                  {scenarios.columns.map((c) => <td key={c.id} style={td}>{fmtKpi(c.values[label], def?.kind)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "What drives each case": union of override labels across non-base cases. */
function DriverMatrix({ scenarios }: { scenarios: ReturnType<typeof buildCaseComparisonReport> | null }): React.JSX.Element | null {
  if (!scenarios) return null;
  const base = scenarios.columns.find((c) => c.role === 'base');
  const nonBase = scenarios.columns.filter((c) => c.role !== 'base');
  const labels: string[] = [];
  for (const col of nonBase) for (const d of col.drivers) if (!labels.includes(d.label)) labels.push(d.label);
  if (labels.length === 0) return null;
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11 };
  const td: React.CSSProperties = { textAlign: 'right', padding: '5px 10px', fontSize: 11, borderBottom: `1px solid ${BRAND.pale}` };
  const cellFor = (col: typeof nonBase[number], label: string): string => col.drivers.find((d) => d.label === label)?.value ?? '-';
  const baseFor = (label: string): string => nonBase.map((c) => c.drivers.find((d) => d.label === label)?.base).find((v) => v != null) ?? '-';
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 4 }}>What drives each case</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead><tr style={{ background: BRAND.navy, color: '#fff' }}>
            <th style={{ ...th, textAlign: 'left' }}>Assumption</th>
            <th style={th}>{base ? `★ ${base.name}` : 'Base'}</th>
            {nonBase.map((c) => <th key={c.id} style={th}>{c.name}</th>)}
          </tr></thead>
          <tbody>
            {labels.map((label) => (
              <tr key={label}>
                <td style={{ ...td, textAlign: 'left', color: BRAND.slate }}>{label}</td>
                <td style={td}>{baseFor(label)}</td>
                {nonBase.map((c) => <td key={c.id} style={td}>{cellFor(c, label)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── IC charts (Phase C) + development-programme Gantt (Phase D) ──
// Recharts on-screen; the PPT export draws the SAME series as native Office
// charts. Brand palette + data both come from the shared icReport helpers.
const CH = IC_CHART_PALETTE;
const DOUGHNUT_COLORS = [CH.navy, CH.mid, CH.green, CH.neg, '#B9C7DD', '#3E6FA8'];
// Coerce a Recharts callback value (string | number | array) to a finite number.
const chartNum = (v: unknown): number => { const n = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(n) ? n : 0; };

function ChartFrame({ title, height = 220, children }: { title: string; height?: number; children: React.ReactElement }): React.JSX.Element {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

function AssetMixDoughnut({ data }: { data: Array<{ strategy: string; bua: number; pct: number }> }): React.JSX.Element {
  return (
    <ChartFrame title="Built-up area by strategy">
      <PieChart>
        <Pie data={data} dataKey="bua" nameKey="strategy" innerRadius={48} outerRadius={82} paddingAngle={2} isAnimationActive={false}
          label={(e: PieLabelRenderProps) => { const d = e as PieLabelRenderProps & { strategy?: string; pct?: number }; return `${d.strategy ?? ''} ${fmtPct(d.pct ?? 0)}`; }} labelLine={false}>
          {data.map((_, i) => <Cell key={i} fill={DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => Math.round(chartNum(v)).toLocaleString()} />
      </PieChart>
    </ChartFrame>
  );
}

function CostStackBar({ data, fmt }: { data: { land: number; construction: number; financing: number }; fmt: (n: number) => string }): React.JSX.Element {
  const rows = [
    { name: 'Development cost', Land: data.land, Construction: data.construction, Financing: 0 },
    { name: 'Financing', Land: 0, Construction: 0, Financing: data.financing },
  ];
  return (
    <ChartFrame title="Cost stack">
      <BarChart data={rows} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BRAND.pale} />
        <XAxis dataKey="name" fontSize={11} />
        <YAxis fontSize={10} width={64} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip formatter={(v) => fmt(chartNum(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Land" stackId="a" fill={CH.mid} />
        <Bar dataKey="Construction" stackId="a" fill={CH.navy} />
        <Bar dataKey="Financing" stackId="a" fill={CH.neg} />
      </BarChart>
    </ChartFrame>
  );
}

function RevenueRecognitionBars({ series, fmt }: { series: { yearLabels: number[]; sales: number[]; hospitality: number[]; retail: number[] }; fmt: (n: number) => string }): React.JSX.Element {
  const rows = series.yearLabels.map((y, i) => ({ year: String(y), Sales: series.sales[i] ?? 0, Hospitality: series.hospitality[i] ?? 0, Retail: series.retail[i] ?? 0 }));
  return (
    <ChartFrame title="Revenue recognition by period">
      <BarChart data={rows} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BRAND.pale} />
        <XAxis dataKey="year" fontSize={10} />
        <YAxis fontSize={10} width={64} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip formatter={(v) => fmt(chartNum(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Sales" stackId="a" fill={CH.navy} />
        <Bar dataKey="Hospitality" stackId="a" fill={CH.mid} />
        <Bar dataKey="Retail" stackId="a" fill={CH.green} />
      </BarChart>
    </ChartFrame>
  );
}

function DebtBalanceBars({ series, fmt }: { series: { yearLabels: number[]; values: number[] }; fmt: (n: number) => string }): React.JSX.Element {
  const rows = series.yearLabels.map((y, i) => ({ year: String(y), Debt: series.values[i] ?? 0 }));
  return (
    <ChartFrame title="Senior debt outstanding">
      <BarChart data={rows} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BRAND.pale} />
        <XAxis dataKey="year" fontSize={10} />
        <YAxis fontSize={10} width={64} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip formatter={(v) => fmt(chartNum(v))} />
        <Bar dataKey="Debt" name="Debt outstanding" fill={CH.navy} />
      </BarChart>
    </ChartFrame>
  );
}

function ScenarioIrrBars({ rows }: { rows: ReturnType<typeof icScenarioChartRows> }): React.JSX.Element {
  const data = rows.map((r) => ({ name: r.name, 'Project IRR': r.projectIrr == null ? null : r.projectIrr * 100, 'Equity IRR': r.equityIrr == null ? null : r.equityIrr * 100 }));
  return (
    <ChartFrame title="IRR by case">
      <BarChart data={data} margin={{ top: 18, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BRAND.pale} />
        <XAxis dataKey="name" fontSize={11} />
        <YAxis fontSize={10} width={44} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip formatter={(v) => `${chartNum(v).toFixed(1)}%`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Project IRR" fill={CH.navy}><LabelList dataKey="Project IRR" position="top" fontSize={9} formatter={(v) => `${chartNum(v).toFixed(1)}%`} /></Bar>
        <Bar dataKey="Equity IRR" fill={CH.mid}><LabelList dataKey="Equity IRR" position="top" fontSize={9} formatter={(v) => `${chartNum(v).toFixed(1)}%`} /></Bar>
      </BarChart>
    </ChartFrame>
  );
}

function ScenarioNpvBars({ rows, fmt }: { rows: ReturnType<typeof icScenarioChartRows>; fmt: (n: number) => string }): React.JSX.Element {
  const data = rows.map((r) => ({ name: r.name, npv: r.npv ?? 0 }));
  return (
    <ChartFrame title="NPV by case">
      <BarChart data={data} margin={{ top: 18, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BRAND.pale} />
        <XAxis dataKey="name" fontSize={11} />
        <YAxis fontSize={10} width={64} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip formatter={(v) => fmt(chartNum(v))} />
        <Bar dataKey="npv" name="NPV">
          {data.map((d, i) => <Cell key={i} fill={d.npv >= 0 ? CH.green : CH.neg} />)}
          <LabelList dataKey="npv" position="top" fontSize={9} formatter={(v) => fmt(chartNum(v))} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

function ExitMoicLine({ series }: { series: { years: number[]; moic: number[] } }): React.JSX.Element {
  const data = series.years.map((y, i) => ({ year: String(y), MOIC: series.moic[i] ?? 0 }));
  return (
    <ChartFrame title="Equity MOIC by exit year" height={200}>
      <LineChart data={data} margin={{ top: 18, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BRAND.pale} />
        <XAxis dataKey="year" fontSize={10} />
        <YAxis fontSize={10} width={44} tickFormatter={(v: number) => `${v.toFixed(1)}x`} />
        <Tooltip formatter={(v) => `${chartNum(v).toFixed(2)}x`} />
        <Line type="monotone" dataKey="MOIC" stroke={CH.navy} strokeWidth={2} dot={{ r: 3, fill: CH.navy }} isAnimationActive={false} />
      </LineChart>
    </ChartFrame>
  );
}

// Development-programme Gantt (Phase D): phase swimlanes across the model years,
// construction (navy) + operations (green), with debt-repaid + exit markers.
function ProgrammeGantt({ programme }: { programme: ICReportModel['programme'] }): React.JSX.Element | null {
  const { startYear, exitYear, lanes, debtRepaidYear } = programme;
  if (lanes.length === 0 || exitYear < startYear) return null;
  const years: number[] = [];
  for (let y = startYear; y <= exitYear; y++) years.push(y);
  const nY = years.length;
  const isMarker = (y: number): 'debt' | 'exit' | null => (y === exitYear ? 'exit' : y === debtRepaidYear ? 'debt' : null);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700, marginBottom: 6 }}>Development programme</div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `150px repeat(${nY}, minmax(30px, 1fr))`, gap: 2, minWidth: 150 + nY * 32, alignItems: 'center' }}>
          <div />
          {years.map((y) => {
            const mk = isMarker(y);
            return <div key={`h${y}`} style={{ fontSize: 9, textAlign: 'center', fontWeight: mk ? 800 : 600, color: mk === 'exit' ? BRAND.green : mk === 'debt' ? BRAND.navy : BRAND.slate }}>{y}</div>;
          })}
          {lanes.map((lane) => (
            <React.Fragment key={lane.name}>
              <div style={{ fontSize: 11, color: BRAND.navy, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 6 }} title={lane.strategies ? `${lane.name} (${lane.strategies})` : lane.name}>{lane.name}</div>
              {years.map((y) => {
                const inC = y >= lane.constructionStart && y <= lane.constructionEnd;
                const inO = lane.operationsStart != null && y >= lane.operationsStart && y <= (lane.operationsEnd ?? exitYear);
                const bg = inC ? BRAND.navy : inO ? BRAND.green : '#EEF2F7';
                const label = inC ? 'Construction' : inO ? 'Operations' : '';
                return <div key={`${lane.name}-${y}`} title={label ? `${lane.name}: ${label} ${y}` : String(y)} style={{ height: 18, background: bg, borderRadius: 3 }} />;
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 10, color: BRAND.slate }}>
        <LegendSwatch color={BRAND.navy} label="Construction" />
        <LegendSwatch color={BRAND.green} label="Operations" />
        {debtRepaidYear != null && <span><strong style={{ color: BRAND.navy }}>Debt repaid</strong> {debtRepaidYear}</span>}
        <span><strong style={{ color: BRAND.green }}>Exit</strong> {exitYear}</span>
      </div>
    </div>
  );
}
function LegendSwatch({ color, label }: { color: string; label: string }): React.JSX.Element {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, background: color, borderRadius: 3, display: 'inline-block' }} />{label}</span>;
}

// ── Lender Package section renderer (Phase 2) ──
function LenderSection({ sectionKey, model, inputs, fmt, currency }: {
  sectionKey: string; model: LenderReportModel; inputs: ReportInputs; fmt: (n: number) => string; currency: string;
}): React.JSX.Element {
  const heading = sectionHeading(inputs.fontHeading);
  const narr = (text: string, empty: string): React.JSX.Element =>
    text.trim()
      ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#2A3444', whiteSpace: 'pre-wrap' }}>{text}</p>
      : <p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', color: BRAND.slate }}>{empty}</p>;

  switch (sectionKey) {
    case 'cover':
      return (
        <section data-testid="ln-sec-cover" style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.mid})`, color: '#fff', borderRadius: 10, padding: '36px 32px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.85 }}>Lender Package</div>
          <div style={{ fontFamily: `'${inputs.fontHeading}', serif`, fontSize: 30, fontWeight: 800, margin: '10px 0 6px' }}>{model.cover.projectName || 'Untitled Project'}</div>
          <div style={{ fontSize: 14, opacity: 0.92 }}>{model.cover.location || 'Location not set'}</div>
          <div style={{ marginTop: 16, fontSize: 12, opacity: 0.9 }}>As of {model.cover.asOf} | Peak debt {fmt(model.capital.peakDebt)} ({currency})</div>
        </section>
      );
    case 'executive_summary':
      return <section data-testid="ln-sec-exec"><h2 style={heading}>Executive Summary</h2>{narr(inputs.executiveSummary, 'Add the executive summary in the form to the left.')}</section>;
    case 'facility_terms':
      return (
        <section data-testid="ln-sec-facility">
          <h2 style={heading}>Facility Terms</h2>
          {model.facilities.length === 0 ? <p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', color: BRAND.slate }}>No debt facilities configured.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                <thead><tr style={{ background: BRAND.navy, color: '#fff' }}>
                  <th style={miniThL}>Facility</th><th style={miniTh}>Rate</th><th style={miniTh}>LTV</th><th style={miniTh}>Share</th><th style={miniTh}>Cash Sweep</th>
                </tr></thead>
                <tbody>
                  {model.facilities.map((f, i) => (
                    <tr key={i}>
                      <td style={miniTdL}>{f.name}</td>
                      <td style={miniTd}>{f.interestRatePct.toFixed(2)}%</td>
                      <td style={miniTd}>{f.ltvPct.toFixed(0)}%</td>
                      <td style={miniTd}>{f.facilitySharePct == null ? 'n/a' : `${f.facilitySharePct.toFixed(0)}%`}</td>
                      <td style={miniTd}>{f.sweepRatioPct == null ? 'none' : `${f.sweepRatioPct.toFixed(0)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      );
    case 'capital_structure': {
      const c = model.capital;
      return (
        <section data-testid="ln-sec-capital">
          <h2 style={heading}>Capital Structure <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.slate }}>({currency})</span></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <Kpi label="Debt" value={pctN(c.debtPct)} sub="of total sources" />
            <Kpi label="Cash Equity" value={pctN(c.cashEquityPct)} sub="of total sources" />
            <Kpi label="Peak Debt" value={fmt(c.peakDebt)} />
            <Kpi label="Debt at Exit" value={fmt(c.remainingDebtAtExit)} />
            <Kpi label="Debt Tenor" value={c.tenorYears == null ? 'n/a' : `${c.tenorYears} yrs`} />
            <Kpi label="Peak Equity" value={fmt(c.peakEquity)} sub="equity at risk" />
          </div>
        </section>
      );
    }
    case 'sources_uses':
      return (
        <section data-testid="ln-sec-sources">
          <h2 style={heading}>Sources &amp; Uses / Funding Gap <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.slate }}>({currency})</span></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <SourcesUsesList title="Sources" rows={model.sourcesUses.sources} total={model.sourcesUses.totalSources} fmt={fmt} />
            <SourcesUsesList title="Uses" rows={model.sourcesUses.uses} total={model.sourcesUses.totalUses} fmt={fmt} />
          </div>
        </section>
      );
    case 'repayment_schedule':
      return (
        <section data-testid="ln-sec-repay">
          <h2 style={heading}>Repayment &amp; Cash-Sweep Schedule <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.slate }}>({currency})</span></h2>
          <PeriodMini yearLabels={model.yearLabels} fmt={fmt} rows={[
            { label: 'Debt Drawdown', values: model.repayment.drawdown },
            { label: 'Interest Paid', values: model.repayment.interest },
            { label: 'Principal (incl. sweep)', values: model.repayment.principal },
            { label: 'Cash Sweep', values: model.repayment.sweep },
            { label: 'Debt Outstanding', values: model.repayment.debtOutstanding },
          ]} />
        </section>
      );
    case 'covenant_analysis':
      return (
        <section data-testid="ln-sec-covenants">
          <h2 style={heading}>Covenant Analysis</h2>
          <CovenantTable covenants={model.covenants} yearLabels={model.yearLabels} />
        </section>
      );
    case 'key_cash_flows':
      return (
        <section data-testid="ln-sec-cashflows">
          <h2 style={heading}>Key Cash Flows <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.slate }}>({currency})</span></h2>
          <PeriodMini yearLabels={model.yearLabels} fmt={fmt} rows={[
            { label: 'Operating Cash Flow', values: model.keyCashFlows.cfo },
            { label: 'Investing Cash Flow', values: model.keyCashFlows.cfi },
            { label: 'Financing Cash Flow', values: model.keyCashFlows.cff },
            { label: 'Closing Cash', values: model.keyCashFlows.closing },
          ]} />
        </section>
      );
    case 'security_collateral':
      return <section data-testid="ln-sec-security"><h2 style={heading}>Security &amp; Collateral</h2>{narr(inputs.securityCollateral, 'Add security / collateral notes in the form to the left.')}</section>;
    case 'covenant_commentary':
      return <section data-testid="ln-sec-covcomm"><h2 style={heading}>Covenant Commentary</h2>{narr(inputs.covenantCommentary, 'Add covenant commentary in the form to the left.')}</section>;
    case 'disclaimers':
      return (
        <section data-testid="ln-sec-disc">
          <h2 style={heading}>Disclaimers</h2>
          {narr(inputs.disclaimers, 'Add disclaimers in the form to the left.')}
          <p style={{ margin: '10px 0 0', fontSize: 10, color: BRAND.slate }}>Strictly private and confidential. Figures are model outputs, not a guarantee of future performance or a commitment to lend.</p>
        </section>
      );
    default:
      return <></>;
  }
}

// ── Investor One-Pager section renderer (Phase 2, compact) ──
function OnePagerSection({ sectionKey, model, inputs, fmt, currency }: {
  sectionKey: string; model: OnePagerReportModel; inputs: ReportInputs; fmt: (n: number) => string; currency: string;
}): React.JSX.Element {
  const heading: React.CSSProperties = { fontFamily: `'${inputs.fontHeading}', serif`, color: BRAND.navy, fontSize: 14, fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' };
  const mult = (v: number): string => fmtX(v);

  switch (sectionKey) {
    case 'deal_at_a_glance': {
      const d = model.dealAtAGlance;
      return (
        <section data-testid="op-sec-glance" style={{ background: BRAND.navy, color: '#fff', borderRadius: 9, padding: '18px 20px' }}>
          <div style={{ fontFamily: `'${inputs.fontHeading}', serif`, fontSize: 22, fontWeight: 800 }}>{d.projectName || 'Untitled Project'}</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{d.location || 'Location not set'} | {d.phaseCount} {d.phaseCount === 1 ? 'phase' : 'phases'} | {d.assetMix.map((a) => a.name).join(', ') || 'no assets'}</div>
        </section>
      );
    }
    case 'headline_returns': {
      const h = model.headline;
      return (
        <section data-testid="op-sec-returns">
          <div style={heading}>Headline Returns</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <MiniTile label="Project IRR" value={pctN(h.projectIrr)} good />
            <MiniTile label="Equity IRR" value={pctN(h.equityIrr)} good />
            <MiniTile label="MOIC" value={mult(h.equityMultiple)} />
            <MiniTile label="Project MOIC" value={mult(h.projectMoic)} />
          </div>
        </section>
      );
    }
    case 'capital_ask': {
      const c = model.capitalAsk;
      return (
        <section data-testid="op-sec-ask">
          <div style={heading}>Capital Ask <span style={{ fontSize: 10, fontWeight: 400, color: BRAND.slate, textTransform: 'none' }}>({currency})</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <MiniTile label="Total Equity" value={fmt(c.totalEquity)} />
            <MiniTile label="Peak Equity" value={fmt(c.peakEquity)} />
            <MiniTile label="Peak Debt" value={fmt(c.peakDebt)} />
            <MiniTile label="Debt / Equity" value={`${pctN(c.debtPct)} / ${pctN(c.equityPct)}`} />
          </div>
        </section>
      );
    }
    case 'timeline': {
      const t = model.timeline;
      return (
        <section data-testid="op-sec-timeline">
          <div style={heading}>Timeline</div>
          <div style={{ fontSize: 13, color: '#2A3444' }}>{t.startYear} to {t.exitYear} <span style={{ color: BRAND.slate }}>({t.durationYears} year hold)</span></div>
        </section>
      );
    }
    case 'asset_mix':
      return (
        <section data-testid="op-sec-assetmix">
          <div style={heading}>Asset Mix</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {model.assetMix.length === 0 ? <span style={{ fontSize: 12, color: BRAND.slate, fontStyle: 'italic' }}>No assets</span>
              : model.assetMix.map((a, i) => <span key={i} style={{ fontSize: 11, fontWeight: 600, color: BRAND.navy, background: BRAND.pale, padding: '4px 10px', borderRadius: 20 }}>{a.name} <span style={{ color: BRAND.slate, fontWeight: 400 }}>({a.strategy})</span></span>)}
          </div>
        </section>
      );
    case 'thesis_contact':
      return (
        <section data-testid="op-sec-thesis" style={{ borderTop: `1px solid ${BRAND.pale}`, paddingTop: 12 }}>
          {model.thesisLine.trim()
            ? <p style={{ margin: '0 0 8px', fontSize: 13, fontStyle: 'italic', color: '#2A3444' }}>&ldquo;{model.thesisLine}&rdquo;</p>
            : <p style={{ margin: '0 0 8px', fontSize: 12, fontStyle: 'italic', color: BRAND.slate }}>Add a short thesis line in the form to the left.</p>}
          <div style={{ fontSize: 11, color: BRAND.slate }}>
            {model.preparedBy.length > 0 && <span>Prepared by <strong style={{ color: BRAND.navy }}>{model.preparedBy.map((p) => p.name).join(', ')}</strong>. </span>}
            {model.contacts.length > 0 && <span>Contact: <strong style={{ color: BRAND.navy }}>{model.contacts.map((p) => `${p.name}${p.identifier ? ` (${p.identifier})` : ''}`).join(', ')}</strong>.</span>}
          </div>
        </section>
      );
    default:
      return <></>;
  }
}

// ── Covenant table (per-period heatmap + verdict) ──
function CovenantTable({ covenants, yearLabels }: { covenants: LenderCovenantRow[]; yearLabels: number[] }): React.JSX.Element {
  if (covenants.length === 0) return <p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', color: BRAND.slate }}>No covenants configured (see the RE Metrics tab).</p>;
  const cellPass = (row: LenderCovenantRow, v: number): boolean => (row.operator === 'min' ? v >= row.threshold : v <= row.threshold);
  const th: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: 10 };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const tdL: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', fontSize: 10, borderBottom: `1px solid ${BRAND.pale}`, whiteSpace: 'nowrap' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
        <thead>
          <tr style={{ background: BRAND.navy, color: '#fff' }}>
            <th style={thL}>Covenant</th>
            <th style={th}>Threshold</th>
            <th style={th}>Worst</th>
            <th style={th}>Result</th>
            {yearLabels.map((y, i) => <th key={i} style={th}>{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {covenants.map((row) => (
            <tr key={row.id}>
              <td style={tdL}>{row.label}<div style={{ fontSize: 9, color: BRAND.slate }}>{row.operator === 'min' ? 'min' : 'max'}{row.basisLabel ? ` | ${row.basisLabel}` : ''}</div></td>
              <td style={{ ...th, borderBottom: `1px solid ${BRAND.pale}` }}>{covFmt(row.threshold, row.unit)}</td>
              <td style={{ ...th, borderBottom: `1px solid ${BRAND.pale}`, fontWeight: 700 }}>{covFmt(row.worst, row.unit)}</td>
              <td style={{ ...th, borderBottom: `1px solid ${BRAND.pale}` }}>
                {row.pass == null ? <span style={{ color: BRAND.slate }}>n/a</span>
                  : <span style={{ fontWeight: 800, color: row.pass ? BRAND.green : BRAND.red }}>{row.pass ? 'PASS' : 'FAIL'}</span>}
              </td>
              {row.exitOnly
                ? yearLabels.map((_, i) => <td key={i} style={{ ...th, borderBottom: `1px solid ${BRAND.pale}`, color: BRAND.slate }}>{i === yearLabels.length - 1 ? covFmt(row.worst, row.unit) : ''}</td>)
                : row.seriesPerPeriod.map((v, i) => {
                    const has = v != null && Number.isFinite(v);
                    const ok = has ? cellPass(row, v as number) : null;
                    return (
                      <td key={i} style={{ ...th, borderBottom: `1px solid ${BRAND.pale}`,
                        background: ok == null ? 'transparent' : ok ? 'rgba(46,125,82,0.14)' : 'rgba(220,38,38,0.14)',
                        color: ok == null ? BRAND.slate : ok ? BRAND.green : BRAND.red, fontWeight: has ? 600 : 400 }}>
                        {has ? covFmt(v as number, row.unit) : ''}
                      </td>
                    );
                  })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Small presentational helpers ──
const miniTh: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: 10 };
const miniThL: React.CSSProperties = { ...miniTh, textAlign: 'left' };
const miniTd: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 10, borderBottom: `1px solid ${BRAND.pale}` };
const miniTdL: React.CSSProperties = { ...miniTd, textAlign: 'left', whiteSpace: 'nowrap' };

function PeriodMini({ yearLabels, rows, fmt }: { yearLabels: number[]; rows: Array<{ label: string; values: number[] }>; fmt: (n: number) => string }): React.JSX.Element {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr style={{ background: BRAND.navy, color: '#fff' }}>
            <th style={miniThL}>Line</th>
            {yearLabels.map((y, i) => <th key={i} style={miniTh}>{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={miniTdL}>{r.label}</td>
              {yearLabels.map((_, i) => <td key={i} style={miniTd}>{fmt(r.values[i] ?? 0)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourcesUsesList({ title, rows, total, fmt }: { title: string; rows: Array<{ label: string; value: number }>; total: number; fmt: (n: number) => string }): React.JSX.Element {
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: '#2A3444' };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.navy, marginBottom: 4 }}>{title}</div>
      {rows.filter((r) => Math.abs(r.value) > 0.5).map((r) => (
        <div key={r.label} style={row}><span style={{ color: BRAND.slate }}>{r.label}</span><span>{fmt(r.value)}</span></div>
      ))}
      <div style={{ ...row, borderTop: `1px solid ${BRAND.border}`, marginTop: 4, fontWeight: 800, color: BRAND.navy }}><span>Total {title}</span><span>{fmt(total)}</span></div>
    </div>
  );
}

function Kpi({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }): React.JSX.Element {
  return (
    <div style={{ background: BRAND.pale, border: `1px solid ${BRAND.border}`, borderRadius: 9, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: good ? BRAND.green : BRAND.navy, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: BRAND.slate, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function MiniTile({ label, value, good }: { label: string; value: string; good?: boolean }): React.JSX.Element {
  return (
    <div style={{ background: BRAND.pale, border: `1px solid ${BRAND.border}`, borderRadius: 7, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: BRAND.slate, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: good ? BRAND.green : BRAND.navy, marginTop: 2 }}>{value}</div>
    </div>
  );
}
function Fact({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#1A2230', marginTop: 2 }}>{children}</div>
    </div>
  );
}
function FormField({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.slate, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}
// Grouped, collapsible-free band of related IC narrative fields.
function FormGroup({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ border: `1px solid ${BRAND.pale}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: BRAND.navy, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      {children}
    </div>
  );
}
// Repeater over Array<{ [keyA]: string; [keyB]: string }>. Generic two-field row
// used by exec points, market points, risks, regulatory, and market stats.
function PairRepeater({ items, onChange, keyA, keyB, labelA, labelB, addLabel, testid }: {
  items: Array<Record<string, string>>; onChange: (next: Array<Record<string, string>>) => void;
  keyA: string; keyB: string; labelA: string; labelB: string; addLabel: string; testid?: string;
}): React.JSX.Element {
  const set = (i: number, k: string, v: string): void => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const remove = (i: number): void => onChange(items.filter((_, j) => j !== i));
  const add = (): void => onChange([...items, { [keyA]: '', [keyB]: '' }]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={testid}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, border: `1px solid ${BRAND.border}`, borderRadius: 6, padding: 8 }} data-testid={testid ? `${testid}-row-${i}` : undefined}>
          <input value={it[keyA] ?? ''} onChange={(e) => set(i, keyA, e.target.value)} placeholder={labelA} style={{ ...inputStyle, fontWeight: 600 }} />
          <textarea value={it[keyB] ?? ''} onChange={(e) => set(i, keyB, e.target.value)} placeholder={labelB} rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          <button type="button" onClick={() => remove(i)} style={{ alignSelf: 'flex-end', border: 'none', background: 'none', color: BRAND.red, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={add} data-testid={testid ? `${testid}-add` : undefined} style={{ alignSelf: 'flex-start', border: `1px dashed ${BRAND.border}`, background: '#fff', color: BRAND.navy, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ {addLabel}</button>
    </div>
  );
}
// Repeater over string[] (conditions precedent).
function ListRepeater({ items, onChange, addLabel, testid }: {
  items: string[]; onChange: (next: string[]) => void; addLabel: string; testid?: string;
}): React.JSX.Element {
  const set = (i: number, v: string): void => onChange(items.map((it, j) => (j === i ? v : it)));
  const remove = (i: number): void => onChange(items.filter((_, j) => j !== i));
  const add = (): void => onChange([...items, '']);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid={testid}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={it} onChange={(e) => set(i, e.target.value)} style={inputStyle} />
          <button type="button" onClick={() => remove(i)} style={{ border: 'none', background: 'none', color: BRAND.red, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>x</button>
        </div>
      ))}
      <button type="button" onClick={add} data-testid={testid ? `${testid}-add` : undefined} style={{ alignSelf: 'flex-start', border: `1px dashed ${BRAND.border}`, background: '#fff', color: BRAND.navy, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ {addLabel}</button>
    </div>
  );
}
const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 9px', border: `1px solid ${BRAND.border}`, borderRadius: 6, fontSize: 12, color: '#1A2230', boxSizing: 'border-box', background: '#FFFDF7' };
function Textarea({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid?: string }): React.JSX.Element {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />;
}
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }): React.JSX.Element {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
}
// Small segmented toggle for enum settings (case pin, money scale).
function SegToggle({ value, onChange, options, testid }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; testid?: string }): React.JSX.Element {
  return (
    <div style={{ display: 'inline-flex', gap: 4, background: '#EEF3FA', padding: 3, borderRadius: 8 }} data-testid={testid}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} data-testid={testid ? `${testid}-${o.value}` : undefined}
          style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: value === o.value ? BRAND.navy : 'transparent', color: value === o.value ? '#fff' : BRAND.slate }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const known = FONT_CHOICES.includes(value);
  return (
    <select value={known ? value : '__custom__'} onChange={(e) => { const v = e.target.value; if (v !== '__custom__') onChange(v); }} style={inputStyle}>
      {FONT_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
      {!known && <option value="__custom__">{value} (custom)</option>}
    </select>
  );
}
function arrowBtn(disabled: boolean): React.CSSProperties {
  return { border: `1px solid ${BRAND.border}`, background: '#fff', color: disabled ? '#C9CFD8' : BRAND.navy, borderRadius: 5, width: 22, height: 22, cursor: disabled ? 'default' : 'pointer', fontSize: 12, lineHeight: '18px', padding: 0 };
}
