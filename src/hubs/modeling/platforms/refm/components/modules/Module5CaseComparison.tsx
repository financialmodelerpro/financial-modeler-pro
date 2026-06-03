'use client';

/**
 * Module5CaseComparison.tsx (Cases Phase 2, 2026-06-03)
 *
 * The Returns "Case Comparison" tab. The other Returns tabs render the ACTIVE
 * case; this one computes every case (Management base + each scenario) through
 * the SAME pure pipeline (applyOverrides -> computeFinancialsSnapshot ->
 * computeReturnsSnapshot) and lays the headline KPIs out side by side, with a
 * delta vs the Management Case under each scenario value.
 *
 * Reads the global store directly. The active case's model uses the live
 * (possibly unsaved) edits; the other cases use the base model + their stored
 * overrides, so the comparison always reflects what the user sees on screen.
 */
import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { applyOverrides, buildOverrides, baseCaseId } from '../../lib/cases/applyOverrides';
import type { HydrateSnapshot } from '../../lib/state/module1-store';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { fmtPct, fmtX } from './Module5Shared';

type KpiKind = 'pct' | 'money' | 'mult';
interface KpiDef {
  label: string;
  kind: KpiKind;
  sub?: string;
  get: (rs: ReturnType<typeof computeReturnsSnapshot>) => number | null;
}

// Headline KPIs, in the same wording as the Returns + RE Metrics tabs.
const KPIS: KpiDef[] = [
  { label: 'Project IRR (FCFF)', kind: 'pct', get: (rs) => rs.result.fcff.irr },
  { label: 'Equity IRR (FCFE)', kind: 'pct', get: (rs) => rs.result.fcfe.irr },
  { label: 'Distributed-Equity IRR', kind: 'pct', get: (rs) => rs.result.dividends.irr },
  { label: 'Equity MOIC', kind: 'mult', get: (rs) => rs.result.fcfe.moic },
  { label: 'Equity Multiple', kind: 'mult', sub: 'distributions / invested', get: (rs) => rs.result.realEstate.equityMultiple },
  { label: 'Gross Development Value', kind: 'money', get: (rs) => rs.developmentEconomics.gdv },
  { label: 'Total Development Cost', kind: 'money', get: (rs) => rs.totalDevelopmentCost },
  { label: 'Profit after Financing', kind: 'money', get: (rs) => rs.developmentEconomics.profitAfterFinancing },
  { label: 'Development Margin', kind: 'pct', sub: 'profit / GDV', get: (rs) => rs.developmentEconomics.developmentMargin },
  { label: 'Peak Equity', kind: 'money', get: (rs) => rs.result.realEstate.peakEquity },
  { label: 'Terminal Equity Value', kind: 'money', get: (rs) => rs.terminalEquityValue },
];

