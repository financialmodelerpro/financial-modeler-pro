'use client';

/**
 * Module1Costs.tsx (M2.0 Tab 3)
 *
 * 9 standard cost lines per phase. Each line has method + value +
 * phasing. Per-asset overrides supported but rendered in a collapsible
 * section to keep the default view simple.
 *
 * MAAD-Spec: cost identity is fixed at 9 lines (land, constructionBua,
 * constructionParking, infrastructure, landscaping, preOperating,
 * professionalFee, commissionFee, contingency). Users do NOT add new
 * lines, only adjust method + value + phasing.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type CostLine,
  type CostLineKey,
  type CostMethod,
  type CostPhasing,
  type CostOverride,
  COST_LINE_KEYS,
  COST_LINE_LABELS,
  COST_METHODS,
  COST_PHASINGS,
} from '../../lib/state/module1-types';
import {
  computePhaseCost,
  computeAssetCost,
  computeAssetLandCost,
  buildCostContext,
} from '@/src/core/calculations';
import InputLabel from '../ui/InputLabel';

const inputStyle: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-body)',
  width: '100%',
};

const calcOutputStyle: React.CSSProperties = {
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-body)',
};

const sectionCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-3)',
  marginBottom: 'var(--sp-3)',
};

const tableHeaderStyle: React.CSSProperties = {
  background: 'var(--color-navy)',
  color: 'var(--color-on-primary-navy)',
  textAlign: 'left',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-bold)',
  textTransform: 'uppercase',
};

const tableHeaderLabelStyle: React.CSSProperties = {
  color: 'var(--color-on-primary-navy)',
  fontWeight: 'var(--fw-bold)',
};

const fmt = (n: number, digits = 0): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : 'n/a';

const METHOD_LABELS: Record<CostMethod, string> = {
  lumpsum: 'Lump sum',
  rate_per_bua: 'Rate per BUA',
  rate_per_park: 'Rate per parking bay',
  rate_per_land: 'Rate per land sqm',
  percent_of_construction: '% of Construction',
  percent_of_total_cost: '% of Total Cost',
};

const PHASING_LABELS: Record<CostPhasing, string> = {
  even: 'Even',
  frontloaded: 'Frontloaded',
  backloaded: 'Backloaded',
  manual: 'Manual',
};

export default function Module1Costs(): React.JSX.Element {
  const {
    project,
    phases,
    activePhaseId,
    setActivePhaseId,
    parcels,
    assets,
    subUnits,
    landAllocationMode,
    costLines,
    costOverrides,
    updateCostLine,
    setCostOverride,
    removeCostOverride,
  } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      activePhaseId: s.activePhaseId,
      setActivePhaseId: s.setActivePhaseId,
      parcels: s.parcels,
      assets: s.assets,
      subUnits: s.subUnits,
      landAllocationMode: s.landAllocationMode,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      updateCostLine: s.updateCostLine,
      setCostOverride: s.setCostOverride,
      removeCostOverride: s.removeCostOverride,
    })),
  );
  const [showOverrides, setShowOverrides] = useState(false);

  const activePhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  const phaseId = activePhase?.id ?? phases[0]?.id ?? '';
  const phaseAssets = useMemo(
    () => assets.filter((a) => a.phaseId === phaseId),
    [assets, phaseId],
  );
  const ctx = useMemo(() => {
    if (!activePhase) return null;
    return buildCostContext(activePhase, parcels, assets, subUnits);
  }, [activePhase, parcels, assets, subUnits]);
  const breakdown = useMemo(() => {
    if (!activePhase) return null;
    return computePhaseCost(activePhase, costLines, parcels, assets, subUnits);
  }, [activePhase, costLines, parcels, assets, subUnits]);

  if (!activePhase || !ctx || !breakdown) {
    return <div data-testid="tab-costs-empty">No phases configured.</div>;
  }

  return (
    <div data-testid="tab-costs">
      <h2 style={{ fontSize: 'var(--font-h2)', marginBottom: 'var(--sp-3)' }}>3. Costs</h2>

      <div
        style={{
          background: 'var(--color-primary-pale)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
          fontSize: 'var(--font-small)',
        }}
        data-testid="tab3-callout"
      >
        <strong>What goes here:</strong> The 9 standard cost lines per phase
        (Land, Construction BUA, Construction Parking, Infrastructure, Landscaping,
        Pre-operating, Professional fee, Commission fee, Contingency). Each line
        picks a method and a value; the phasing curve spreads the spend over the
        construction window. Per-asset overrides live in the section below.
      </div>

      {phases.length > 1 && (
        <div style={{ marginBottom: 'var(--sp-2)' }}>
          <InputLabel label="Active Phase" help="Switch which phase you're editing." inputId="costs-active-phase" />
          <select
            id="costs-active-phase"
            data-testid="costs-active-phase"
            value={phaseId}
            onChange={(e) => setActivePhaseId(e.target.value)}
            style={{ ...inputStyle, maxWidth: 320 }}
          >
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={sectionCardStyle} data-testid="costs-context">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)' }}>
          Phase context
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'var(--sp-2)',
            fontSize: 'var(--font-small)',
          }}
        >
          <div data-testid="ctx-totalLandSqm">
            <strong>Total Land:</strong>{' '}
            <span style={calcOutputStyle}>{fmt(ctx.totalLandSqm)} sqm</span>
          </div>
          <div data-testid="ctx-totalBuaSqm">
            <strong>Total BUA:</strong>{' '}
            <span style={calcOutputStyle}>{fmt(ctx.totalBuaSqm)} sqm</span>
          </div>
          <div data-testid="ctx-totalParkingBays">
            <strong>Parking Bays:</strong>{' '}
            <span style={calcOutputStyle}>{fmt(ctx.totalParkingBays)}</span>
          </div>
          <div data-testid="ctx-totalLandValue">
            <strong>Land Value:</strong>{' '}
            <span style={calcOutputStyle}>{fmt(ctx.totalLandValue)} {project.currency}</span>
          </div>
        </div>
      </div>

      <div style={sectionCardStyle} data-testid="cost-lines-section">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)' }}>
          Cost lines
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={tableHeaderStyle}>
                <InputLabel label="Cost Line" help="The 9 standard cost categories." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Method" help="How the value is interpreted (lumpsum, rate per BUA / land / parking, % of construction or total)." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Value" help="The number, interpretation depends on method." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Phasing" help="How spend is spread across the construction window. Manual lets you supply per-period weights." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label={`Total (${project.currency})`} help="Resolved currency total for this line." textStyle={tableHeaderLabelStyle} />
              </th>
            </tr>
          </thead>
          <tbody>
            {COST_LINE_KEYS.map((key) => {
              const line = costLines.find((c) => c.key === key && c.phaseId === phaseId);
              if (!line) return null;
              return (
                <CostLineRow
                  key={key}
                  line={line}
                  total={breakdown.byLine[key]}
                  currency={project.currency}
                  onUpdate={(patch) => updateCostLine(key, phaseId, patch)}
                />
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 'var(--fw-bold)' }}>
              <td style={{ padding: 'var(--sp-1)' }} colSpan={4}>
                Phase total
              </td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="phase-total-cost">
                {fmt(breakdown.total)} {project.currency}
              </td>
            </tr>
            <tr style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}>
              <td style={{ padding: 'var(--sp-1)' }} colSpan={4}>
                Construction subtotal (BUA + Parking)
              </td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="construction-subtotal">
                {fmt(breakdown.constructionTotal)} {project.currency}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={sectionCardStyle} data-testid="overrides-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
          }}
          onClick={() => setShowOverrides(!showOverrides)}
          data-testid="overrides-toggle"
        >
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>
            Per-asset overrides ({costOverrides.filter((o) => phaseAssets.find((a) => a.id === o.assetId)).length})
          </h3>
          <span style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}>
            {showOverrides ? 'Hide' : 'Show'}
          </span>
        </div>
        {showOverrides && (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <div
              style={{
                fontSize: 'var(--font-small)',
                color: 'var(--color-meta)',
                marginBottom: 'var(--sp-2)',
              }}
            >
              Without overrides, each asset gets a BUA-weighted slice of the phase
              cost lines (except Land, which uses the Land Allocation Mode from
              Tab 2). Overrides replace that calculation for the selected asset
              and cost line only.
            </div>
            {phaseAssets.map((asset) => {
              const assetCost = computeAssetCost(
                asset,
                costLines,
                costOverrides,
                parcels,
                assets,
                subUnits,
              );
              const landCost = computeAssetLandCost(asset, parcels, assets, subUnits, landAllocationMode);
              return (
                <div
                  key={asset.id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--sp-2)',
                    marginBottom: 'var(--sp-2)',
                  }}
                  data-testid={`override-asset-${asset.id}`}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 'var(--sp-1)',
                      fontSize: 'var(--font-small)',
                    }}
                  >
                    <strong>{asset.name}</strong>
                    <span data-testid={`override-asset-${asset.id}-total`}>
                      Total: {fmt(assetCost.total + landCost)} {project.currency}
                    </span>
                  </div>
                  {COST_LINE_KEYS.map((key) => {
                    const override = costOverrides.find(
                      (o) => o.assetId === asset.id && o.key === key,
                    );
                    return (
                      <CostOverrideRow
                        key={key}
                        assetId={asset.id}
                        costKey={key}
                        override={override}
                        currency={project.currency}
                        derivedTotal={
                          key === 'land' ? landCost : assetCost.byLine[key]
                        }
                        onSet={(o) => setCostOverride(o)}
                        onClear={() => removeCostOverride(asset.id, key)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface CostLineRowProps {
  line: CostLine;
  total: number;
  currency: string;
  onUpdate: (patch: Partial<CostLine>) => void;
}

function CostLineRow({ line, total, currency, onUpdate }: CostLineRowProps): React.JSX.Element {
  return (
    <tr data-testid={`cost-line-${line.key}`}>
      <td style={{ padding: 'var(--sp-1)' }}>
        <strong>{COST_LINE_LABELS[line.key]}</strong>
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <select
          value={line.method}
          data-testid={`cost-line-${line.key}-method`}
          onChange={(e) => onUpdate({ method: e.target.value as CostMethod })}
          style={inputStyle}
        >
          {COST_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number"
          min={0}
          value={line.value}
          data-testid={`cost-line-${line.key}-value`}
          onChange={(e) => onUpdate({ value: Math.max(0, Number(e.target.value) || 0) })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <select
          value={line.phasing}
          data-testid={`cost-line-${line.key}-phasing`}
          onChange={(e) => onUpdate({ phasing: e.target.value as CostPhasing })}
          style={inputStyle}
        >
          {COST_PHASINGS.map((p) => (
            <option key={p} value={p}>
              {PHASING_LABELS[p]}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: 'var(--sp-1)' }} data-testid={`cost-line-${line.key}-total`}>
        {fmt(total)} {currency}
      </td>
    </tr>
  );
}

interface CostOverrideRowProps {
  assetId: string;
  costKey: CostLineKey;
  override: CostOverride | undefined;
  currency: string;
  derivedTotal: number;
  onSet: (o: CostOverride) => void;
  onClear: () => void;
}

function CostOverrideRow({
  assetId,
  costKey,
  override,
  currency,
  derivedTotal,
  onSet,
  onClear,
}: CostOverrideRowProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 1.2fr 60px',
        gap: 'var(--sp-1)',
        marginBottom: 'var(--sp-1)',
        fontSize: 'var(--font-small)',
        alignItems: 'center',
      }}
      data-testid={`override-${assetId}-${costKey}`}
    >
      <strong style={{ paddingLeft: 'var(--sp-2)' }}>{COST_LINE_LABELS[costKey]}</strong>
      {override ? (
        <>
          <select
            value={override.method}
            data-testid={`override-${assetId}-${costKey}-method`}
            onChange={(e) => onSet({ ...override, method: e.target.value as CostMethod })}
            style={inputStyle}
          >
            {COST_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={override.value}
            data-testid={`override-${assetId}-${costKey}-value`}
            onChange={(e) => onSet({ ...override, value: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle}
          />
          <select
            value={override.phasing}
            data-testid={`override-${assetId}-${costKey}-phasing`}
            onChange={(e) => onSet({ ...override, phasing: e.target.value as CostPhasing })}
            style={inputStyle}
          >
            {COST_PHASINGS.map((p) => (
              <option key={p} value={p}>
                {PHASING_LABELS[p]}
              </option>
            ))}
          </select>
          <span style={calcOutputStyle} data-testid={`override-${assetId}-${costKey}-total`}>
            {fmt(derivedTotal)} {currency}
          </span>
          <button
            type="button"
            onClick={onClear}
            data-testid={`override-${assetId}-${costKey}-clear`}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 6px',
              cursor: 'pointer',
              fontSize: 'var(--font-micro)',
            }}
          >
            Clear
          </button>
        </>
      ) : (
        <>
          <span style={{ color: 'var(--color-meta)' }}>(default)</span>
          <span style={{ color: 'var(--color-meta)' }}>(default)</span>
          <span style={{ color: 'var(--color-meta)' }}>(default)</span>
          <span style={calcOutputStyle} data-testid={`override-${assetId}-${costKey}-total`}>
            {fmt(derivedTotal)} {currency}
          </span>
          <button
            type="button"
            onClick={() =>
              onSet({
                assetId,
                key: costKey,
                method: 'lumpsum',
                value: derivedTotal,
                phasing: 'even',
              })
            }
            data-testid={`override-${assetId}-${costKey}-set`}
            style={{
              background: 'var(--color-navy)',
              color: 'var(--color-on-primary-navy)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 6px',
              cursor: 'pointer',
              fontSize: 'var(--font-micro)',
            }}
          >
            Set
          </button>
        </>
      )}
    </div>
  );
}
