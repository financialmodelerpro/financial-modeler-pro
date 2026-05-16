'use client';

/**
 * Module2SellModal.tsx (M2 Pass 3, Residential Sell single-cohort form)
 *
 * Per-asset Residential Sell configuration. Opens from the Pass-1
 * Module 2 asset grid (Configure Revenue button on Sell-strategy
 * cards). Captures velocity per sub-unit, cash payment profile,
 * recognition profile, Wafi escrow, indexation. Live preview pane
 * runs the revenue engine on every change so the user sees the 5
 * output schedules update as they type. Save commits the config to
 * Asset.revenue.sell via updateAsset.
 *
 * Pass 3 scope: single cohort per asset (engine supports multi-cohort
 * via its cohort matrix, the UI flattens that to one cohort here).
 * Multi-cohort UI lands in Pass 4.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Asset, SubUnit } from '../../lib/state/module1-types';
import { computeProjectTimeline, computeSubUnitArea } from '@/src/core/calculations';
import {
  computeSellAsset,
  reconcileSellAsset,
  resolveHandoverYear,
  type AssetSellConfig,
  type RecognitionProfile,
  type SubUnitMaterial,
} from '@/src/core/calculations/revenue';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { PercentageInput } from '../ui/PercentageInput';
import { formatAccounting } from '@/src/core/formatters';

interface Props {
  asset: Asset;
  onClose: () => void;
}

const FAST_INPUT: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 6px',
  width: '100%',
  fontSize: 11,
  fontFamily: 'inherit',
};

const READONLY_OUT: React.CSSProperties = {
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  padding: '4px 6px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 11,
  textAlign: 'right',
};

function makeSubUnitMaterial(u: SubUnit): SubUnitMaterial {
  const area = computeSubUnitArea(u);
  if (u.metric === 'units') {
    const count = Math.max(0, u.metricValue);
    const unitArea = Math.max(0, u.unitArea ?? 0);
    const ratePerArea = unitArea > 0 ? u.unitPrice / unitArea : 0;
    return { id: u.id, area, count, ratePerArea, ratePerUnit: u.unitPrice, metric: u.metric };
  }
  return { id: u.id, area, count: 0, ratePerArea: u.unitPrice, ratePerUnit: 0, metric: u.metric };
}

function paddedArray(src: number[] | undefined, length: number, fill = 0): number[] {
  const out = new Array<number>(length).fill(fill);
  if (!src) return out;
  for (let i = 0; i < Math.min(src.length, length); i++) {
    out[i] = src[i] ?? fill;
  }
  return out;
}

function newCohortId(): string {
  return `cohort_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyCohortSubUnits(subUnits: SubUnit[], totalPeriods: number): Array<{ subUnitId: string; preSalesVelocity: number[]; postSalesVelocity: number[] }> {
  return subUnits.map((su) => ({
    subUnitId: su.id,
    preSalesVelocity: new Array<number>(totalPeriods).fill(0),
    postSalesVelocity: new Array<number>(totalPeriods).fill(0),
  }));
}

function seedConfig(asset: Asset, subUnits: SubUnit[], totalPeriods: number, handoverYear: number): AssetSellConfig {
  const existing = asset.revenue?.sell;
  if (existing) {
    // Pass 4: migrate Pass-3 configs (no cohorts) by folding the
    // top-level subUnits velocity into cohorts[0]. Pass-4 configs that
    // already carry cohorts are kept as-is with padding.
    const cohorts = existing.cohorts && existing.cohorts.length > 0
      ? existing.cohorts.map((c) => ({
          id: c.id || newCohortId(),
          name: c.name || 'Cohort',
          subUnits: subUnits.map((su) => {
            const sc = c.subUnits.find((s) => s.subUnitId === su.id);
            return {
              subUnitId: su.id,
              preSalesVelocity: paddedArray(sc?.preSalesVelocity, totalPeriods),
              postSalesVelocity: paddedArray(sc?.postSalesVelocity, totalPeriods),
            };
          }),
          cashPaymentProfile: c.cashPaymentProfile,
          recognitionProfile: c.recognitionProfile,
          pricePerSubUnit: c.pricePerSubUnit,
        }))
      : [{
          id: newCohortId(),
          name: 'Cohort 1',
          subUnits: subUnits.map((su) => {
            const cfg = existing.subUnits.find((s) => s.subUnitId === su.id);
            return {
              subUnitId: su.id,
              preSalesVelocity: paddedArray(cfg?.preSalesVelocity, totalPeriods),
              postSalesVelocity: paddedArray(cfg?.postSalesVelocity, totalPeriods),
            };
          }),
        }];

    return {
      assetId: asset.id,
      subUnits: subUnits.map((su) => ({
        subUnitId: su.id,
        preSalesVelocity: new Array<number>(totalPeriods).fill(0),
        postSalesVelocity: new Array<number>(totalPeriods).fill(0),
      })),
      cashPaymentProfile: {
        percentages: paddedArray(existing.cashPaymentProfile.percentages, totalPeriods),
        profileMode: existing.cashPaymentProfile.profileMode ?? 'absolute_with_catchup',
      },
      recognitionProfile: {
        method: existing.recognitionProfile.method,
        pointInTimeYear: existing.recognitionProfile.pointInTimeYear ?? 'handover',
        percentages: existing.recognitionProfile.percentages
          ? paddedArray(existing.recognitionProfile.percentages, totalPeriods)
          : undefined,
        profileMode: existing.recognitionProfile.profileMode ?? 'absolute_with_catchup',
      },
      escrow: { ...existing.escrow },
      indexation: { ...existing.indexation },
      handoverYearOverride: existing.handoverYearOverride,
      cohorts,
    };
  }
  return {
    assetId: asset.id,
    subUnits: subUnits.map((su) => ({
      subUnitId: su.id,
      preSalesVelocity: new Array<number>(totalPeriods).fill(0),
      postSalesVelocity: new Array<number>(totalPeriods).fill(0),
    })),
    cashPaymentProfile: {
      percentages: new Array<number>(totalPeriods).fill(0),
      profileMode: 'absolute_with_catchup',
    },
    recognitionProfile: {
      method: 'point_in_time',
      pointInTimeYear: 'handover',
    },
    escrow: { enabled: false, heldPct: 0.04, releaseYear: handoverYear },
    indexation: { method: 'none' },
    cohorts: [{
      id: newCohortId(),
      name: 'Cohort 1',
      subUnits: emptyCohortSubUnits(subUnits, totalPeriods),
    }],
  };
}

export default function Module2SellModal({ asset, onClose }: Props): React.JSX.Element {
  const { project, phases, subUnits, updateAsset } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      subUnits: s.subUnits,
      updateAsset: s.updateAsset,
    })),
  );

  const phase = phases.find((p) => p.id === asset.phaseId);
  const assetSubUnits = useMemo(
    () => subUnits.filter((u) => u.assetId === asset.id),
    [subUnits, asset.id],
  );

  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const totalPeriods = Math.max(1, timeline.totalPeriods);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  const yearLabels = useMemo(
    () => Array.from({ length: totalPeriods }, (_, i) => projectStartYear + i),
    [totalPeriods, projectStartYear],
  );
  const phaseStartYear = phase?.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const handoverYear = useMemo(
    () => resolveHandoverYear(
      totalPeriods,
      phaseStartYear,
      phase?.constructionPeriods ?? 0,
      projectStartYear,
    ),
    [totalPeriods, phaseStartYear, phase?.constructionPeriods, projectStartYear],
  );

  const [config, setConfig] = useState<AssetSellConfig>(() =>
    seedConfig(asset, assetSubUnits, totalPeriods, handoverYear),
  );

  // Pass 4: cohort tab selection. Defaults to first cohort. Clamped
  // when cohorts are added / removed.
  const [selectedCohortId, setSelectedCohortId] = useState<string>(() => config.cohorts?.[0]?.id ?? '');
  const cohorts = config.cohorts ?? [];
  const selectedCohort = cohorts.find((c) => c.id === selectedCohortId) ?? cohorts[0];
  const selectedCohortIdx = cohorts.findIndex((c) => c.id === selectedCohort?.id);

  const addCohort = (): void => {
    const id = newCohortId();
    setConfig((prev) => ({
      ...prev,
      cohorts: [
        ...(prev.cohorts ?? []),
        {
          id,
          name: `Cohort ${(prev.cohorts?.length ?? 0) + 1}`,
          subUnits: emptyCohortSubUnits(assetSubUnits, totalPeriods),
        },
      ],
    }));
    setSelectedCohortId(id);
  };

  const removeCohort = (id: string): void => {
    if ((config.cohorts?.length ?? 0) <= 1) return;
    setConfig((prev) => {
      const next = (prev.cohorts ?? []).filter((c) => c.id !== id);
      return { ...prev, cohorts: next };
    });
    setSelectedCohortId((cur) => {
      if (cur !== id) return cur;
      const remaining = (config.cohorts ?? []).filter((c) => c.id !== id);
      return remaining[0]?.id ?? '';
    });
  };

  const renameCohort = (id: string, name: string): void => {
    setConfig((prev) => ({
      ...prev,
      cohorts: (prev.cohorts ?? []).map((c) => c.id === id ? { ...c, name } : c),
    }));
  };

  const updateCohortPrice = (cohortId: string, subUnitId: string, value: number | undefined): void => {
    setConfig((prev) => ({
      ...prev,
      cohorts: (prev.cohorts ?? []).map((c) => {
        if (c.id !== cohortId) return c;
        const next: Record<string, number> = { ...(c.pricePerSubUnit ?? {}) };
        if (value == null || !Number.isFinite(value) || value <= 0) {
          delete next[subUnitId];
        } else {
          next[subUnitId] = value;
        }
        const hasAny = Object.keys(next).length > 0;
        return { ...c, pricePerSubUnit: hasAny ? next : undefined };
      }),
    }));
  };

  const subUnitMaterials = useMemo(
    () => assetSubUnits.map(makeSubUnitMaterial),
    [assetSubUnits],
  );

  const result = useMemo(
    () => computeSellAsset({
      config,
      subUnits: subUnitMaterials,
      axisLength: totalPeriods,
      handoverYear: config.handoverYearOverride ?? handoverYear,
    }),
    [config, subUnitMaterials, totalPeriods, handoverYear],
  );
  const reconcile = useMemo(() => reconcileSellAsset(result, config), [result, config]);

  const updateSubUnitVelocity = (subUnitId: string, periodIdx: number, value: number, kind: 'pre' | 'post'): void => {
    if (!selectedCohort) return;
    const targetCohortId = selectedCohort.id;
    setConfig((prev) => ({
      ...prev,
      cohorts: (prev.cohorts ?? []).map((c) => {
        if (c.id !== targetCohortId) return c;
        return {
          ...c,
          subUnits: c.subUnits.map((s) => {
            if (s.subUnitId !== subUnitId) return s;
            const next = kind === 'pre' ? [...s.preSalesVelocity] : [...s.postSalesVelocity];
            next[periodIdx] = Math.max(0, Math.min(1, value / 100));
            return kind === 'pre' ? { ...s, preSalesVelocity: next } : { ...s, postSalesVelocity: next };
          }),
        };
      }),
    }));
  };

  const updateCashPct = (periodIdx: number, value: number): void => {
    setConfig((prev) => {
      const next = [...prev.cashPaymentProfile.percentages];
      next[periodIdx] = Math.max(0, Math.min(1, value / 100));
      return { ...prev, cashPaymentProfile: { ...prev.cashPaymentProfile, percentages: next } };
    });
  };

  const updateRecognitionPct = (periodIdx: number, value: number): void => {
    setConfig((prev) => {
      const cur = prev.recognitionProfile.percentages ?? new Array<number>(totalPeriods).fill(0);
      const next = [...cur];
      next[periodIdx] = Math.max(0, Math.min(1, value / 100));
      return { ...prev, recognitionProfile: { ...prev.recognitionProfile, percentages: next } };
    });
  };

  const setRecognitionMethod = (method: RecognitionProfile['method']): void => {
    setConfig((prev) => ({
      ...prev,
      recognitionProfile: {
        ...prev.recognitionProfile,
        method,
        percentages: method === 'over_time'
          ? prev.recognitionProfile.percentages ?? new Array<number>(totalPeriods).fill(0)
          : undefined,
      },
    }));
  };

  const handleSave = (): void => {
    updateAsset(asset.id, { revenue: { ...(asset.revenue ?? {}), sell: config } });
    onClose();
  };

  const cashSum = config.cashPaymentProfile.percentages.reduce((s, v) => s + v, 0);
  const recSum = (config.recognitionProfile.percentages ?? []).reduce((s, v) => s + v, 0);
  const scale = project.displayScale ?? 'full';
  const decimals = project.displayDecimals ?? 0;
  const fmt = (n: number): string => formatAccounting(n, scale, decimals);

  return (
    <div className="pm-modal-overlay" onClick={onClose} data-testid="m2-sell-modal">
      <div
        className="pm-modal"
        style={{ width: 1180, maxWidth: '98vw', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-modal-header">
          <div>
            <div style={{ fontSize: 'var(--font-h3)', fontWeight: 700 }}>
              Revenue · {asset.name}
            </div>
            <div style={{ fontSize: 'var(--font-micro)', opacity: 0.8, marginTop: 2 }}>
              {asset.strategy} · {phase?.name ?? 'Unassigned phase'} · Handover Y{handoverYear + 1} ({yearLabels[handoverYear] ?? '?'})
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div className="pm-modal-body" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'var(--sp-3)' }}>
          {/* ── LEFT: Form ────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>

            {/* Cohort tabs (Pass 4) */}
            <Section
              title="Cohorts"
              tag={`${cohorts.length} cohort${cohorts.length === 1 ? '' : 's'}`}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6, alignItems: 'center' }}>
                {cohorts.map((c) => {
                  const active = c.id === selectedCohort?.id;
                  return (
                    <div
                      key={c.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 4px 4px 8px',
                        background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                        color: active ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 11,
                      }}
                      data-testid={`m2-cohort-tab-${c.id}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedCohortId(c.id)}
                        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: active ? 700 : 500, fontSize: 11, padding: 0 }}
                      >
                        {c.name}
                      </button>
                      {cohorts.length > 1 && (
                        <button
                          type="button"
                          title={`Remove ${c.name}`}
                          onClick={() => removeCohort(c.id)}
                          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.7, padding: '0 4px', fontSize: 13 }}
                          data-testid={`m2-cohort-remove-${c.id}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addCohort}
                  data-testid="m2-cohort-add"
                  style={{ padding: '4px 8px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 11, cursor: 'pointer', color: 'var(--color-meta)' }}
                >
                  + Add cohort
                </button>
              </div>
              {selectedCohort && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <FieldLabel>Selected cohort name</FieldLabel>
                  <input
                    type="text"
                    value={selectedCohort.name}
                    onChange={(e) => renameCohort(selectedCohort.id, e.target.value)}
                    style={{ ...FAST_INPUT, width: 200 }}
                    data-testid={`m2-cohort-rename-${selectedCohort.id}`}
                  />
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                    Cohort {selectedCohortIdx + 1} of {cohorts.length}. Velocity sums across cohorts per sub-unit must not exceed 100%.
                  </span>
                </div>
              )}
            </Section>

            {/* Velocity grid for selected cohort */}
            <Section title={`${selectedCohort?.name ?? 'Cohort'} · Sales Velocity per Sub-unit (% per year)`}>
              {assetSubUnits.length === 0 ? (
                <EmptyHint>No sub-units on this asset. Add them on Module 1 Tab 2 first.</EmptyHint>
              ) : selectedCohort ? (
                <VelocityTable
                  yearLabels={yearLabels}
                  handoverYear={handoverYear}
                  subUnits={assetSubUnits}
                  cohort={selectedCohort}
                  onChangePre={(suId, i, v) => updateSubUnitVelocity(suId, i, v, 'pre')}
                  onChangePost={(suId, i, v) => updateSubUnitVelocity(suId, i, v, 'post')}
                />
              ) : (
                <EmptyHint>Select a cohort above to edit its velocity.</EmptyHint>
              )}
            </Section>

            {/* Per-cohort price overrides (optional) */}
            {selectedCohort && assetSubUnits.length > 0 && (
              <Section title={`${selectedCohort.name} · Price Override (optional)`}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
                  {assetSubUnits.map((su) => {
                    const mat = makeSubUnitMaterial(su);
                    const override = selectedCohort.pricePerSubUnit?.[su.id];
                    const effective = override ?? mat.ratePerArea;
                    return (
                      <div key={su.id} style={{ padding: 6, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                        <FieldLabel>{su.name || 'sub-unit'} · price / sqm</FieldLabel>
                        <AccountingNumberInput
                          value={effective}
                          onChange={(v) => updateCohortPrice(selectedCohort.id, su.id, v === mat.ratePerArea ? undefined : v)}
                          scale="full"
                          decimals={0}
                          min={0}
                          style={FAST_INPUT}
                          data-testid={`m2-cohort-price-${selectedCohort.id}-${su.id}`}
                        />
                        <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          Asset default: {formatAccounting(mat.ratePerArea, 'full', 0)}{override != null ? ' · OVERRIDDEN' : ''}
                          {override != null && (
                            <button
                              type="button"
                              onClick={() => updateCohortPrice(selectedCohort.id, su.id, undefined)}
                              style={{ marginLeft: 6, background: 'transparent', border: 'none', color: 'var(--color-warning, #92400e)', cursor: 'pointer', fontSize: 9, textDecoration: 'underline', padding: 0 }}
                            >
                              reset
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Cash payment profile */}
            <Section
              title="Cash Payment Profile"
              tag={`Sum: ${(cashSum * 100).toFixed(1)}% ${Math.abs(cashSum - 1) < 0.005 ? '✓' : ''}`}
              tagColor={Math.abs(cashSum - 1) < 0.005 ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}
            >
              <ProfileStrip
                yearLabels={yearLabels}
                handoverYear={handoverYear}
                values={config.cashPaymentProfile.percentages}
                onChange={updateCashPct}
              />
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: 4 }}>
                Profile is positioned in absolute project years. A cohort sold in year N catches up the cumulative profile through N as a lump at N (MAAD pattern).
              </div>
            </Section>

            {/* Recognition */}
            <Section
              title="Revenue Recognition"
              tag={config.recognitionProfile.method === 'over_time' ? `Sum: ${(recSum * 100).toFixed(1)}% ${Math.abs(recSum - 1) < 0.005 ? '✓' : ''}` : 'Point-in-Time'}
              tagColor={config.recognitionProfile.method === 'point_in_time' ? 'var(--color-meta)' : (Math.abs(recSum - 1) < 0.005 ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)')}
            >
              <div style={{ display: 'flex', gap: 'var(--sp-1)', marginBottom: 6 }}>
                <RadioPill
                  active={config.recognitionProfile.method === 'point_in_time'}
                  label="Point-in-Time"
                  onClick={() => setRecognitionMethod('point_in_time')}
                />
                <RadioPill
                  active={config.recognitionProfile.method === 'over_time'}
                  label="Over-Time (POC)"
                  onClick={() => setRecognitionMethod('over_time')}
                />
                {config.recognitionProfile.method === 'point_in_time' && (
                  <select
                    value={config.recognitionProfile.pointInTimeYear ?? 'handover'}
                    onChange={(e) => setConfig((p) => ({ ...p, recognitionProfile: { ...p.recognitionProfile, pointInTimeYear: e.target.value as 'handover' | 'sale_year' } }))}
                    style={{ ...FAST_INPUT, width: 'auto' }}
                  >
                    <option value="handover">at Handover</option>
                    <option value="sale_year">at Sale Year</option>
                  </select>
                )}
              </div>
              {config.recognitionProfile.method === 'over_time' && (
                <ProfileStrip
                  yearLabels={yearLabels}
                  handoverYear={handoverYear}
                  values={config.recognitionProfile.percentages ?? new Array<number>(totalPeriods).fill(0)}
                  onChange={updateRecognitionPct}
                />
              )}
            </Section>

            {/* Escrow */}
            <Section title="Wafi Escrow">
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={config.escrow.enabled}
                    onChange={(e) => setConfig((p) => ({ ...p, escrow: { ...p.escrow, enabled: e.target.checked } }))}
                  />
                  Enabled
                </label>
                <div>
                  <FieldLabel>Held %</FieldLabel>
                  <PercentageInput
                    value={config.escrow.heldPct * 100}
                    onChange={(v) => setConfig((p) => ({ ...p, escrow: { ...p.escrow, heldPct: Math.max(0, Math.min(100, v)) / 100 } }))}
                    style={FAST_INPUT}
                    disabled={!config.escrow.enabled}
                  />
                </div>
                <div>
                  <FieldLabel>Release Year</FieldLabel>
                  <select
                    value={config.escrow.releaseYear}
                    onChange={(e) => setConfig((p) => ({ ...p, escrow: { ...p.escrow, releaseYear: Number(e.target.value) } }))}
                    style={FAST_INPUT}
                    disabled={!config.escrow.enabled}
                  >
                    {yearLabels.map((y, i) => (
                      <option key={i} value={i}>{y} (Y{i + 1})</option>
                    ))}
                  </select>
                </div>
              </div>
            </Section>

            {/* Indexation */}
            <Section title="Indexation">
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <div>
                  <FieldLabel>Method</FieldLabel>
                  <select
                    value={config.indexation.method}
                    onChange={(e) => setConfig((p) => ({ ...p, indexation: { ...p.indexation, method: e.target.value as typeof p.indexation.method } }))}
                    style={FAST_INPUT}
                  >
                    <option value="none">None</option>
                    <option value="yoy_compound">YoY Compound</option>
                    <option value="single_rate">Single Rate (from year)</option>
                    <option value="step">Step (advanced)</option>
                  </select>
                </div>
                {config.indexation.method !== 'none' && config.indexation.method !== 'step' && (
                  <>
                    <div>
                      <FieldLabel>Rate %</FieldLabel>
                      <PercentageInput
                        value={(config.indexation.rate ?? 0) * 100}
                        onChange={(v) => setConfig((p) => ({ ...p, indexation: { ...p.indexation, rate: v / 100 } }))}
                        style={FAST_INPUT}
                      />
                    </div>
                    <div>
                      <FieldLabel>Start Year</FieldLabel>
                      <select
                        value={config.indexation.startYear ?? 0}
                        onChange={(e) => setConfig((p) => ({ ...p, indexation: { ...p.indexation, startYear: Number(e.target.value) } }))}
                        style={FAST_INPUT}
                      >
                        {yearLabels.map((y, i) => (
                          <option key={i} value={i}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </Section>
          </div>

          {/* ── RIGHT: Live Preview ───────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <Section title="Live Preview (per period)">
              <div style={{ maxHeight: 480, overflow: 'auto' }}>
                <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }} data-testid="m2-sell-preview-table">
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px', fontSize: 10 }}>Year</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Pre-Sales Rev</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Cash</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Recognition</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Escrow Held</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px' }}>Net Cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearLabels.map((y, i) => (
                      <tr key={i} style={{ background: i === handoverYear ? 'color-mix(in srgb, var(--color-info, #1d4ed8) 6%, transparent)' : 'transparent' }}>
                        <td style={{ padding: '3px 6px', color: i === handoverYear ? 'var(--color-info, #1d4ed8)' : 'var(--color-body)', fontWeight: i === handoverYear ? 700 : 400 }}>
                          {y}{i === handoverYear ? ' (handover)' : ''}
                        </td>
                        <td style={{ ...READONLY_OUT, padding: '3px 6px' }}>{fmt(result.presalesRevenuePerPeriod[i] ?? 0)}</td>
                        <td style={{ ...READONLY_OUT, padding: '3px 6px' }}>{fmt(result.cashCollectedPerPeriod[i] ?? 0)}</td>
                        <td style={{ ...READONLY_OUT, padding: '3px 6px' }}>{fmt(result.recognitionPerPeriod[i] ?? 0)}</td>
                        <td style={{ ...READONLY_OUT, padding: '3px 6px' }}>{fmt(result.escrowHeldPerPeriod[i] ?? 0)}</td>
                        <td style={{ ...READONLY_OUT, padding: '3px 6px' }}>{fmt(result.netCashAvailablePerPeriod[i] ?? 0)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 700 }}>
                      <td style={{ padding: '4px 6px' }}>Total</td>
                      <td style={{ ...READONLY_OUT, padding: '4px 6px', fontWeight: 700 }}>{fmt(sum(result.presalesRevenuePerPeriod))}</td>
                      <td style={{ ...READONLY_OUT, padding: '4px 6px', fontWeight: 700 }}>{fmt(sum(result.cashCollectedPerPeriod))}</td>
                      <td style={{ ...READONLY_OUT, padding: '4px 6px', fontWeight: 700 }}>{fmt(sum(result.recognitionPerPeriod))}</td>
                      <td style={{ ...READONLY_OUT, padding: '4px 6px', fontWeight: 700 }}>{fmt(sum(result.escrowHeldPerPeriod))}</td>
                      <td style={{ ...READONLY_OUT, padding: '4px 6px', fontWeight: 700 }}>{fmt(sum(result.netCashAvailablePerPeriod))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Reconciliation">
              <div data-testid="m2-sell-reconcile" style={{
                padding: '6px 10px',
                background: reconcile.ok ? 'color-mix(in srgb, var(--color-success, #166534) 12%, transparent)' : 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)',
                color: reconcile.ok ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 'var(--radius-sm)',
                marginBottom: 6,
              }}>
                {reconcile.ok ? '✓ All identities pass' : `⚠ ${reconcile.identities.filter((x) => !x.ok).length} identity failure(s)`}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 10, color: 'var(--color-text-muted)' }}>
                {reconcile.identities.map((x) => (
                  <li key={x.id} style={{ padding: '2px 0', color: x.ok ? 'var(--color-meta)' : 'var(--color-warning, #92400e)' }}>
                    {x.ok ? '✓' : '✗'} {x.id}{x.ok ? '' : ` — ${x.message ?? ''}`}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>

        <div className="pm-modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} data-testid="m2-sell-cancel">Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} data-testid="m2-sell-save">Save Revenue Config</button>
        </div>
      </div>
    </div>
  );
}

function sum(arr: number[]): number {
  return arr.reduce((s, v) => s + (v ?? 0), 0);
}

// ── Small subcomponents ───────────────────────────────────────────────

function Section({ title, tag, tagColor, children }: { title: string; tag?: string; tagColor?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-heading)' }}>
          {title}
        </div>
        {tag && (
          <span style={{ fontSize: 10, fontWeight: 700, color: tagColor ?? 'var(--color-meta)' }}>
            {tag}
          </span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{children}</div>;
}

function EmptyHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{
      padding: 'var(--sp-1) var(--sp-2)',
      background: 'var(--color-surface)',
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--color-text-muted)',
      fontSize: 'var(--font-small)',
      fontStyle: 'italic',
    }}>
      {children}
    </div>
  );
}

function RadioPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? 'var(--color-navy)' : 'var(--color-surface)',
        color: active ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── Velocity table ────────────────────────────────────────────────────

interface VelocityTableProps {
  yearLabels: number[];
  handoverYear: number;
  subUnits: SubUnit[];
  cohort: { subUnits: Array<{ subUnitId: string; preSalesVelocity: number[]; postSalesVelocity: number[] }> };
  onChangePre: (suId: string, i: number, v: number) => void;
  onChangePost: (suId: string, i: number, v: number) => void;
}

function VelocityTable({ yearLabels, handoverYear, subUnits, cohort, onChangePre, onChangePost }: VelocityTableProps): React.JSX.Element {
  const cellInput: React.CSSProperties = { ...FAST_INPUT, padding: '2px 4px', textAlign: 'right' as const, fontSize: 10 };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface-alt, #f3f4f6)' }}>
            <th style={{ padding: '4px 6px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--color-surface-alt, #f3f4f6)' }}>Sub-unit / Phase</th>
            {yearLabels.map((y, i) => (
              <th key={i} style={{
                padding: '4px 6px',
                textAlign: 'center',
                minWidth: 55,
                color: i === handoverYear ? 'var(--color-info, #1d4ed8)' : 'var(--color-body)',
                fontWeight: i === handoverYear ? 700 : 600,
              }}>
                {y}{i === handoverYear ? '*' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subUnits.map((su) => {
            const cfgSU = cohort.subUnits.find((s) => s.subUnitId === su.id);
            const preVel = cfgSU?.preSalesVelocity ?? [];
            const postVel = cfgSU?.postSalesVelocity ?? [];
            const sumPre = preVel.reduce((s, v) => s + v, 0);
            const sumPost = postVel.reduce((s, v) => s + v, 0);
            const sumAll = sumPre + sumPost;
            const over = sumAll > 1 + 1e-6;
            return (
              <React.Fragment key={su.id}>
                <tr>
                  <td rowSpan={2} style={{ padding: '4px 6px', verticalAlign: 'middle', position: 'sticky', left: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>
                    <div style={{ fontWeight: 700 }}>{su.name || '(unnamed)'}</div>
                    <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{su.category} · {su.metric}</div>
                    <div style={{ fontSize: 9, color: over ? 'var(--color-warning, #92400e)' : 'var(--color-meta)', marginTop: 2 }}>
                      Σ pre {(sumPre * 100).toFixed(0)}% / post {(sumPost * 100).toFixed(0)}%{over ? ' ⚠' : ''}
                    </div>
                  </td>
                  {yearLabels.map((_, i) => (
                    <td key={`pre-${i}`} style={{ padding: '2px 3px', textAlign: 'center' }}>
                      <input
                        type="number"
                        value={Math.round((preVel[i] ?? 0) * 10000) / 100}
                        onChange={(e) => onChangePre(su.id, i, Number(e.target.value) || 0)}
                        style={cellInput}
                        step={1}
                        min={0}
                        max={100}
                        data-testid={`m2-pre-${su.id}-${i}`}
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  {yearLabels.map((_, i) => (
                    <td key={`post-${i}`} style={{ padding: '2px 3px', textAlign: 'center', background: 'var(--color-surface-alt, #f3f4f6)' }}>
                      <input
                        type="number"
                        value={Math.round((postVel[i] ?? 0) * 10000) / 100}
                        onChange={(e) => onChangePost(su.id, i, Number(e.target.value) || 0)}
                        style={cellInput}
                        step={1}
                        min={0}
                        max={100}
                        data-testid={`m2-post-${su.id}-${i}`}
                      />
                    </td>
                  ))}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', padding: '4px 6px', borderTop: '1px solid var(--color-border)' }}>
        Row 1 of each pair = Pre-Sales velocity. Row 2 (shaded) = Sales During Operation velocity. Sum (pre + post) ≤ 100% per sub-unit. * = handover year.
      </div>
    </div>
  );
}

// ── Profile strip (cash / recognition) ────────────────────────────────

interface ProfileStripProps {
  yearLabels: number[];
  handoverYear: number;
  values: number[];
  onChange: (i: number, value: number) => void;
}

function ProfileStrip({ yearLabels, handoverYear, values, onChange }: ProfileStripProps): React.JSX.Element {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface-alt, #f3f4f6)' }}>
            {yearLabels.map((y, i) => (
              <th key={i} style={{
                padding: '4px 6px',
                textAlign: 'center',
                minWidth: 55,
                color: i === handoverYear ? 'var(--color-info, #1d4ed8)' : 'var(--color-body)',
                fontWeight: i === handoverYear ? 700 : 600,
              }}>
                {y}{i === handoverYear ? '*' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {yearLabels.map((_, i) => (
              <td key={i} style={{ padding: '2px 3px', textAlign: 'center' }}>
                <input
                  type="number"
                  value={Math.round((values[i] ?? 0) * 10000) / 100}
                  onChange={(e) => onChange(i, Number(e.target.value) || 0)}
                  style={{ ...FAST_INPUT, padding: '2px 4px', textAlign: 'right', fontSize: 10 }}
                  step={1}
                  min={0}
                  max={100}
                  data-testid={`m2-profile-${i}`}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
