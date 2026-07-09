'use client';

/**
 * Module7Reports.tsx (REFM Module 7 Reports, Phase 1)
 *
 * IC Report, on-screen preview ONLY (no export yet, Phase 3 covers PPT/PDF).
 * Proves the pipeline end to end:
 *   - financials auto-filled from the computed snapshot (read-only, no recompute),
 *   - narrative + chrome + fonts from a per-project report-inputs form (saved to
 *     refm_report_inputs via /api/refm/projects/[id]/report-inputs),
 *   - parties pulled from M1 by role,
 *   - assembled by buildICReportModel and rendered with the brand styling.
 *
 * No engine change: computeFinancialsSnapshot + computeReturnsSnapshot are the
 * same pure calls the Returns tab uses; this surface only reads them.
 *
 * No em dashes in this file.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store, type HydrateSnapshot } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { buildICReportModel } from '../../lib/reports/icReport';
import { buildCaseComparisonReport } from '../../lib/reports/caseComparisonReport';
import { buildOverrides, baseCaseId } from '../../lib/cases/applyOverrides';
import { listParties, getReportInputs, saveReportInputs } from '../../lib/persistence/client';
import type { Party } from '../../lib/parties';
import {
  IC_SECTIONS, FONT_CHOICES, defaultReportInputs, normalizeSectionConfig,
  type ReportInputs, type ICSectionKey, type SectionSetting,
} from '../../lib/reportInputs';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { fmtPct, fmtX } from './Module5Shared';

// ── Brand palette (IC deck). Navy / white / slate / pale + mid blue / green. ──
const BRAND = {
  navy: '#1B4F8A',
  white: '#FFFFFF',
  slate: '#5A6675',
  pale: '#DDE7F3',
  mid: '#7FA8D9',
  green: '#2E7D52',
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

  // Live snapshot (same pure calls as the Returns tab, read-only).
  const rs = useMemo(() => {
    const snap = computeFinancialsSnapshot(s as never);
    return { snap, returns: computeReturnsSnapshot(snap, s.project) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions, s.migrationsApplied]);

  // Scenario comparison (only when more than the base case exists).
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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!activeProjectId) { setParties([]); setInputs(defaultReportInputs()); setDirty(false); return; }
    void listParties(activeProjectId).then(({ data }) => { if (alive && data) setParties(data.parties); });
    void getReportInputs(activeProjectId).then(({ data }) => {
      if (!alive) return;
      setInputs(data?.inputs ? { ...data.inputs, sectionConfig: normalizeSectionConfig(data.inputs.sectionConfig) } : defaultReportInputs());
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
    if (data?.inputs) setInputs({ ...data.inputs, sectionConfig: normalizeSectionConfig(data.inputs.sectionConfig) });
    setDirty(false);
    setNotice({ text: 'Report inputs saved.', type: 'success' });
    setTimeout(() => setNotice(null), 2600);
  }, [activeProjectId, inputs, saving]);

  // Ordered, visible sections.
  const orderedSections = useMemo(() => [...inputs.sectionConfig].sort((a, b) => a.order - b.order), [inputs.sectionConfig]);
  const moveSection = (key: ICSectionKey, dir: -1 | 1): void => {
    const list = [...orderedSections];
    const i = list.findIndex((x) => x.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch({ sectionConfig: list.map((x, idx) => ({ ...x, order: idx })) });
  };
  const toggleSection = (key: ICSectionKey): void =>
    patch({ sectionConfig: orderedSections.map((x) => (x.key === key ? { ...x, visible: !x.visible } : x)) });

  const model = useMemo(() => buildICReportModel({
    project: s.project, phases: s.phases, assets: s.assets,
    rs: rs.returns, snap: rs.snap, parties,
    asOf: new Date().toISOString().slice(0, 10),
    scenarios, cases: s.cases,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rs, parties, scenarios, s.project, s.phases, s.assets, s.cases]);

  if (!activeProjectId) {
    return <div style={{ padding: 40, textAlign: 'center', color: BRAND.slate }}>Open or save a project first to build its IC report.</div>;
  }

  const labelOf = (k: ICSectionKey): string => IC_SECTIONS.find((x) => x.key === k)?.label ?? k;

  return (
    <div data-testid="module7-ic" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: 'var(--sp-3)', alignItems: 'start', width: '100%' }}>
      {/* ── Left: report inputs form ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: BRAND.navy }}>IC Report inputs</h3>
          <button type="button" onClick={save} disabled={saving || !dirty}
            data-testid="ic-save"
            style={{ background: dirty ? BRAND.navy : '#9CA3AF', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>
            {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
        {notice && <div style={{ fontSize: 12, fontWeight: 600, color: notice.type === 'success' ? BRAND.green : '#B91C1C' }}>{notice.text}</div>}

        <FormField label="Executive summary / thesis"><Textarea value={inputs.executiveSummary} onChange={(v) => patch({ executiveSummary: v })} testid="ic-exec" /></FormField>
        <FormField label="Key risks & mitigants"><Textarea value={inputs.keyRisks} onChange={(v) => patch({ keyRisks: v })} testid="ic-risks" /></FormField>
        <FormField label="Recommendation / ask"><Textarea value={inputs.recommendation} onChange={(v) => patch({ recommendation: v })} testid="ic-rec" /></FormField>
        <FormField label="Disclaimers"><Textarea value={inputs.disclaimers} onChange={(v) => patch({ disclaimers: v })} testid="ic-disc" /></FormField>

        <FormField label="Header text"><Input value={inputs.headerText} onChange={(v) => patch({ headerText: v })} placeholder="e.g. Strictly Private & Confidential" /></FormField>
        <FormField label="Footer text"><Input value={inputs.footerText} onChange={(v) => patch({ footerText: v })} placeholder="e.g. Prepared for the Investment Committee" /></FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FormField label="Body font"><FontPicker value={inputs.fontBody} onChange={(v) => patch({ fontBody: v })} /></FormField>
          <FormField label="Heading font"><FontPicker value={inputs.fontHeading} onChange={(v) => patch({ fontHeading: v })} /></FormField>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.slate, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sections</div>
          <div style={{ border: `1px solid ${BRAND.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {orderedSections.map((sec, i) => (
              <div key={sec.key} data-testid={`ic-section-row-${sec.key}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderTop: i ? `1px solid ${BRAND.pale}` : 'none', background: sec.visible ? '#fff' : '#F5F7FA' }}>
                <input type="checkbox" checked={sec.visible} onChange={() => toggleSection(sec.key)} data-testid={`ic-toggle-${sec.key}`} />
                <span style={{ flex: 1, fontSize: 12, color: sec.visible ? BRAND.navy : BRAND.slate, fontWeight: 600 }}>{labelOf(sec.key)}</span>
                <button type="button" onClick={() => moveSection(sec.key, -1)} disabled={i === 0} title="Move up" style={arrowBtn(i === 0)}>↑</button>
                <button type="button" onClick={() => moveSection(sec.key, 1)} disabled={i === orderedSections.length - 1} title="Move down" style={arrowBtn(i === orderedSections.length - 1)}>↓</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right: assembled IC preview ── */}
      <div data-testid="ic-preview" style={{ background: '#fff', border: `1px solid ${BRAND.border}`, borderRadius: 10, overflow: 'hidden', fontFamily: `'${inputs.fontBody}', sans-serif`, color: '#1A2230' }}>
        {inputs.headerText && (
          <div style={{ background: BRAND.navy, color: '#fff', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 24px', textAlign: 'right' }}>{inputs.headerText}</div>
        )}
        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {orderedSections.filter((sec) => sec.visible).map((sec) => (
            <ICSection key={sec.key} sectionKey={sec.key} model={model} inputs={inputs} fmt={fmt} currency={currency} scenarios={scenarios} />
          ))}
        </div>
        <div style={{ borderTop: `2px solid ${BRAND.navy}`, padding: '10px 24px', display: 'flex', justifyContent: 'space-between', color: BRAND.slate, fontSize: 10 }}>
          <span>{inputs.footerText || 'Strictly Private & Confidential'}</span>
          <span>{model.cover.projectName} | {model.cover.asOf}</span>
        </div>
      </div>
    </div>
  );
}

