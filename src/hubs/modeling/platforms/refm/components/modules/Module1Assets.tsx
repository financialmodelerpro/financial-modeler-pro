'use client';

/**
 * Module1Assets.tsx (M2.0 Tab 2)
 *
 * Land Parcels block at top + landAllocationMode toggle, then Asset
 * cards with strategy + areas + sub-unit nested editor.
 *
 * MAAD-Spec: assets carry GFA / BUA / sellable BUA + parking bays as
 * direct inputs. No FAR / coverage / cascade math. Sub-units describe
 * the inventory beneath each asset (units, keys, sqm) with their
 * pricing.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type Asset,
  type AssetStrategy,
  type Parcel,
  type SubUnit,
  type SubUnitCategory,
  type SubUnitMetric,
  type LandAllocationMode,
  ASSET_STRATEGIES,
  ASSET_TYPES_BY_STRATEGY,
  DEFAULT_OPERATIONS_BY_STRATEGY,
  SUB_UNIT_CATEGORIES,
  LAND_ALLOCATION_MODES,
} from '../../lib/state/module1-types';
import {
  computeAssetBua,
  computeAssetSellableBua,
  computeAssetLandCost,
  computeLandAggregate,
  computeSubUnitArea,
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

export default function Module1Assets(): React.JSX.Element {
  const {
    project,
    phases,
    activePhaseId,
    setActivePhaseId,
    parcels,
    addParcel,
    updateParcel,
    removeParcel,
    landAllocationMode,
    setLandAllocationMode,
    assets,
    addAsset,
    updateAsset,
    removeAsset,
    subUnits,
  } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      activePhaseId: s.activePhaseId,
      setActivePhaseId: s.setActivePhaseId,
      parcels: s.parcels,
      addParcel: s.addParcel,
      updateParcel: s.updateParcel,
      removeParcel: s.removeParcel,
      landAllocationMode: s.landAllocationMode,
      setLandAllocationMode: s.setLandAllocationMode,
      assets: s.assets,
      addAsset: s.addAsset,
      updateAsset: s.updateAsset,
      removeAsset: s.removeAsset,
      subUnits: s.subUnits,
    })),
  );

  const activePhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  const phaseId = activePhase?.id ?? phases[0]?.id ?? '';
  const phaseParcels = useMemo(
    () => parcels.filter((p) => p.phaseId === phaseId),
    [parcels, phaseId],
  );
  const phaseAssets = useMemo(
    () => assets.filter((a) => a.phaseId === phaseId),
    [assets, phaseId],
  );
  const aggregate = useMemo(() => computeLandAggregate(phaseParcels), [phaseParcels]);

  const handleAddParcel = (): void => {
    if (!phaseId) return;
    addParcel({
      id: `parcel_${Date.now()}`,
      phaseId,
      name: `Land ${phaseParcels.length + 1}`,
      area: 50000,
      rate: 500,
      cashPct: 60,
      inKindPct: 40,
    });
  };

  const handleAddAsset = (): void => {
    if (!phaseId) return;
    const id = `asset_${Date.now()}`;
    addAsset({
      id,
      phaseId,
      name: `Asset ${phaseAssets.length + 1}`,
      type: 'High-end Apartments',
      strategy: 'Sell',
      visible: true,
      gfaSqm: 0,
      buaSqm: 0,
      sellableBuaSqm: 0,
      parkingBaysRequired: 0,
    });
  };

  return (
    <div data-testid="tab-assets">
      <h2 style={{ fontSize: 'var(--font-h2)', marginBottom: 'var(--sp-3)' }}>
        2. Assets &amp; Sub-units
      </h2>

      <div
        style={{
          background: 'var(--color-primary-pale)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
          fontSize: 'var(--font-small)',
        }}
        data-testid="tab2-callout"
      >
        <strong>What goes here:</strong> Land parcels for this phase, then the
        revenue-producing assets (apartments, hotel, retail) and the inventory
        sub-units beneath each. Land allocation across assets is driven by the
        mode below: enter sqm directly, percent splits, or auto-derive from BUA.
      </div>

      {phases.length > 1 && (
        <div style={{ marginBottom: 'var(--sp-2)' }}>
          <InputLabel label="Active Phase" help="Switch which phase you're editing." inputId="active-phase" />
          <select
            id="active-phase"
            data-testid="active-phase"
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

      <div style={sectionCardStyle} data-testid="parcels-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>Land Parcels</h3>
          <button
            type="button"
            onClick={handleAddParcel}
            data-testid="add-parcel"
            className="btn-primary"
            style={{ padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--font-small)' }}
          >
            + Add Parcel
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={tableHeaderStyle}>
                <InputLabel label="Parcel Name" help="Free-text label." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label={`Area (sqm)`} help="Land area for this parcel." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label={`Rate (per sqm, ${project.currency})`} help="Acquisition cost per sqm." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="Cash %" help="Share paid in cash. Cash + In-kind = 100." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label="In-Kind %" help="Share paid in-kind (e.g. revenue share to landowner)." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}>
                <InputLabel label={`Total Value (${project.currency})`} help="Auto = Area x Rate." textStyle={tableHeaderLabelStyle} />
              </th>
              <th style={tableHeaderStyle}></th>
            </tr>
          </thead>
          <tbody>
            {phaseParcels.map((parcel) => (
              <ParcelRow
                key={parcel.id}
                parcel={parcel}
                onUpdate={(patch) => updateParcel(parcel.id, patch)}
                onRemove={() => removeParcel(parcel.id)}
                canRemove={phaseParcels.length > 1}
              />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 'var(--fw-bold)' }}>
              <td style={{ padding: 'var(--sp-1)' }}>Totals</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-area">
                {fmt(aggregate.totalAreaSqm)} sqm
              </td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-weighted-rate">
                {fmt(aggregate.weightedRate, 2)} {project.currency}/sqm
              </td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-cash-value">
                {fmt(aggregate.cashValue)}
              </td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-inkind-value">
                {fmt(aggregate.inKindValue)}
              </td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-value">
                {fmt(aggregate.totalValue)} {project.currency}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={sectionCardStyle} data-testid="land-allocation-section">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)' }}>
          Land Allocation Mode
        </h3>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {LAND_ALLOCATION_MODES.map((mode) => (
            <label
              key={mode}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontSize: 'var(--font-small)',
              }}
              data-testid={`land-mode-${mode}`}
            >
              <input
                type="radio"
                name="land-allocation-mode"
                value={mode}
                checked={landAllocationMode === mode}
                onChange={() => setLandAllocationMode(mode)}
              />
              {mode === 'sqm' && 'A. Direct sqm per asset'}
              {mode === 'percent' && 'B. Percent split per asset'}
              {mode === 'autoByBua' && 'C. Auto, weight by BUA'}
            </label>
          ))}
        </div>
      </div>

      <div style={sectionCardStyle} data-testid="assets-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>Assets</h3>
          <button
            type="button"
            onClick={handleAddAsset}
            data-testid="add-asset"
            className="btn-primary"
            style={{ padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--font-small)' }}
          >
            + Add Asset
          </button>
        </div>
        {phaseAssets.length === 0 && (
          <div
            style={{
              padding: 'var(--sp-3)',
              textAlign: 'center',
              color: 'var(--color-meta)',
              fontSize: 'var(--font-small)',
            }}
            data-testid="assets-empty-state"
          >
            No assets yet. Click <strong>+ Add Asset</strong> to begin.
          </div>
        )}
        {phaseAssets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            assets={assets}
            parcels={parcels}
            subUnits={subUnits}
            currency={project.currency}
            landAllocationMode={landAllocationMode}
            onUpdate={(patch) => updateAsset(asset.id, patch)}
            onRemove={() => removeAsset(asset.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface ParcelRowProps {
  parcel: Parcel;
  onUpdate: (patch: Partial<Parcel>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ParcelRow({ parcel, onUpdate, onRemove, canRemove }: ParcelRowProps): React.JSX.Element {
  const total = parcel.area * parcel.rate;
  return (
    <tr data-testid={`parcel-row-${parcel.id}`}>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="text"
          value={parcel.name}
          data-testid={`parcel-${parcel.id}-name`}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number"
          min={0}
          value={parcel.area}
          data-testid={`parcel-${parcel.id}-area`}
          onChange={(e) => onUpdate({ area: Math.max(0, Number(e.target.value) || 0) })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number"
          min={0}
          value={parcel.rate}
          data-testid={`parcel-${parcel.id}-rate`}
          onChange={(e) => onUpdate({ rate: Math.max(0, Number(e.target.value) || 0) })}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number"
          min={0}
          max={100}
          value={parcel.cashPct}
          data-testid={`parcel-${parcel.id}-cashPct`}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
            onUpdate({ cashPct: v, inKindPct: 100 - v });
          }}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number"
          min={0}
          max={100}
          value={parcel.inKindPct}
          data-testid={`parcel-${parcel.id}-inKindPct`}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
            onUpdate({ inKindPct: v, cashPct: 100 - v });
          }}
          style={inputStyle}
        />
      </td>
      <td
        style={{ padding: 'var(--sp-1)', color: 'var(--color-heading)' }}
        data-testid={`parcel-${parcel.id}-total`}
      >
        {fmt(total)}
      </td>
      <td style={{ padding: 'var(--sp-1)', textAlign: 'right' }}>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            data-testid={`parcel-${parcel.id}-remove`}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 'var(--font-micro)',
            }}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

interface AssetCardProps {
  asset: Asset;
  assets: Asset[];
  parcels: Parcel[];
  subUnits: SubUnit[];
  currency: string;
  landAllocationMode: LandAllocationMode;
  onUpdate: (patch: Partial<Asset>) => void;
  onRemove: () => void;
}

function AssetCard({
  asset,
  assets,
  parcels,
  subUnits,
  currency,
  landAllocationMode,
  onUpdate,
  onRemove,
}: AssetCardProps): React.JSX.Element {
  const { addSubUnit, updateSubUnit, removeSubUnit } = useModule1Store(
    useShallow((s) => ({
      addSubUnit: s.addSubUnit,
      updateSubUnit: s.updateSubUnit,
      removeSubUnit: s.removeSubUnit,
    })),
  );
  const assetSubUnits = subUnits.filter((u) => u.assetId === asset.id);
  const derivedBua = computeAssetBua(asset, subUnits);
  const derivedSellable = computeAssetSellableBua(asset, subUnits);
  const landCost = computeAssetLandCost(asset, parcels, assets, subUnits, landAllocationMode);
  const efficiency = derivedBua > 0 ? (derivedSellable / derivedBua) * 100 : 0;

  const handleAddSubUnit = (): void => {
    const ops = DEFAULT_OPERATIONS_BY_STRATEGY[asset.strategy];
    addSubUnit({
      id: `subunit_${Date.now()}`,
      assetId: asset.id,
      name: 'Sub-unit',
      category: asset.strategy === 'Lease' ? 'Leasable' : asset.strategy === 'Operate' ? 'Operable' : 'Sellable',
      metric: asset.strategy === 'Lease' ? 'area' : 'count',
      metricValue: asset.strategy === 'Lease' ? 1000 : 50,
      unitArea: asset.strategy === 'Lease' ? undefined : 100,
      unitPrice: asset.strategy === 'Sell' ? 1000000 : asset.strategy === 'Operate' ? 800 : 1200,
      occupancyPct: ops.occupancyPct,
      operatingMargin: ops.operatingMargin,
    });
  };

  const typeOptions = ASSET_TYPES_BY_STRATEGY[asset.strategy];

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-2)',
        background: 'var(--color-bg)',
      }}
      data-testid={`asset-card-${asset.id}`}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        <div>
          <InputLabel label="Asset Name" help="Free-text label." inputId={`asset-${asset.id}-name`} />
          <input
            id={`asset-${asset.id}-name`}
            data-testid={`asset-${asset.id}-name`}
            type="text"
            value={asset.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <InputLabel label="Strategy" help="Sell (units) / Operate (own and run) / Lease (own and rent) / Sell + Manage (sell to investors, manage via agreement)." inputId={`asset-${asset.id}-strategy`} />
          <select
            id={`asset-${asset.id}-strategy`}
            data-testid={`asset-${asset.id}-strategy`}
            value={asset.strategy}
            onChange={(e) => onUpdate({ strategy: e.target.value as AssetStrategy })}
            style={inputStyle}
          >
            {ASSET_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <InputLabel label="Type" help="Asset type. Picks from a strategy-specific list; free-text any other type." inputId={`asset-${asset.id}-type`} />
          <input
            id={`asset-${asset.id}-type`}
            data-testid={`asset-${asset.id}-type`}
            type="text"
            list={`asset-types-${asset.id}`}
            value={asset.type}
            onChange={(e) => onUpdate({ type: e.target.value })}
            style={inputStyle}
          />
          <datalist id={`asset-types-${asset.id}`}>
            {typeOptions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-1)' }}>
          <label style={{ fontSize: 'var(--font-small)', display: 'inline-flex', gap: 6 }}>
            <input
              type="checkbox"
              checked={asset.visible}
              data-testid={`asset-${asset.id}-visible`}
              onChange={(e) => onUpdate({ visible: e.target.checked })}
            />
            Visible
          </label>
          <button
            type="button"
            onClick={onRemove}
            data-testid={`asset-${asset.id}-remove`}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 'var(--font-micro)',
            }}
          >
            Remove
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {landAllocationMode === 'sqm' && (
          <div>
            <InputLabel
              label="Land Area (sqm)"
              help="Direct sqm assigned to this asset from the parcel pool."
              inputId={`asset-${asset.id}-landAreaSqm`}
            />
            <input
              id={`asset-${asset.id}-landAreaSqm`}
              data-testid={`asset-${asset.id}-landAreaSqm`}
              type="number"
              min={0}
              value={asset.landAreaSqm ?? 0}
              onChange={(e) => onUpdate({ landAreaSqm: Math.max(0, Number(e.target.value) || 0) })}
              style={inputStyle}
            />
          </div>
        )}
        {landAllocationMode === 'percent' && (
          <div>
            <InputLabel
              label="Land Allocation (%)"
              help="Share of total land value attributed to this asset (sum of all asset % must = 100)."
              inputId={`asset-${asset.id}-landAreaPct`}
            />
            <input
              id={`asset-${asset.id}-landAreaPct`}
              data-testid={`asset-${asset.id}-landAreaPct`}
              type="number"
              min={0}
              max={100}
              value={asset.landAreaPct ?? 0}
              onChange={(e) => onUpdate({ landAreaPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              style={inputStyle}
            />
          </div>
        )}
        <div>
          <InputLabel label="GFA (sqm)" help="Gross Floor Area. Total enclosed area, before MEP / BoH deductions." inputId={`asset-${asset.id}-gfaSqm`} />
          <input
            id={`asset-${asset.id}-gfaSqm`}
            data-testid={`asset-${asset.id}-gfaSqm`}
            type="number"
            min={0}
            value={asset.gfaSqm}
            onChange={(e) => onUpdate({ gfaSqm: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle}
          />
        </div>
        <div>
          <InputLabel
            label="BUA (sqm)"
            help="Built-Up Area. Net of MEP / BoH. Auto-derived from sub-units when 0."
            inputId={`asset-${asset.id}-buaSqm`}
          />
          <input
            id={`asset-${asset.id}-buaSqm`}
            data-testid={`asset-${asset.id}-buaSqm`}
            type="number"
            min={0}
            value={asset.buaSqm}
            onChange={(e) => onUpdate({ buaSqm: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle}
            placeholder={asset.buaSqm === 0 ? `auto = ${fmt(derivedBua)}` : undefined}
          />
        </div>
        <div>
          <InputLabel
            label="Sellable BUA (sqm)"
            help="Sellable / leasable / operable area within BUA. Auto-derived from non-Support sub-units when 0."
            inputId={`asset-${asset.id}-sellableBuaSqm`}
          />
          <input
            id={`asset-${asset.id}-sellableBuaSqm`}
            data-testid={`asset-${asset.id}-sellableBuaSqm`}
            type="number"
            min={0}
            value={asset.sellableBuaSqm}
            onChange={(e) => onUpdate({ sellableBuaSqm: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle}
            placeholder={asset.sellableBuaSqm === 0 ? `auto = ${fmt(derivedSellable)}` : undefined}
          />
        </div>
        <div>
          <InputLabel
            label="Parking Bays Required"
            help="Total parking bay count fed to the parking-cost line. No allocator math."
            inputId={`asset-${asset.id}-parkingBaysRequired`}
          />
          <input
            id={`asset-${asset.id}-parkingBaysRequired`}
            data-testid={`asset-${asset.id}-parkingBaysRequired`}
            type="number"
            min={0}
            value={asset.parkingBaysRequired}
            onChange={(e) => onUpdate({ parkingBaysRequired: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-2)',
          fontSize: 'var(--font-small)',
        }}
      >
        <div data-testid={`asset-${asset.id}-derived-bua`}>
          <strong>BUA (live):</strong>{' '}
          <span style={calcOutputStyle}>{fmt(derivedBua)} sqm</span>
        </div>
        <div data-testid={`asset-${asset.id}-derived-sellable`}>
          <strong>Sellable BUA (live):</strong>{' '}
          <span style={calcOutputStyle}>{fmt(derivedSellable)} sqm</span>
        </div>
        <div data-testid={`asset-${asset.id}-efficiency`}>
          <strong>Efficiency:</strong>{' '}
          <span style={calcOutputStyle}>{fmt(efficiency, 1)}%</span>
        </div>
        <div data-testid={`asset-${asset.id}-land-cost`}>
          <strong>Land Cost:</strong>{' '}
          <span style={calcOutputStyle}>{fmt(landCost)} {currency}</span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--sp-2)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--sp-1)',
          }}
        >
          <strong style={{ fontSize: 'var(--font-small)' }}>Sub-units</strong>
          <button
            type="button"
            onClick={handleAddSubUnit}
            data-testid={`asset-${asset.id}-add-subunit`}
            style={{
              background: 'var(--color-navy)',
              color: 'var(--color-on-primary-navy)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 'var(--font-micro)',
            }}
          >
            + Sub-unit
          </button>
        </div>
        {assetSubUnits.length === 0 && (
          <div
            style={{
              fontSize: 'var(--font-small)',
              color: 'var(--color-meta)',
              padding: 'var(--sp-1)',
            }}
          >
            No sub-units yet. Add at least one so revenue (Module 2) can attach.
          </div>
        )}
        {assetSubUnits.map((subUnit) => (
          <SubUnitRow
            key={subUnit.id}
            subUnit={subUnit}
            currency={currency}
            onUpdate={(patch) => updateSubUnit(subUnit.id, patch)}
            onRemove={() => removeSubUnit(subUnit.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface SubUnitRowProps {
  subUnit: SubUnit;
  currency: string;
  onUpdate: (patch: Partial<SubUnit>) => void;
  onRemove: () => void;
}

function SubUnitRow({ subUnit, currency, onUpdate, onRemove }: SubUnitRowProps): React.JSX.Element {
  const totalArea = computeSubUnitArea(subUnit);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 60px',
        gap: 'var(--sp-1)',
        marginBottom: 'var(--sp-1)',
        alignItems: 'center',
        fontSize: 'var(--font-small)',
      }}
      data-testid={`subunit-row-${subUnit.id}`}
    >
      <input
        type="text"
        value={subUnit.name}
        data-testid={`subunit-${subUnit.id}-name`}
        onChange={(e) => onUpdate({ name: e.target.value })}
        style={inputStyle}
        placeholder="Name"
      />
      <select
        value={subUnit.category}
        data-testid={`subunit-${subUnit.id}-category`}
        onChange={(e) => onUpdate({ category: e.target.value as SubUnitCategory })}
        style={inputStyle}
      >
        {SUB_UNIT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={subUnit.metric}
        data-testid={`subunit-${subUnit.id}-metric`}
        onChange={(e) => onUpdate({ metric: e.target.value as SubUnitMetric })}
        style={inputStyle}
      >
        <option value="count">count</option>
        <option value="area">area</option>
      </select>
      <input
        type="number"
        min={0}
        value={subUnit.metricValue}
        data-testid={`subunit-${subUnit.id}-metricValue`}
        onChange={(e) => onUpdate({ metricValue: Math.max(0, Number(e.target.value) || 0) })}
        style={inputStyle}
        placeholder={subUnit.metric === 'count' ? 'count' : 'sqm'}
      />
      <input
        type="number"
        min={0}
        value={subUnit.unitArea ?? 0}
        data-testid={`subunit-${subUnit.id}-unitArea`}
        onChange={(e) => onUpdate({ unitArea: Math.max(0, Number(e.target.value) || 0) })}
        style={inputStyle}
        placeholder="sqm/unit"
        disabled={subUnit.metric === 'area'}
      />
      <input
        type="number"
        min={0}
        value={subUnit.unitPrice}
        data-testid={`subunit-${subUnit.id}-unitPrice`}
        onChange={(e) => onUpdate({ unitPrice: Math.max(0, Number(e.target.value) || 0) })}
        style={inputStyle}
        placeholder="price"
      />
      <input
        type="number"
        min={0}
        max={100}
        value={subUnit.occupancyPct ?? 0}
        data-testid={`subunit-${subUnit.id}-occupancyPct`}
        onChange={(e) => onUpdate({ occupancyPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
        style={inputStyle}
        placeholder="occ %"
      />
      <span
        style={{ ...calcOutputStyle, fontSize: 'var(--font-small)' }}
        data-testid={`subunit-${subUnit.id}-totalArea`}
      >
        {fmt(totalArea)} {currency === '' ? '' : ''}sqm
      </span>
      <button
        type="button"
        onClick={onRemove}
        data-testid={`subunit-${subUnit.id}-remove`}
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '2px 6px',
          cursor: 'pointer',
          fontSize: 'var(--font-micro)',
        }}
      >
        x
      </button>
    </div>
  );
}