export default function Module5CaseComparison(): React.JSX.Element {
  const s = useModule1Store(
    useShallow((st) => ({
      cases: st.cases, activeCaseId: st.activeCaseId, baseSnapshot: st.baseSnapshot,
      project: st.project, phases: st.phases, parcels: st.parcels,
      landAllocationMode: st.landAllocationMode, assets: st.assets, subUnits: st.subUnits,
      costLines: st.costLines, costOverrides: st.costOverrides,
      financingTranches: st.financingTranches, equityContributions: st.equityContributions,
      migrationsApplied: st.migrationsApplied,
      setActiveCase: st.setActiveCase,
    })),
  );

  const scale: DisplayScale = (s.project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (s.project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(s.project.currency ?? 'SAR', scale);

  const baseId = baseCaseId(s.cases);

  // Compute every case's KPIs. The active case uses the live model; others use
  // base + stored overrides. Memoised on the model + cases so it only reruns
  // when something actually changes.
  const computed = useMemo(() => {
    const liveModel = {
      project: s.project, phases: s.phases, parcels: s.parcels, landAllocationMode: s.landAllocationMode,
      assets: s.assets, subUnits: s.subUnits, costLines: s.costLines, costOverrides: s.costOverrides,
      financingTranches: s.financingTranches, equityContributions: s.equityContributions, migrationsApplied: s.migrationsApplied,
    } as HydrateSnapshot;
    const activeIsBase = s.activeCaseId === baseId;
    const baseModel: HydrateSnapshot = activeIsBase ? liveModel : s.baseSnapshot;

    return s.cases.map((c) => {
      let model: HydrateSnapshot;
      if (c.id === s.activeCaseId) model = liveModel;
      else if (c.role === 'base') model = baseModel;
      else model = applyOverrides(baseModel, c.overrides);
      const values: Record<string, number | null> = {};
      try {
        const snap = computeFinancialsSnapshot(model as never);
        const rs = computeReturnsSnapshot(snap, model.project);
        for (const k of KPIS) values[k.label] = k.get(rs);
      } catch {
        for (const k of KPIS) values[k.label] = null;
      }
      const overrideCount = c.role === 'base'
        ? 0
        : (c.id === s.activeCaseId
            // active scenario: count live (possibly unsaved) overrides
            ? Object.keys(buildOverrides(s.baseSnapshot, liveModel)).length
            : Object.keys(c.overrides ?? {}).length);
      return { id: c.id, name: c.name, role: c.role, values, overrideCount };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cases, s.activeCaseId, s.baseSnapshot, s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions, s.migrationsApplied, baseId]);

  const baseCol = computed.find((c) => c.id === baseId) ?? computed[0];

  const fmtVal = (v: number | null, kind: KpiKind): string => {
    if (v == null || !Number.isFinite(v)) return 'n/a';
    if (kind === 'pct') return fmtPct(v);
    if (kind === 'mult') return fmtX(v);
    return fmt(v);
  };
  const fmtDelta = (v: number | null, base: number | null, kind: KpiKind): string => {
    if (v == null || base == null || !Number.isFinite(v) || !Number.isFinite(base)) return '';
    const d = v - base;
    if (Math.abs(d) < 1e-9) return '0';
    const sign = d > 0 ? '+' : '';
    if (kind === 'pct') return `${sign}${(d * 100).toFixed(1)} pp`;
    if (kind === 'mult') return `${sign}${d.toFixed(2)}x`;
    return `${sign}${fmt(d)}`;
  };
  const deltaTone = (v: number | null, base: number | null): string => {
    if (v == null || base == null) return 'var(--color-meta)';
    const d = v - base;
    if (Math.abs(d) < 1e-9) return 'var(--color-meta)';
    return d > 0 ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)';
  };

  const th: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 12 };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 12, borderBottom: '1px solid var(--color-border)' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  return (
    <div data-testid="module5-cases" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }}>
        Every case computed through the full model. The Management Case is the base; each scenario applies its own input overrides.
        Money figures in {currency}. The small figure under each scenario is the delta vs the Management Case (green = better, amber = worse for that metric&apos;s usual direction).
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={thL}>Metric</th>
              {computed.map((c) => (
                <th key={c.id} style={th}>
                  <button
                    type="button" onClick={() => s.setActiveCase(c.id)}
                    data-testid={`case-col-${c.id}`}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-on-primary-navy)', fontWeight: c.id === s.activeCaseId ? 800 : 600, textAlign: 'right' }}
                    title={c.id === s.activeCaseId ? 'Active case' : 'Switch to this case'}
                  >
                    {c.role === 'base' ? '★ ' : '◆ '}{c.name}
                    {c.id === s.activeCaseId && <span style={{ fontSize: 9, marginLeft: 4 }}>(active)</span>}
                  </button>
                  <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>
                    {c.role === 'base' ? 'base' : `${c.overrideCount} override${c.overrideCount === 1 ? '' : 's'}`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KPIS.map((k) => (
              <tr key={k.label}>
                <td style={tdL}>
                  {k.label}
                  {k.sub && <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>{k.sub}</div>}
                </td>
                {computed.map((c) => {
                  const v = c.values[k.label];
                  const isBase = c.id === baseId;
                  return (
                    <td key={c.id} style={{ ...td, background: c.id === s.activeCaseId ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : undefined }}>
                      <div style={{ fontWeight: 600, color: 'var(--color-heading)' }}>{fmtVal(v, k.kind)}</div>
                      {!isBase && (
                        <div style={{ fontSize: 10, color: deltaTone(v, baseCol?.values[k.label] ?? null) }}>
                          {fmtDelta(v, baseCol?.values[k.label] ?? null, k.kind)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