// ── Section renderer ──────────────────────────────────────────────────────────
function ICSection({ sectionKey, model, inputs, fmt, currency, scenarios }: {
  sectionKey: ICSectionKey;
  model: ReturnType<typeof buildICReportModel>;
  inputs: ReportInputs;
  fmt: (n: number) => string;
  currency: string;
  scenarios: ReturnType<typeof buildCaseComparisonReport> | null;
}): React.JSX.Element {
  const heading = { fontFamily: `'${inputs.fontHeading}', serif`, color: BRAND.navy, fontSize: 17, fontWeight: 800, margin: '0 0 12px', borderBottom: `2px solid ${BRAND.pale}`, paddingBottom: 6 } as React.CSSProperties;
  const pct = (v: number | null): string => (v == null || !Number.isFinite(v) ? 'n/a' : fmtPct(v));
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
          <div style={{ marginTop: 22, fontSize: 10, opacity: 0.8, borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: 10 }}>
            Strictly Private &amp; Confidential. For the intended recipient only.
          </div>
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
            <Kpi label="Project IRR" value={pct(h.projectIrr)} sub="unlevered (FCFF)" good />
            <Kpi label="Equity IRR" value={pct(h.equityIrr)} sub="levered (FCFE)" good />
            <Kpi label="MOIC" value={mult(h.equityMultiple)} sub="equity, distributions / invested" />
            <Kpi label="Distributed-Equity IRR" value={pct(h.distributedEquityIrr)} sub="realised cash" />
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
            <Kpi label="Development Margin" value={pct(d.developmentMargin)} sub="profit / GDV" good={(d.developmentMargin ?? 0) >= 0} />
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
            <Kpi label="Debt" value={pct(c.debtPct)} sub="of total sources" />
            <Kpi label="Cash Equity" value={pct(c.cashEquityPct)} sub="of total sources" />
            <Kpi label="In-Kind Equity" value={pct(c.inKindEquityPct)} sub="land" />
            <Kpi label="Customer Funding" value={pct(c.customerFundingPct)} sub="pre-sales" />
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

// ── Small presentational helpers ──────────────────────────────────────────────
function Kpi({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }): React.JSX.Element {
  return (
    <div style={{ background: BRAND.pale, border: `1px solid ${BRAND.border}`, borderRadius: 9, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: BRAND.slate, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: good ? BRAND.green : BRAND.navy, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: BRAND.slate, marginTop: 2 }}>{sub}</div>}
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
