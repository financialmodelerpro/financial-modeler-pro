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
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store, type HydrateSnapshot } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { buildICReportModel } from '../../lib/reports/icReport';
import { buildLenderReportModel, type LenderReportModel, type LenderCovenantRow } from '../../lib/reports/lenderReport';
import { buildOnePagerReportModel, type OnePagerReportModel } from '../../lib/reports/onePagerReport';
import { buildCaseComparisonReport } from '../../lib/reports/caseComparisonReport';
import { buildOverrides, baseCaseId } from '../../lib/cases/applyOverrides';
import { listParties, getReportInputs, saveReportInputs } from '../../lib/persistence/client';
import type { Party } from '../../lib/parties';
import {
  REPORT_TYPES, SECTIONS, FONT_CHOICES, defaultReportInputs, normalizeAllSectionConfigs,
  type ReportType, type ReportInputs, type ICSectionKey, type SectionSetting,
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
  border: '#C9D8EC',
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

  const rsPair = useMemo(() => {
    const snap = computeFinancialsSnapshot(s as never);
    return { snap, returns: computeReturnsSnapshot(snap, s.project) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions, s.migrationsApplied]);

  const scenarios = useMemo(() => {
    if ((s.cases?.length ?? 0) <= 1) return null;
    const liveModel = {
      project: s.project, phases: s.phases, parcels: s.parcels, landAllocationMode: s.landAllocationMode,
      assets: s.assets, subUnits: s.subUnits, costLines: s.costLines, costOverrides: s.costOverrides,
      financingTranches: s.financingTranches, equityContributions: s.equityContributions, migrationsApplied: s.migrationsApplied,
    } as HydrateSnapshot;
    const baseId = baseCaseId(s.cases);
    const activeIsBase = s.activeCaseId === baseId;
    const baseModel: HydrateSnapshot = activeIsBase ? liveModel : s.baseSnapshot;
    const activeOverrideCount = activeIsBase ? 0 : Object.keys(buildOverrides(s.baseSnapshot, liveModel)).length;
    return buildCaseComparisonReport({ baseModel, cases: s.cases, activeCaseId: s.activeCaseId, liveActiveModel: liveModel, activeOverrideCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cases, s.activeCaseId, s.baseSnapshot, s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions, s.migrationsApplied]);

  // ── Parties + report inputs (per project) ──
  const [parties, setParties] = useState<Party[]>([]);
  const [inputs, setInputs] = useState<ReportInputs>(defaultReportInputs());
  const [reportType, setReportType] = useState<ReportType>('ic');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const icModel = useMemo(() => buildICReportModel({
    project: s.project, phases: s.phases, assets: s.assets, rs: rsPair.returns, snap: rsPair.snap, parties, asOf, scenarios, cases: s.cases,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rsPair, parties, scenarios, s.project, s.phases, s.assets, s.cases]);
  const lenderModel = useMemo(() => buildLenderReportModel({
    project: s.project, financingTranches: s.financingTranches, rs: rsPair.returns, snap: rsPair.snap, parties, asOf,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rsPair, parties, s.project, s.financingTranches]);
  const onePagerModel = useMemo(() => buildOnePagerReportModel({
    project: s.project, phases: s.phases, assets: s.assets, rs: rsPair.returns, snap: rsPair.snap, parties, thesisLine: inputs.thesisLine, asOf,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rsPair, parties, s.project, s.phases, s.assets, inputs.thesisLine]);

  if (!activeProjectId) {
    return <div style={{ padding: 40, textAlign: 'center', color: BRAND.slate }}>Open or save a project first to build its reports.</div>;
  }

  const labelOf = (rt: ReportType, key: string): string => SECTIONS[rt].find((x) => x.key === key)?.label ?? key;
  const compact = reportType === 'onepager';

  return (
    <div data-testid="module7-reports" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: 'var(--sp-3)', alignItems: 'start', width: '100%' }}>
      {/* ── Left: report inputs form ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 8 }}>
        {/* Report type selector */}
        <div style={{ display: 'flex', gap: 4, background: '#EEF3FA', padding: 4, borderRadius: 9 }} data-testid="report-type-selector">
          {REPORT_TYPES.map((rt) => (
            <button key={rt.key} type="button" onClick={() => setReportType(rt.key)} data-testid={`report-type-${rt.key}`}
              style={{ flex: 1, padding: '7px 6px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: reportType === rt.key ? BRAND.navy : 'transparent', color: reportType === rt.key ? '#fff' : BRAND.slate }}>
              {rt.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: BRAND.navy }}>Report inputs</h3>
          <button type="button" onClick={save} disabled={saving || !dirty} data-testid="report-save"
            style={{ background: dirty ? BRAND.navy : '#9CA3AF', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>
            {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
        {notice && <div style={{ fontSize: 12, fontWeight: 600, color: notice.type === 'success' ? BRAND.green : '#B91C1C' }}>{notice.text}</div>}

        {/* Narrative fields relevant to the active report type. */}
        {reportType === 'ic' && (
          <>
            <FormField label="Executive summary / thesis"><Textarea value={inputs.executiveSummary} onChange={(v) => patch({ executiveSummary: v })} testid="rp-exec" /></FormField>
            <FormField label="Key risks & mitigants"><Textarea value={inputs.keyRisks} onChange={(v) => patch({ keyRisks: v })} testid="rp-risks" /></FormField>
            <FormField label="Recommendation / ask"><Textarea value={inputs.recommendation} onChange={(v) => patch({ recommendation: v })} testid="rp-rec" /></FormField>
            <FormField label="Disclaimers"><Textarea value={inputs.disclaimers} onChange={(v) => patch({ disclaimers: v })} testid="rp-disc" /></FormField>
          </>
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
          {orderedSections.filter((sec) => sec.visible).map((sec) => {
            if (reportType === 'ic') return <ICSection key={sec.key} sectionKey={sec.key as ICSectionKey} model={icModel} inputs={inputs} fmt={fmt} currency={currency} scenarios={scenarios} />;
            if (reportType === 'lender') return <LenderSection key={sec.key} sectionKey={sec.key} model={lenderModel} inputs={inputs} fmt={fmt} currency={currency} />;
            return <OnePagerSection key={sec.key} sectionKey={sec.key} model={onePagerModel} inputs={inputs} fmt={fmt} currency={currency} />;
          })}
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
const pctN = (v: number | null): string => (v == null || !Number.isFinite(v) ? 'n/a' : fmtPct(v));
const covFmt = (v: number | null, unit: 'x' | 'pct'): string => (v == null || !Number.isFinite(v) ? 'n/a' : unit === 'pct' ? fmtPct(v) : fmtX(v));

// ── IC section renderer (Phase 1) ──
function ICSection({ sectionKey, model, inputs, fmt, currency, scenarios }: {
  sectionKey: ICSectionKey;
  model: ReturnType<typeof buildICReportModel>;
  inputs: ReportInputs;
  fmt: (n: number) => string;
  currency: string;
  scenarios: ReturnType<typeof buildCaseComparisonReport> | null;
}): React.JSX.Element {
  const heading = sectionHeading(inputs.fontHeading);
  const mult = (v: number): string => fmtX(v);
  const narr = (text: string, empty: string): React.JSX.Element =>
    text.trim()
      ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#2A3444', whiteSpace: 'pre-wrap' }}>{text}</p>
      : <p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', color: BRAND.slate }}>{empty}</p>;

  switch (sectionKey) {
    case 'cover':
      return (
        <section data-testid="ic-sec-cover" style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.mid})`, color: '#fff', borderRadius: 10, padding: '40px 32px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.85 }}>Investment Committee Report</div>
          <div style={{ fontFamily: `'${inputs.fontHeading}', serif`, fontSize: 32, fontWeight: 800, margin: '10px 0 6px' }}>{model.cover.projectName || 'Untitled Project'}</div>
          <div style={{ fontSize: 14, opacity: 0.92 }}>{model.cover.location || 'Location not set'}</div>
          <div style={{ marginTop: 18, display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 12 }}>
            <div><div style={{ opacity: 0.7 }}>As of</div><div style={{ fontWeight: 700 }}>{model.cover.asOf}</div></div>
            {model.cover.preparedBy.length > 0 && (
              <div><div style={{ opacity: 0.7 }}>Prepared by</div><div style={{ fontWeight: 700 }}>{model.cover.preparedBy.map((p) => p.name).join(', ')}</div></div>
            )}
          </div>
          <div style={{ marginTop: 22, fontSize: 10, opacity: 0.8, borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: 10 }}>Strictly Private &amp; Confidential. For the intended recipient only.</div>
        </section>
      );
    case 'executive_summary':
      return <section data-testid="ic-sec-exec"><h2 style={heading}>Executive Summary</h2>{narr(inputs.executiveSummary, 'Add the investment thesis in the form to the left.')}</section>;
    case 'project_overview': {
      const o = model.overview;
      return (
        <section data-testid="ic-sec-overview">
          <h2 style={heading}>Project Overview</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Fact label="Location">{[o.location, o.country].filter(Boolean).join(', ') || 'n/a'}</Fact>
            <Fact label="Phases">{o.phaseCount} {o.phaseCount === 1 ? 'phase' : 'phases'}{o.phaseNames.length ? ` (${o.phaseNames.join(', ')})` : ''}</Fact>
            <Fact label="Timeline">{o.startYear} to {o.exitYear} ({o.durationYears} yrs)</Fact>
            <Fact label="Asset mix">{o.assetMix.length ? o.assetMix.map((a) => a.name).join(', ') : 'n/a'}</Fact>
            {o.sponsors.length > 0 && <Fact label="Sponsor">{o.sponsors.map((p) => p.name).join(', ')}</Fact>}
            {o.developers.length > 0 && <Fact label="Developer">{o.developers.map((p) => p.name).join(', ')}</Fact>}
            {o.investors.length > 0 && <Fact label="Investor(s)">{o.investors.map((p) => p.name).join(', ')}</Fact>}
            {o.contacts.length > 0 && <Fact label="Contact">{o.contacts.map((p) => p.name).join(', ')}</Fact>}
          </div>
        </section>
      );
    }
    case 'headline_returns': {
      const h = model.headline;
      return (
        <section data-testid="ic-sec-returns">
          <h2 style={heading}>Headline Returns</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Kpi label="Project IRR" value={pctN(h.projectIrr)} sub="unlevered (FCFF)" good />
            <Kpi label="Equity IRR" value={pctN(h.equityIrr)} sub="levered (FCFE)" good />
            <Kpi label="MOIC" value={mult(h.equityMultiple)} sub="equity, distributions / invested" />
            <Kpi label="Distributed-Equity IRR" value={pctN(h.distributedEquityIrr)} sub="realised cash" />
            <Kpi label="Project MOIC" value={mult(h.projectMoic)} sub="unlevered, inflow / outflow" />
          </div>
        </section>
      );
    }
    case 'development_economics': {
      const d = model.devEconomics;
      return (
        <section data-testid="ic-sec-deveco">
          <h2 style={heading}>Development Economics <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.slate }}>({currency})</span></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Kpi label="GDV" value={fmt(d.gdv)} sub="gross development value" />
            <Kpi label="Total Dev Cost" value={fmt(d.tdc)} sub="incl. land" />
            <Kpi label="Financing Cost" value={fmt(d.financingCost)} sub="lifetime interest" />
            <Kpi label="Profit after Financing" value={fmt(d.profitAfterFinancing)} good={d.profitAfterFinancing >= 0} />
            <Kpi label="Development Margin" value={pctN(d.developmentMargin)} sub="profit / GDV" good={(d.developmentMargin ?? 0) >= 0} />
          </div>
        </section>
      );
    }
    case 'capital_structure': {
      const c = model.capital;
      return (
        <section data-testid="ic-sec-capital">
          <h2 style={heading}>Capital Structure <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.slate }}>({currency})</span></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Kpi label="Debt" value={pctN(c.debtPct)} sub="of total sources" />
            <Kpi label="Cash Equity" value={pctN(c.cashEquityPct)} sub="of total sources" />
            <Kpi label="In-Kind Equity" value={pctN(c.inKindEquityPct)} sub="land" />
            <Kpi label="Customer Funding" value={pctN(c.customerFundingPct)} sub="pre-sales" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Kpi label="Peak Equity" value={fmt(c.peakEquity)} sub="equity at risk" />
            <Kpi label="Total Equity" value={fmt(c.totalEquity)} sub="invested over hold" />
            <Kpi label="Peak Debt" value={fmt(c.peakDebt)} />
            <Kpi label="Debt at Exit" value={fmt(c.remainingDebtAtExit)} />
          </div>
        </section>
      );
    }
    case 'scenario_comparison': {
      if (!scenarios) return <section data-testid="ic-sec-scenarios"><h2 style={heading}>Scenario Comparison</h2><p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', color: BRAND.slate }}>Add scenario cases in Module 6 to populate this comparison.</p></section>;
      const showKpis = ['Equity IRR (FCFE)', 'Project IRR (FCFF)', 'Equity Multiple', 'Gross Development Value', 'Profit after Financing', 'Development Margin'];
      const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11 };
      const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11, borderBottom: `1px solid ${BRAND.pale}` };
      const kdef = (label: string) => scenarios.kpis.find((k) => k.label === label);
      const fmtKpi = (v: number | null | undefined, kind?: string): string => {
        if (v == null || !Number.isFinite(v)) return 'n/a';
        if (kind === 'pct') return fmtPct(v);
        if (kind === 'mult') return fmtX(v);
        return fmt(v);
      };
      return (
        <section data-testid="ic-sec-scenarios">
          <h2 style={heading}>Scenario Comparison</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
              <thead>
                <tr style={{ background: BRAND.navy, color: '#fff' }}>
                  <th style={{ ...th, textAlign: 'left' }}>Metric</th>
                  {scenarios.columns.map((c) => <th key={c.id} style={th}>{c.role === 'base' ? '★ ' : ''}{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {showKpis.map((label) => {
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
        </section>
      );
    }
    case 'recommendation':
      return <section data-testid="ic-sec-rec"><h2 style={heading}>Recommendation</h2>{narr(inputs.recommendation, 'Add the recommendation / ask in the form to the left.')}</section>;
    case 'disclaimers':
      return (
        <section data-testid="ic-sec-disc">
          <h2 style={heading}>Disclaimers</h2>
          {narr(inputs.disclaimers, 'Add disclaimers in the form to the left.')}
          <p style={{ margin: '10px 0 0', fontSize: 10, color: BRAND.slate }}>This document is strictly private and confidential and is intended solely for the recipient. Figures are model outputs, not a guarantee of future performance.</p>
        </section>
      );
    default:
      return <></>;
  }
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
const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 9px', border: `1px solid ${BRAND.border}`, borderRadius: 6, fontSize: 12, color: '#1A2230', boxSizing: 'border-box', background: '#FFFDF7' };
function Textarea({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid?: string }): React.JSX.Element {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />;
}
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }): React.JSX.Element {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
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
