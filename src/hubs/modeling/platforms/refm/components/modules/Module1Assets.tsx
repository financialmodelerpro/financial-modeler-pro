'use client';

/**
 * Module1Assets.tsx (v7 schema, M2.0e rebuild)
 *
 * Tab 2 becomes the canonical asset entry surface. Wizard Step 3 only
 * captures Project.projectType; all asset detail (areas, sub-units,
 * pricing, parking, status, useful life, management agreement) lives
 * here.
 *
 * Layout:
 *   1. Land Parcels block (unchanged from M2.0d)
 *   2. Land Allocation Mode (unchanged)
 *   3. Assets section, grouped per phase:
 *      - Phase header (name + start date + asset count + add button)
 *      - One AssetCard per asset under that phase (collapsible)
 *      - Empty-state suggestion when phase has no assets
 *   4. Global totals (BUA / Sellable / Operable / Leasable / Land Cost)
 *
 * Asset card carries: Name + Phase dropdown (reassign) + Strategy +
 * Type (filtered by Project.projectType) + Status (planned / construction
 * / operational) + Visible toggle + Delete. Conditional sub-forms below
 * the header: Management Agreement (Sell + Manage) and Useful Life
 * (Operate / Lease). Then Land allocation row + Area inputs + Sub-units
 * table (Type / Category / Area / Unit Size / Count / Rate / Rate Unit)
 * + Asset card footer (BUA reconciliation + Land Cost + Capex preview).
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type Asset,
  type AssetLandAllocation,
  type AssetParcelSplit,
  type AssetStrategy,
  type AssetStatus,
  type ManagementAgreement,
  type Parcel,
  type SubUnit,
  type SubUnitCategory,
  type SubUnitMetric,
  type LandAllocationMode,
  type Phase,
  type Project,
  ASSET_STRATEGIES,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ASSET_TYPES_BY_PROJECT_TYPE,
  ASSET_TYPES_BY_STRATEGY,
  SUGGESTED_CATEGORIES_BY_PROJECT_TYPE,
  DEFAULT_OPERATIONS_BY_STRATEGY,
  DEFAULT_MANAGEMENT_AGREEMENT,
  DEFAULT_USEFUL_LIFE_YEARS,
  SUB_UNIT_CATEGORIES,
  LAND_ALLOCATION_MODES,
  PARCEL_WEIGHTED_AVG,
  PARCEL_CUSTOM_RATE,
} from '../../lib/state/module1-types';
import {
  computeAssetAreaHierarchy,
  computeAssetLandBreakdown,
  computeLandAggregate,
  computeLandReconciliation,
  computeParcelNda,
  computeSubUnitArea,
  computePhaseTimeline,
  resolveUsefulLifeYears,
  validateLandAllocation,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatScaled, formatScaledCurrency } from '@/src/core/formatters';
import InputLabel from '../ui/InputLabel';

// ── Styles ─────────────────────────────────────────────────────────────────
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

const phaseHeaderStyle: React.CSSProperties = {
  background: 'var(--color-navy)',
  color: 'var(--color-on-primary-navy)',
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--sp-2)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'pointer',
};

// M2.0g: integer/area helper (full numbers, no scale). Used for sqm,
// counts, percent values that shouldn't be K/M-scaled.
const fmt = (n: number, digits = 0): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : 'n/a';

// M2.0h Fix 2 (2026-05-07) + M2.0i Fix 3 (2026-05-07): in-cell currency
// formatting drops the trailing currency code; the per-tab header line
// tells the user what unit (and scale) every number is rendered at.
// Cells render pure numbers via formatScaled. The 4th parameter
// `decimals` was added in M2.0i so the project-wide displayDecimals
// preference flows end-to-end.
const fmtCurrency = (
  n: number,
  _currency: string,
  scale: import('../../lib/state/module1-types').DisplayScale = 'full',
  decimals: import('../../lib/state/module1-types').DisplayDecimals = 2,
): string => formatScaled(n, scale, decimals);
const fmtCurrencyWithCode = (
  n: number,
  currency: string,
  scale: import('../../lib/state/module1-types').DisplayScale = 'full',
  decimals: import('../../lib/state/module1-types').DisplayDecimals = 2,
): string => formatScaledCurrency(n, currency, scale, decimals);

// M2.0e: long-form strategy labels for the dropdown.
const STRATEGY_LABELS: Record<AssetStrategy, string> = {
  'Sell':          'Sell, build and sell units (residential apartments)',
  'Operate':       'Operate (Own), build, retain, operate (hotel ownership)',
  'Lease':         'Lease (Own), build, retain, lease (retail ownership)',
  'Sell + Manage': 'Sell + Manage, sell to investors, manage via agreement (Tower pattern)',
};

// Status pill color.
function statusBadgeStyle(status: AssetStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
  switch (status) {
    case 'planned':
      return { ...base, background: 'color-mix(in srgb, var(--color-grey-mid) 18%, transparent)', color: 'var(--color-grey-mid)' };
    case 'construction':
      return { ...base, background: 'color-mix(in srgb, var(--color-accent-warm) 22%, transparent)', color: 'var(--color-heading)' };
    case 'operational':
      return { ...base, background: 'color-mix(in srgb, var(--color-success) 22%, transparent)', color: 'var(--color-success)' };
  }
}

// Rate Unit derivation for sub-unit table column: combo of category +
// metric tells us what the "Rate" column means. M2.0g Fix 4: Parking
// is now an asset-level field, no longer a sub-unit category.
function rateUnitLabel(category: SubUnitCategory, metric: SubUnitMetric): string {
  if (category === 'Support') return '';
  if (category === 'Sellable') return metric === 'count' ? 'per unit' : 'per sqm';
  if (category === 'Operable') return metric === 'count' ? 'per room/night' : 'per sqm/year';
  if (category === 'Leasable') return metric === 'count' ? 'per unit/year' : 'per sqm/year';
  return '';
}

// Type catalog for the asset Type dropdown. Project.projectType wins
// when set; otherwise falls back to strategy-keyed catalog.
function resolveTypeCatalog(asset: Asset, project: Project): readonly string[] {
  if (project.projectType && ASSET_TYPES_BY_PROJECT_TYPE[project.projectType]) {
    return ASSET_TYPES_BY_PROJECT_TYPE[project.projectType];
  }
  return ASSET_TYPES_BY_STRATEGY[asset.strategy];
}

// ── Module1Assets root ────────────────────────────────────────────────────
export default function Module1Assets(): React.JSX.Element {
  const {
    project,
    phases,
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

  // Aggregate land across all phases (M2.0e: parcels can spread across
  // phases). Land allocation mode applies project-wide.
  const aggregate = useMemo(() => computeLandAggregate(parcels), [parcels]);
  // M2.0f Fix 2: under/over allocation banner. Mode A only (sqm); modes B
  // and C are auto-balanced by definition.
  const landValidation = useMemo(
    () => validateLandAllocation(parcels, assets, landAllocationMode),
    [parcels, assets, landAllocationMode],
  );

  // M2.0g Fix 2: project-wide land reconciliation. Renders below
  // the parcels block.
  const landReconciliation = useMemo(
    () => computeLandReconciliation(parcels, assets, subUnits, landAllocationMode),
    [parcels, assets, subUnits, landAllocationMode],
  );

  // Build per-phase asset groups, sorted by startDate / constructionStart
  const phaseGroups = useMemo(() => {
    return [...phases]
      .sort((a, b) => {
        const aDate = a.startDate ?? `period-${a.constructionStart}`;
        const bDate = b.startDate ?? `period-${b.constructionStart}`;
        return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
      })
      .map((p) => ({
        phase: p,
        timeline: computePhaseTimeline(p, project),
        phaseAssets: assets.filter((a) => a.phaseId === p.id),
      }));
  }, [phases, assets, project]);

  // M2.0h Fix 3: project-wide totals reflect the three-tier
  // hierarchy. nsa / bua / gfa aggregate from each visible asset's
  // computeAssetAreaHierarchy.
  const globals = useMemo(() => {
    let nsa = 0, bua = 0, gfa = 0, sellable = 0, operable = 0, leasable = 0, support = 0, parking = 0;
    for (const a of assets.filter((x) => x.visible)) {
      const hier = computeAssetAreaHierarchy(a, subUnits);
      nsa += hier.nsa;
      bua += hier.bua;
      gfa += a.gfaSqm > 0 ? a.gfaSqm : hier.gfa;
      sellable += hier.breakdown.sellableArea;
      operable += hier.breakdown.operableArea;
      leasable += hier.breakdown.leasableArea;
      support += hier.breakdown.supportArea;
      parking += hier.breakdown.parkingArea;
    }
    return { nsa, bua, gfa, sellable, operable, leasable, support, parking };
  }, [assets, subUnits]);

  const handleAddParcel = (): void => {
    if (!phases[0]) return;
    addParcel({
      id: `parcel_${Date.now()}`,
      phaseId: phases[0].id,
      name: `Land ${parcels.length + 1}`,
      area: 50000,
      rate: 500,
      cashPct: 60,
      inKindPct: 40,
    });
  };

  const handleAddAssetToPhase = (phaseId: string): void => {
    const phaseAssetCount = assets.filter((a) => a.phaseId === phaseId).length;
    // M2.0g Fix 2: default land allocation to the first phase parcel
    // (not "(weighted average)") so the asset's resolved rate matches
    // a real parcel rate out of the box.
    const phaseParcels = parcels.filter((p) => p.phaseId === phaseId);
    const fallbackParcel = phaseParcels[0] ?? parcels[0];
    addAsset({
      id: `asset_${Date.now()}`,
      phaseId,
      name: `Asset ${phaseAssetCount + 1}`,
      type: project.projectType ? (ASSET_TYPES_BY_PROJECT_TYPE[project.projectType][0] ?? '') : 'High-end Apartments',
      strategy: 'Sell',
      visible: true,
      gfaSqm: 0,
      buaSqm: 0,
      sellableBuaSqm: 0,
      parkingBaysRequired: 0,
      status: 'planned',
      landAllocation: fallbackParcel ? { parcelId: fallbackParcel.id, sqm: 0 } : undefined,
    });
  };

  return (
    <div data-testid="tab-assets">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-3)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <h2 style={{ fontSize: 'var(--font-h2)', margin: 0 }}>
          2. Assets &amp; Sub-units
        </h2>
        <div
          style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic' }}
          data-testid="currency-header-line"
        >
          {currencyHeaderLine(project.currency, project.displayScale ?? 'full')}
        </div>
      </div>

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
        <strong>What goes here:</strong> Land parcels, then per-phase asset
        cards (areas, sub-units, status, useful life). Asset Type dropdown
        is filtered by your project type (
        <strong>{project.projectType ?? 'Mixed-Use'}</strong>); pick a
        narrower type in Step 3 of Create Project to narrow the catalog.
      </div>

      {/* Land Parcels block (unchanged) */}
      <div style={sectionCardStyle} data-testid="parcels-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
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
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="parcels-table">
          <thead>
            <tr>
              <th style={tableHeaderStyle}><InputLabel label="Parcel Name" help="Free-text label." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Area (sqm)" help="Land area for this parcel." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Rate (per sqm)" help="Acquisition cost per sqm." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Cash %" help="Share paid in cash. Cash + In-kind = 100." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="In-Kind %" help="Share paid in-kind (equity from landowner)." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="NDA?" help="Net Developable Area deduction. Toggle ON to subtract Roads % + Parks % from the parcel's developable area." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Roads %" help="Share of parcel area reserved for roads (only when NDA toggle is on)." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Parks %" help="Share of parcel area reserved for parks (only when NDA toggle is on)." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="NDA (sqm)" help="Net developable area = parcel area × (1 - roads% - parks%). When toggle off, equals parcel area." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Effective NDA Rate" help="Total parcel cost / NDA. Inflated when roads + parks reserve some of the parcel; equal to parcel rate when NDA toggle off." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Total Value" help="Auto = Area x Rate." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}></th>
            </tr>
          </thead>
          <tbody>
            {parcels.map((parcel) => (
              <ParcelRow
                key={parcel.id}
                parcel={parcel}
                onUpdate={(patch) => updateParcel(parcel.id, patch)}
                onRemove={() => removeParcel(parcel.id)}
                canRemove={parcels.length > 1}
              />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 'var(--fw-bold)' }}>
              <td style={{ padding: 'var(--sp-1)' }}>Totals</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-area">{fmt(aggregate.totalAreaSqm)} sqm</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-weighted-rate">{fmt(aggregate.weightedRate, 2)} /sqm</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-cash-value">{fmt(aggregate.cashValue)}</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-inkind-value">{fmt(aggregate.inKindValue)}</td>
              <td colSpan={3}></td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-nda">{fmt(parcels.reduce((s, p) => s + computeParcelNda(p).nda, 0))} sqm</td>
              <td></td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-value">{fmt(aggregate.totalValue)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* M2.0g Fix 2 + M2.0h Fix 4: Land Reconciliation block.
          Compares parcels total area, NDA, and value against the sum of
          asset allocations + values. NDA reservation (M2.0h) is shown
          as a separate line when any parcel has the toggle on. */}
      {(() => {
        const totalParcelsNda = parcels.reduce((s, p) => s + computeParcelNda(p).nda, 0);
        const totalReservedRoadsParks = landReconciliation.parcelsTotalSqm - totalParcelsNda;
        const anyNda = parcels.some((p) => p.hasNdaDeduction === true);
        return (
          <div
            style={{
              ...sectionCardStyle,
              background: landReconciliation.matches
                ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
                : landReconciliation.overBy > 0
                  ? 'color-mix(in srgb, var(--color-negative) 10%, transparent)'
                  : 'color-mix(in srgb, var(--color-accent-warm) 10%, transparent)',
              border: `1px solid ${landReconciliation.matches
                ? 'var(--color-success)'
                : landReconciliation.overBy > 0
                  ? 'var(--color-negative)'
                  : 'var(--color-accent-warm)'}`,
            }}
            data-testid="land-reconciliation"
          >
            <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)' }}>Land Reconciliation</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--sp-2)', fontSize: 'var(--font-small)' }}>
              <div>
                <div style={{ color: 'var(--color-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total parcels area</div>
                <div data-testid="land-reconciliation-parcels-sqm"><strong>{fmt(landReconciliation.parcelsTotalSqm)}</strong> sqm</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Allocated to assets</div>
                <div data-testid="land-reconciliation-allocated-sqm"><strong>{fmt(landReconciliation.assetsAllocatedSqm)}</strong> sqm</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</div>
                <div data-testid="land-reconciliation-status">
                  {landReconciliation.matches && (
                    <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>matches</span>
                  )}
                  {landReconciliation.overBy > 0 && (
                    <span style={{ color: 'var(--color-negative)', fontWeight: 700 }}>over by {fmt(landReconciliation.overBy)} sqm</span>
                  )}
                  {landReconciliation.shortBy > 0 && (
                    <span style={{ color: 'var(--color-accent-warm)', fontWeight: 700 }}>short by {fmt(landReconciliation.shortBy)} sqm (some land unassigned)</span>
                  )}
                </div>
              </div>
              {anyNda && (
                <>
                  <div>
                    <div style={{ color: 'var(--color-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total NDA</div>
                    <div data-testid="land-reconciliation-total-nda"><strong>{fmt(totalParcelsNda)}</strong> sqm <span style={{ color: 'var(--color-meta)' }}>({fmt(totalReservedRoadsParks)} reserved for roads / parks)</span></div>
                  </div>
                  <div></div>
                  <div></div>
                </>
              )}
              <div>
                <div style={{ color: 'var(--color-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total parcels value</div>
                <div data-testid="land-reconciliation-parcels-value"><strong>{fmtCurrency(landReconciliation.parcelsTotalValue, project.currency, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</strong></div>
              </div>
              <div>
                <div style={{ color: 'var(--color-meta)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Asset land cost</div>
                <div data-testid="land-reconciliation-allocated-value"><strong>{fmtCurrency(landReconciliation.assetsAllocatedValue, project.currency, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</strong></div>
              </div>
              <div></div>
            </div>
          </div>
        );
      })()}

      {/* Land Allocation Mode (unchanged) */}
      <div style={sectionCardStyle} data-testid="land-allocation-section">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)' }}>Land Allocation Mode</h3>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {LAND_ALLOCATION_MODES.map((mode) => (
            <label key={mode} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--font-small)' }} data-testid={`land-mode-${mode}`}>
              <input type="radio" name="land-allocation-mode" value={mode} checked={landAllocationMode === mode} onChange={() => setLandAllocationMode(mode)} />
              {mode === 'sqm' && 'A. Direct sqm per asset'}
              {mode === 'percent' && 'B. Percent split per asset'}
              {mode === 'autoByBua' && 'C. Auto, weight by BUA'}
            </label>
          ))}
        </div>
        {landAllocationMode === 'sqm' && landValidation.status !== 'ok' && (
          <div
            style={{
              marginTop: 'var(--sp-2)',
              padding: 'var(--sp-1) var(--sp-2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-small)',
              background: landValidation.status === 'over' ? 'var(--color-warning-bg)' : 'var(--color-grey-pale)',
              border: `1px solid ${landValidation.status === 'over' ? 'var(--color-negative)' : 'var(--color-border)'}`,
              color: landValidation.status === 'over' ? 'var(--color-negative)' : 'var(--color-meta)',
            }}
            data-testid="land-allocation-validation"
          >
            {landValidation.status === 'over' && (
              <>Over-allocation: assets request <strong>{fmt(landValidation.allocatedSqm)} sqm</strong> but parcels total <strong>{fmt(landValidation.parcelTotalSqm)} sqm</strong> (excess {fmt(landValidation.overAllocatedSqm)} sqm).</>
            )}
            {landValidation.status === 'under' && (
              <>Under-allocation: <strong>{fmt(landValidation.unallocatedSqm)} sqm</strong> of land is unassigned (parcels total {fmt(landValidation.parcelTotalSqm)} sqm, assets request {fmt(landValidation.allocatedSqm)} sqm). Assign in each asset card or set aside.</>
            )}
          </div>
        )}
      </div>

      {/* Per-phase asset sections */}
      {phaseGroups.map(({ phase, timeline, phaseAssets }) => (
        <PhaseAssetSection
          key={phase.id}
          phase={phase}
          phaseTimeline={timeline}
          phaseAssets={phaseAssets}
          allAssets={assets}
          allPhases={phases}
          parcels={parcels}
          subUnits={subUnits}
          project={project}
          landAllocationMode={landAllocationMode}
          onUpdateAsset={updateAsset}
          onRemoveAsset={removeAsset}
          onAddAsset={() => handleAddAssetToPhase(phase.id)}
        />
      ))}

      {/* Global totals (M2.0h Fix 3: three-tier hierarchy) */}
      <div style={{ ...sectionCardStyle, background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }} data-testid="assets-globals">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)', color: 'var(--color-on-primary-navy)' }}>Project Totals</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)', fontSize: 'var(--font-small)', marginBottom: 'var(--sp-2)' }}>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>NSA</div>
            <strong style={{ fontSize: 16 }} data-testid="globals-nsa">{fmt(globals.nsa)} sqm</strong>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>BUA</div>
            <strong style={{ fontSize: 16 }} data-testid="globals-bua">{fmt(globals.bua)} sqm</strong>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>GFA</div>
            <strong style={{ fontSize: 16 }} data-testid="globals-gfa">{fmt(globals.gfa)} sqm</strong>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Land Cost</div>
            <strong style={{ fontSize: 16 }} data-testid="globals-land-cost">{fmtCurrency(aggregate.totalValue, project.currency, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</strong>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--sp-2)', fontSize: 'var(--font-small)' }}>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sellable</div>
            <strong style={{ fontSize: 14 }} data-testid="globals-sellable">{fmt(globals.sellable)} sqm</strong>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operable</div>
            <strong style={{ fontSize: 14 }} data-testid="globals-operable">{fmt(globals.operable)} sqm</strong>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Leasable</div>
            <strong style={{ fontSize: 14 }} data-testid="globals-leasable">{fmt(globals.leasable)} sqm</strong>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Support</div>
            <strong style={{ fontSize: 14 }} data-testid="globals-support">{fmt(globals.support)} sqm</strong>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Parking</div>
            <strong style={{ fontSize: 14 }} data-testid="globals-parking">{fmt(globals.parking)} sqm</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Parcel row ─────────────────────────────────────────────────────────────
interface ParcelRowProps {
  parcel: Parcel;
  onUpdate: (patch: Partial<Parcel>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ParcelRow({ parcel, onUpdate, onRemove, canRemove }: ParcelRowProps): React.JSX.Element {
  const total = parcel.area * parcel.rate;
  const nda = computeParcelNda(parcel);
  const ndaOn = parcel.hasNdaDeduction === true;
  return (
    <tr data-testid={`parcel-row-${parcel.id}`}>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input type="text" value={parcel.name} data-testid={`parcel-${parcel.id}-name`} onChange={(e) => onUpdate({ name: e.target.value })} style={inputStyle} />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input type="number" min={0} value={parcel.area} data-testid={`parcel-${parcel.id}-area`} onChange={(e) => onUpdate({ area: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input type="number" min={0} value={parcel.rate} data-testid={`parcel-${parcel.id}-rate`} onChange={(e) => onUpdate({ rate: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number" min={0} max={100} value={parcel.cashPct}
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
          type="number" min={0} max={100} value={parcel.inKindPct}
          data-testid={`parcel-${parcel.id}-inKindPct`}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
            onUpdate({ inKindPct: v, cashPct: 100 - v });
          }}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)', textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={ndaOn}
          data-testid={`parcel-${parcel.id}-hasNdaDeduction`}
          onChange={(e) => onUpdate({ hasNdaDeduction: e.target.checked })}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number" min={0} max={100} value={parcel.roadsPct ?? 0}
          data-testid={`parcel-${parcel.id}-roadsPct`}
          onChange={(e) => onUpdate({ roadsPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          style={{ ...inputStyle, opacity: ndaOn ? 1 : 0.4 }}
          disabled={!ndaOn}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input
          type="number" min={0} max={100} value={parcel.parksPct ?? 0}
          data-testid={`parcel-${parcel.id}-parksPct`}
          onChange={(e) => onUpdate({ parksPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          style={{ ...inputStyle, opacity: ndaOn ? 1 : 0.4 }}
          disabled={!ndaOn}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)', color: 'var(--color-heading)' }} data-testid={`parcel-${parcel.id}-nda`}>
        {fmt(nda.nda)}
      </td>
      <td style={{ padding: 'var(--sp-1)', color: 'var(--color-heading)' }} data-testid={`parcel-${parcel.id}-effectiveNdaRate`}>
        {fmt(nda.effectiveNdaRate, 2)}
      </td>
      <td style={{ padding: 'var(--sp-1)', color: 'var(--color-heading)' }} data-testid={`parcel-${parcel.id}-total`}>{fmt(total)}</td>
      <td style={{ padding: 'var(--sp-1)', textAlign: 'right' }}>
        {canRemove && (
          <button type="button" onClick={onRemove} data-testid={`parcel-${parcel.id}-remove`} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}>Remove</button>
        )}
      </td>
    </tr>
  );
}

// ── PhaseAssetSection ──────────────────────────────────────────────────────
interface PhaseAssetSectionProps {
  phase: Phase;
  phaseTimeline: { constructionStart: string; constructionEnd: string; operationsStart: string; operationsEnd: string };
  phaseAssets: Asset[];
  allAssets: Asset[];
  allPhases: Phase[];
  parcels: Parcel[];
  subUnits: SubUnit[];
  project: Project;
  landAllocationMode: LandAllocationMode;
  onUpdateAsset: (id: string, patch: Partial<Asset>) => void;
  onRemoveAsset: (id: string) => void;
  onAddAsset: () => void;
}

function PhaseAssetSection({
  phase, phaseTimeline, phaseAssets, allAssets, allPhases, parcels, subUnits, project,
  landAllocationMode, onUpdateAsset, onRemoveAsset, onAddAsset,
}: PhaseAssetSectionProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const suggestions = SUGGESTED_CATEGORIES_BY_PROJECT_TYPE[project.projectType ?? 'Mixed-Use'] ?? [];

  return (
    <div data-testid={`phase-section-${phase.id}`} style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={phaseHeaderStyle} onClick={() => setCollapsed(!collapsed)}>
        <div>
          <strong style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {phase.name}
          </strong>
          <span style={{ marginLeft: 12, fontSize: 11, opacity: 0.85 }} data-testid={`phase-section-${phase.id}-timeline`}>
            {phaseTimeline.constructionStart} to {phaseTimeline.operationsEnd} ({phase.constructionPeriods}p construction + {phase.operationsPeriods}p operations)
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, opacity: 0.85 }} data-testid={`phase-section-${phase.id}-asset-count`}>
            {phaseAssets.length} asset{phaseAssets.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddAsset(); }}
            data-testid={`phase-section-${phase.id}-add-asset`}
            style={{
              background: 'var(--color-on-primary-navy)',
              color: 'var(--color-navy)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            + Add Asset
          </button>
          <span style={{ fontSize: 14, opacity: 0.85 }}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          {phaseAssets.length === 0 && (
            <div
              style={{
                ...sectionCardStyle,
                textAlign: 'center',
                color: 'var(--color-meta)',
                fontSize: 'var(--font-small)',
              }}
              data-testid={`phase-section-${phase.id}-empty`}
            >
              No assets yet in {phase.name}. {suggestions.length > 0 && (
                <>
                  Suggested for <strong>{project.projectType ?? 'Mixed-Use'}</strong>: {suggestions.join(', ')}.
                </>
              )}
            </div>
          )}
          {phaseAssets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              allAssets={allAssets}
              allPhases={allPhases}
              parcels={parcels}
              subUnits={subUnits}
              project={project}
              landAllocationMode={landAllocationMode}
              onUpdate={(patch) => onUpdateAsset(asset.id, patch)}
              onRemove={() => onRemoveAsset(asset.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ── AssetCard ──────────────────────────────────────────────────────────────
interface AssetCardProps {
  asset: Asset;
  allAssets: Asset[];
  allPhases: Phase[];
  parcels: Parcel[];
  subUnits: SubUnit[];
  project: Project;
  landAllocationMode: LandAllocationMode;
  onUpdate: (patch: Partial<Asset>) => void;
  onRemove: () => void;
}

function AssetCard({
  asset, allAssets, allPhases, parcels, subUnits, project,
  landAllocationMode, onUpdate, onRemove,
}: AssetCardProps): React.JSX.Element {
  const { addSubUnit, updateSubUnit, removeSubUnit } = useModule1Store(
    useShallow((s) => ({
      addSubUnit: s.addSubUnit,
      updateSubUnit: s.updateSubUnit,
      removeSubUnit: s.removeSubUnit,
    })),
  );
  const [collapsed, setCollapsed] = useState(false);
  const assetSubUnits = subUnits.filter((u) => u.assetId === asset.id);
  // M2.0f Fix 6: BUA totals derive from sub-units. Asset.buaSqm /
  // sellableBuaSqm fields stay on the schema for v7 compat but are
  // now read-only display lines (no longer hand-editable inputs).
  const derivedBua = assetSubUnits.reduce((s, u) => s + computeSubUnitArea(u), 0);
  const sellableSum = assetSubUnits
    .filter((u) => u.category === 'Sellable')
    .reduce((s, u) => s + computeSubUnitArea(u), 0);
  const operableSum = assetSubUnits
    .filter((u) => u.category === 'Operable')
    .reduce((s, u) => s + computeSubUnitArea(u), 0);
  const leasableSum = assetSubUnits
    .filter((u) => u.category === 'Leasable')
    .reduce((s, u) => s + computeSubUnitArea(u), 0);
  const supportSum = assetSubUnits
    .filter((u) => u.category === 'Support')
    .reduce((s, u) => s + computeSubUnitArea(u), 0);
  // M2.0g Fix 4: Parking moves to asset.parkingArea (asset-level
  // input). supportArea also gets an asset-level companion input;
  // the asset card prefers asset.parkingArea over the legacy
  // sub-unit sum so users can enter a single number when they don't
  // need sub-unit breakdown.
  const parkingSum = Math.max(0, asset.parkingArea ?? 0);
  const supportTotal = supportSum + Math.max(0, asset.supportArea ?? 0);
  const derivedSellable = sellableSum + operableSum + leasableSum;
  // M2.0f Fix 2: per-parcel breakdown drives the land cost summary.
  const landBreakdown = computeAssetLandBreakdown(asset, parcels, allAssets, subUnits, landAllocationMode);
  const landCost = landBreakdown.landValue;
  const efficiency = derivedBua > 0 ? (derivedSellable / derivedBua) * 100 : 0;

  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  const allocation: AssetLandAllocation = asset.landAllocation ?? {};

  const setAllocation = (patch: Partial<AssetLandAllocation>): void => {
    onUpdate({
      landAllocation: { ...allocation, ...patch },
      // Mirror legacy fields when the structured shape is set so any
      // legacy reader still sees consistent data.
      landAreaSqm: patch.sqm !== undefined ? patch.sqm : asset.landAreaSqm,
      landAreaPct: patch.pct !== undefined ? patch.pct : asset.landAreaPct,
    });
  };

  const addSplit = (): void => {
    const fallbackParcel = phaseParcels[0]?.id ?? '';
    const newSplit: AssetParcelSplit = { parcelId: fallbackParcel, sqm: 0 };
    setAllocation({
      multiParcelSplits: [...(allocation.multiParcelSplits ?? []), newSplit],
    });
  };
  const removeSplit = (idx: number): void => {
    const next = (allocation.multiParcelSplits ?? []).filter((_, i) => i !== idx);
    setAllocation({ multiParcelSplits: next.length > 0 ? next : undefined });
  };
  const updateSplit = (idx: number, patch: Partial<AssetParcelSplit>): void => {
    const list = (allocation.multiParcelSplits ?? []).map((sp, i) => (i === idx ? { ...sp, ...patch } : sp));
    setAllocation({ multiParcelSplits: list });
  };

  const handleAddSubUnit = (): void => {
    const ops = DEFAULT_OPERATIONS_BY_STRATEGY[asset.strategy];
    const category = asset.strategy === 'Lease' ? 'Leasable' : asset.strategy === 'Operate' ? 'Operable' : 'Sellable';
    addSubUnit({
      id: `subunit_${Date.now()}`,
      assetId: asset.id,
      name: 'Sub-unit',
      category,
      metric: asset.strategy === 'Lease' ? 'area' : 'count',
      metricValue: asset.strategy === 'Lease' ? 1000 : 50,
      unitArea: asset.strategy === 'Lease' ? undefined : 100,
      unitPrice: asset.strategy === 'Sell' ? 1000000 : asset.strategy === 'Operate' ? 800 : 1200,
      occupancyPct: ops.occupancyPct,
      operatingMargin: ops.operatingMargin,
    });
  };

  const typeOptions = resolveTypeCatalog(asset, project);
  const status = asset.status ?? 'planned';

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderLeft: '4px solid var(--color-navy)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-2)',
        background: 'var(--color-bg)',
      }}
      data-testid={`asset-card-${asset.id}`}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)', cursor: 'pointer' }} onClick={() => setCollapsed(!collapsed)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 14 }}>{asset.name || `(unnamed asset)`}</strong>
          <span style={statusBadgeStyle(status)} data-testid={`asset-card-${asset.id}-status-pill`}>
            {ASSET_STATUS_LABELS[status]}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>{asset.strategy} · {asset.type || 'no type'}</span>
        </div>
        <span style={{ fontSize: 14, color: 'var(--color-meta)' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) auto', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
            <div>
              <InputLabel label="Asset Name" help="Free-text label." inputId={`asset-${asset.id}-name`} />
              <input id={`asset-${asset.id}-name`} data-testid={`asset-${asset.id}-name`} type="text" value={asset.name} onChange={(e) => onUpdate({ name: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Phase" help="Reassign this asset to another phase. The asset visually moves to that phase's section." inputId={`asset-${asset.id}-phase`} />
              <select
                id={`asset-${asset.id}-phase`}
                data-testid={`asset-${asset.id}-phase`}
                value={asset.phaseId}
                onChange={(e) => onUpdate({ phaseId: e.target.value })}
                style={inputStyle}
              >
                {allPhases.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
            <div>
              <InputLabel label="Strategy" help="Sell / Operate / Lease / Sell + Manage. Drives Tab 3 cost classification + future revenue logic." inputId={`asset-${asset.id}-strategy`} />
              <select
                id={`asset-${asset.id}-strategy`}
                data-testid={`asset-${asset.id}-strategy`}
                value={asset.strategy}
                onChange={(e) => onUpdate({ strategy: e.target.value as AssetStrategy })}
                style={inputStyle}
              >
                {ASSET_STRATEGIES.map((s) => (<option key={s} value={s}>{STRATEGY_LABELS[s]}</option>))}
              </select>
            </div>
            <div>
              <InputLabel label="Type" help={`Asset type. Catalog filtered by Project Type (${project.projectType ?? 'Mixed-Use'}). Free-text any other type.`} inputId={`asset-${asset.id}-type`} />
              <input id={`asset-${asset.id}-type`} data-testid={`asset-${asset.id}-type`} type="text" list={`asset-types-${asset.id}`} value={asset.type} onChange={(e) => onUpdate({ type: e.target.value })} style={inputStyle} />
              <datalist id={`asset-types-${asset.id}`}>
                {typeOptions.map((t) => (<option key={t} value={t} />))}
              </datalist>
            </div>
            <div>
              <InputLabel label="Status" help="Lifecycle status. Planned, Construction, Operational." inputId={`asset-${asset.id}-status`} />
              <select id={`asset-${asset.id}-status`} data-testid={`asset-${asset.id}-status`} value={status} onChange={(e) => onUpdate({ status: e.target.value as AssetStatus })} style={inputStyle}>
                {ASSET_STATUSES.map((s) => (<option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-1)' }}>
              <label style={{ fontSize: 'var(--font-small)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={asset.visible} data-testid={`asset-${asset.id}-visible`} onChange={(e) => onUpdate({ visible: e.target.checked })} />
                Visible
              </label>
              <button
                type="button"
                onClick={onRemove}
                data-testid={`asset-${asset.id}-remove`}
                style={{ background: 'transparent', border: '1px solid var(--color-negative)', color: 'var(--color-negative)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}
              >
                Delete
              </button>
            </div>
          </div>

          {asset.strategy === 'Sell + Manage' && (
            <ManagementAgreementForm asset={asset} onUpdate={onUpdate} />
          )}
          {(asset.strategy === 'Operate' || asset.strategy === 'Lease') && (
            <UsefulLifeForm asset={asset} onUpdate={onUpdate} />
          )}

          {/* M2.0f Fix 2: Land row (parcel dropdown + sqm/% input + multi-parcel splits)
              + M2.0f Fix 6: Areas row (BUA + breakdown derived from sub-units; GFA optional input). */}
          <div
            style={{
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--sp-2)',
              marginBottom: 'var(--sp-2)',
              background: 'var(--color-grey-pale)',
            }}
            data-testid={`asset-${asset.id}-land-allocation-block`}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)' }}>
              <strong style={{ fontSize: 'var(--font-small)' }}>Land Allocation</strong>
              {landAllocationMode === 'sqm' && (
                <button
                  type="button"
                  onClick={addSplit}
                  data-testid={`asset-${asset.id}-add-parcel-split`}
                  style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '2px 10px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}
                >
                  + Add Parcel Allocation
                </button>
              )}
            </div>

            {(allocation.multiParcelSplits && allocation.multiParcelSplits.length > 0) ? (
              // Multi-parcel split mode: each row picks a parcel + sqm. Land
              // cost computes per-parcel using each parcel's own rate.
              <div data-testid={`asset-${asset.id}-multi-parcel-section`}>
                {allocation.multiParcelSplits.map((sp, idx) => {
                  const parcel = phaseParcels.find((p) => p.id === sp.parcelId);
                  const rate = parcel ? parcel.rate : 0;
                  const value = Math.max(0, sp.sqm) * rate;
                  return (
                    <div
                      key={idx}
                      style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr auto', gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)', alignItems: 'flex-end' }}
                      data-testid={`asset-${asset.id}-split-${idx}`}
                    >
                      <div>
                        <InputLabel label="Parcel" help="Source parcel; allocation uses that parcel's own rate." inputId={`asset-${asset.id}-split-${idx}-parcelId`} />
                        <select
                          id={`asset-${asset.id}-split-${idx}-parcelId`}
                          data-testid={`asset-${asset.id}-split-${idx}-parcelId`}
                          value={sp.parcelId}
                          onChange={(e) => updateSplit(idx, { parcelId: e.target.value })}
                          style={inputStyle}
                        >
                          {phaseParcels.length === 0 && <option value="">(no parcels in phase)</option>}
                          {phaseParcels.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({fmt(p.rate)} {project.currency}/sqm)</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <InputLabel label="Sqm" help="Land area drawn from this parcel." inputId={`asset-${asset.id}-split-${idx}-sqm`} />
                        <input
                          id={`asset-${asset.id}-split-${idx}-sqm`}
                          data-testid={`asset-${asset.id}-split-${idx}-sqm`}
                          type="number"
                          min={0}
                          value={sp.sqm}
                          onChange={(e) => updateSplit(idx, { sqm: Math.max(0, Number(e.target.value) || 0) })}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <InputLabel label="Rate" help="Per-sqm rate of the selected parcel." inputId={`asset-${asset.id}-split-${idx}-rate`} />
                        <div style={calcOutputStyle} data-testid={`asset-${asset.id}-split-${idx}-rate`}>{fmt(rate)}</div>
                      </div>
                      <div>
                        <InputLabel label="Cost" help="sqm x rate for this parcel slice." inputId={`asset-${asset.id}-split-${idx}-cost`} />
                        <div style={calcOutputStyle} data-testid={`asset-${asset.id}-split-${idx}-cost`}>{fmt(value)} {project.currency}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSplit(idx)}
                        data-testid={`asset-${asset.id}-split-${idx}-remove`}
                        style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}
                      >
                        x
                      </button>
                    </div>
                  );
                })}
                <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 'var(--sp-1)' }} data-testid={`asset-${asset.id}-multi-parcel-total`}>
                  Total: <strong>{fmt(landBreakdown.landSqm)} sqm</strong> · weighted rate <strong>{fmt(landBreakdown.rate)} {project.currency}/sqm</strong> · cost <strong>{fmtCurrency(landCost, project.currency, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</strong>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)' }}>
                {landAllocationMode === 'sqm' && (
                  <>
                    <div>
                      <InputLabel label="Parcel" help="Source parcel for this asset's land draw. Default = first parcel; pick (Weighted Average) to use the phase-blended rate or (Custom Rate) to override with a specific value." inputId={`asset-${asset.id}-parcelId`} />
                      <select
                        id={`asset-${asset.id}-parcelId`}
                        data-testid={`asset-${asset.id}-parcelId`}
                        value={allocation.parcelId ?? phaseParcels[0]?.id ?? ''}
                        onChange={(e) => setAllocation({ parcelId: e.target.value || undefined })}
                        style={inputStyle}
                      >
                        {phaseParcels.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({fmt(p.rate)} {project.currency}/sqm)</option>
                        ))}
                        <option value={PARCEL_WEIGHTED_AVG}>(Weighted Average across parcels)</option>
                        <option value={PARCEL_CUSTOM_RATE}>(Custom Rate)</option>
                      </select>
                    </div>
                    <div>
                      <InputLabel label="Land Area (sqm)" help="Direct sqm assigned to this asset from the chosen parcel." inputId={`asset-${asset.id}-landAreaSqm`} />
                      <input id={`asset-${asset.id}-landAreaSqm`} data-testid={`asset-${asset.id}-landAreaSqm`} type="number" min={0} value={allocation.sqm ?? asset.landAreaSqm ?? 0} onChange={(e) => setAllocation({ sqm: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
                    </div>
                    {allocation.parcelId === PARCEL_CUSTOM_RATE ? (
                      <div>
                        <InputLabel label="Custom Rate" help="Per-sqm rate override. Used instead of any parcel's rate." inputId={`asset-${asset.id}-customRate`} />
                        <input id={`asset-${asset.id}-customRate`} data-testid={`asset-${asset.id}-customRate`} type="number" min={0} value={allocation.customRate ?? 0} onChange={(e) => setAllocation({ customRate: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
                      </div>
                    ) : (
                      <div>
                        <InputLabel label="Resolved Rate" help="Picked parcel's rate (or weighted average / custom override)." inputId={`asset-${asset.id}-resolved-rate`} />
                        <div style={calcOutputStyle} data-testid={`asset-${asset.id}-resolved-rate`}>{fmt(landBreakdown.rate)} {project.currency}/sqm</div>
                      </div>
                    )}
                  </>
                )}
                {landAllocationMode === 'percent' && (
                  <div>
                    <InputLabel label="Land Allocation (%)" help="Share of total land value attributed to this asset." inputId={`asset-${asset.id}-landAreaPct`} />
                    <input id={`asset-${asset.id}-landAreaPct`} data-testid={`asset-${asset.id}-landAreaPct`} type="number" min={0} max={100} value={allocation.pct ?? asset.landAreaPct ?? 0} onChange={(e) => setAllocation({ pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} style={inputStyle} />
                  </div>
                )}
                {landAllocationMode === 'autoByBua' && (
                  <div>
                    <InputLabel label="Land (auto by BUA)" help="Auto-allocated land share = this asset's BUA / total project BUA." inputId={`asset-${asset.id}-land-auto`} />
                    <div style={calcOutputStyle} data-testid={`asset-${asset.id}-land-auto`}>{fmt(landBreakdown.landSqm)} sqm</div>
                  </div>
                )}
                <div>
                  <InputLabel label="Land Cost" help="Resolved land area x parcel rate." inputId={`asset-${asset.id}-land-cost-display`} />
                  <div style={calcOutputStyle} data-testid={`asset-${asset.id}-land-cost-display`}>{fmtCurrency(landCost, project.currency, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</div>
                </div>
              </div>
            )}
          </div>

          {/* M2.0h Fix 3 (2026-05-07): three-tier area hierarchy.
              The M2.0g "Asset BUA Total" hand-typed input is removed
              (BUA derives now). Asset card shows:
                Inputs:  Support Area + Parking Area + GFA (optional override)
                Derived: NSA / BUA / GFA chips with the hierarchy formulas
              Sub-units provide NSA; Support is asset-level + sub-unit Support;
              Parking is asset-level only.
              M2.0i Fix 5 (2026-05-07): Parking Bays count input dropped.
              Parking Area (sqm) is the canonical cost driver; if a future
              use case needs a per-bay revenue (parking fee / bay / year),
              model it as a Leasable sub-unit. */}
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}
            data-testid={`asset-${asset.id}-areas-row`}
          >
            <div>
              <InputLabel label="Support Area (sqm)" help="Asset-level Support / back-of-house area. Combined with any Support sub-units to derive BUA = NSA + Support." inputId={`asset-${asset.id}-supportArea`} />
              <input id={`asset-${asset.id}-supportArea`} data-testid={`asset-${asset.id}-supportArea`} type="number" min={0} value={asset.supportArea ?? 0} onChange={(e) => onUpdate({ supportArea: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="Parking Area (sqm)" help="Asset-level Parking area. GFA = BUA + Parking. Cost-only, no revenue." inputId={`asset-${asset.id}-parkingArea`} />
              <input id={`asset-${asset.id}-parkingArea`} data-testid={`asset-${asset.id}-parkingArea`} type="number" min={0} value={asset.parkingArea ?? 0} onChange={(e) => onUpdate({ parkingArea: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
            </div>
            <div>
              <InputLabel label="GFA Override (sqm)" help="Optional GFA override. Leave 0 to use derived BUA + Parking." inputId={`asset-${asset.id}-gfaSqm`} />
              <input id={`asset-${asset.id}-gfaSqm`} data-testid={`asset-${asset.id}-gfaSqm`} type="number" min={0} value={asset.gfaSqm} onChange={(e) => onUpdate({ gfaSqm: Math.max(0, Number(e.target.value) || 0) })} placeholder={`auto = derived`} style={inputStyle} />
            </div>
          </div>

          {/* M2.0h Fix 3: NSA / BUA / GFA hierarchy chips. Read-only
              derived from sub-units + asset-level Support + Parking. */}
          {(() => {
            const hier = computeAssetAreaHierarchy(asset, subUnits);
            const gfaDisplay = asset.gfaSqm > 0 ? asset.gfaSqm : hier.gfa;
            return (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'var(--sp-2)',
                  marginBottom: 'var(--sp-2)',
                }}
                data-testid={`asset-${asset.id}-area-hierarchy`}
              >
                <div style={{ ...calcOutputStyle, padding: 'var(--sp-2)' }}>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>NSA (Net Sellable)</div>
                  <strong style={{ fontSize: 16 }} data-testid={`asset-${asset.id}-nsa`}>{fmt(hier.nsa)} sqm</strong>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>sum of revenue sub-units</div>
                </div>
                <div style={{ ...calcOutputStyle, padding: 'var(--sp-2)' }}>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BUA (Built-Up)</div>
                  <strong style={{ fontSize: 16 }} data-testid={`asset-${asset.id}-bua`}>{fmt(hier.bua)} sqm</strong>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>NSA + Support ({fmt(hier.breakdown.supportArea)})</div>
                </div>
                <div style={{ ...calcOutputStyle, padding: 'var(--sp-2)' }}>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>GFA (Gross Floor)</div>
                  <strong style={{ fontSize: 16 }} data-testid={`asset-${asset.id}-gfa`}>{fmt(gfaDisplay)} sqm</strong>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>BUA + Parking ({fmt(hier.breakdown.parkingArea)})</div>
                </div>
              </div>
            );
          })()}

          {/* M2.0h Fix 3 (2026-05-07): Area Reconciliation block.
              Itemizes the three-tier hierarchy. Per-row click is
              decorative; future surfaces may scroll to source field. */}
          <div
            style={{
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--sp-2)',
              marginBottom: 'var(--sp-2)',
              fontSize: 11,
            }}
            data-testid={`asset-${asset.id}-area-reconciliation`}
          >
            <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Area Reconciliation</strong>
            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 4 }}>
              <div style={{ gridColumn: '1 / span 2', color: 'var(--color-meta)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em', marginTop: 2 }}>
                Sub-units (revenue-generating):
              </div>
              {assetSubUnits.filter((u) => u.category !== 'Support').map((u) => (
                <React.Fragment key={u.id}>
                  <div style={{ paddingLeft: 12 }}>{u.name || 'Sub-unit'} ({u.category}):</div>
                  <div style={{ textAlign: 'right' }}>{fmt(computeSubUnitArea(u))} sqm</div>
                </React.Fragment>
              ))}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4, paddingLeft: 12, fontWeight: 700 }}>NSA (Net Sellable)</div>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4, textAlign: 'right', fontWeight: 700 }} data-testid={`asset-${asset.id}-recon-nsa`}>{fmt(derivedSellable)} sqm</div>

              {(supportSum > 0 || (asset.supportArea ?? 0) > 0) && (
                <>
                  <div style={{ paddingTop: 4 }}>Sub-unit Support:</div>
                  <div style={{ paddingTop: 4, textAlign: 'right' }}>{fmt(supportSum)} sqm</div>
                  <div>Asset Support Area:</div>
                  <div style={{ textAlign: 'right' }}>{fmt(Math.max(0, asset.supportArea ?? 0))} sqm</div>
                </>
              )}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4, fontWeight: 700 }}>BUA (NSA + Support)</div>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4, textAlign: 'right', fontWeight: 700 }} data-testid={`asset-${asset.id}-recon-bua`}>
                {fmt(derivedSellable + supportSum + Math.max(0, asset.supportArea ?? 0))} sqm
              </div>

              {parkingSum > 0 && (
                <>
                  <div style={{ paddingTop: 4 }}>Asset Parking Area:</div>
                  <div style={{ paddingTop: 4, textAlign: 'right' }}>{fmt(parkingSum)} sqm</div>
                </>
              )}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4, fontWeight: 700 }}>GFA (BUA + Parking)</div>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4, textAlign: 'right', fontWeight: 700 }} data-testid={`asset-${asset.id}-recon-gfa`}>
                {fmt(derivedSellable + supportSum + Math.max(0, asset.supportArea ?? 0) + parkingSum)} sqm
              </div>

              <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid var(--color-border)', color: 'var(--color-meta)' }}>Land allocation:</div>
              <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid var(--color-border)', textAlign: 'right', color: 'var(--color-meta)' }}>
                {fmt(landBreakdown.landSqm)} sqm
              </div>
              <div style={{ color: 'var(--color-meta)' }}>Land cost:</div>
              <div style={{ textAlign: 'right', color: 'var(--color-meta)' }} data-testid={`asset-${asset.id}-recon-land-cost`}>{fmtCurrency(landCost, project.currency, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</div>
            </div>
          </div>

          {/* Sub-unit table */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)' }}>
              <strong style={{ fontSize: 'var(--font-small)' }}>Sub-units</strong>
              <button
                type="button"
                onClick={handleAddSubUnit}
                data-testid={`asset-${asset.id}-add-subunit`}
                style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '2px 10px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}
              >
                + Sub-unit
              </button>
            </div>
            {assetSubUnits.length === 0 ? (
              <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', padding: 'var(--sp-1)' }}>
                No sub-units yet. Add at least one so revenue (Module 2) can attach.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'var(--color-grey-pale)' }}>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Category</th>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Metric</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Area (sqm)</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Unit Size (sqm)</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Count</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Rate</th>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Rate Unit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {assetSubUnits.map((u) => (
                    <SubUnitRow
                      key={u.id}
                      subUnit={u}
                      currency={project.currency}
                      onUpdate={(patch) => updateSubUnit(u.id, patch)}
                      onRemove={() => removeSubUnit(u.id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* M2.0h Fix 3: footer summary uses the three-tier hierarchy. */}
          {(() => {
            const hier = computeAssetAreaHierarchy(asset, subUnits);
            const eff = hier.bua > 0 ? (hier.nsa / hier.bua) * 100 : 0;
            return (
              <div
                style={{
                  marginTop: 'var(--sp-2)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 'var(--sp-2)',
                  fontSize: 'var(--font-small)',
                  padding: 'var(--sp-1) 0',
                  borderTop: '1px solid var(--color-border)',
                }}
                data-testid={`asset-card-${asset.id}-footer`}
              >
                <div data-testid={`asset-${asset.id}-derived-bua`}>
                  <span style={{ color: 'var(--color-meta)' }}>BUA: </span>
                  <strong>{fmt(hier.bua)} sqm</strong>
                </div>
                <div data-testid={`asset-${asset.id}-derived-sellable`}>
                  <span style={{ color: 'var(--color-meta)' }}>NSA: </span>
                  <strong>{fmt(hier.nsa)} sqm</strong>
                </div>
                <div data-testid={`asset-${asset.id}-efficiency`}>
                  <span style={{ color: 'var(--color-meta)' }}>Efficiency: </span>
                  <strong>{hier.bua > 0 ? `${fmt(eff, 1)}%` : 'n/a'}</strong>
                </div>
                <div data-testid={`asset-${asset.id}-land-cost`}>
                  <span style={{ color: 'var(--color-meta)' }}>Land cost: </span>
                  <strong>{fmtCurrency(landCost, project.currency, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</strong>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

// ── Sub-unit row (M2.0e: renamed columns) ─────────────────────────────────
interface SubUnitRowProps {
  subUnit: SubUnit;
  currency: string;
  onUpdate: (patch: Partial<SubUnit>) => void;
  onRemove: () => void;
}

function SubUnitRow({ subUnit, currency, onUpdate, onRemove }: SubUnitRowProps): React.JSX.Element {
  const totalArea = computeSubUnitArea(subUnit);
  const isCount = subUnit.metric === 'count';
  const rateUnit = rateUnitLabel(subUnit.category, subUnit.metric);
  return (
    <tr data-testid={`subunit-row-${subUnit.id}`}>
      <td style={{ padding: '4px 6px' }}>
        <input type="text" value={subUnit.name} data-testid={`subunit-${subUnit.id}-name`} onChange={(e) => onUpdate({ name: e.target.value })} style={{ ...inputStyle, fontSize: 11 }} placeholder="1BR, Hotel Twin..." />
      </td>
      <td style={{ padding: '4px 6px' }}>
        <select value={subUnit.category} data-testid={`subunit-${subUnit.id}-category`} onChange={(e) => onUpdate({ category: e.target.value as SubUnitCategory })} style={{ ...inputStyle, fontSize: 11 }}>
          {SUB_UNIT_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </td>
      <td style={{ padding: '4px 6px' }}>
        <select value={subUnit.metric} data-testid={`subunit-${subUnit.id}-metric`} onChange={(e) => onUpdate({ metric: e.target.value as SubUnitMetric })} style={{ ...inputStyle, fontSize: 11 }}>
          <option value="count">count</option>
          <option value="area">area</option>
        </select>
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {isCount ? (
          <span style={{ ...calcOutputStyle, fontSize: 11 }} data-testid={`subunit-${subUnit.id}-area-derived`}>{fmt(totalArea)}</span>
        ) : (
          <input type="number" min={0} value={subUnit.metricValue} data-testid={`subunit-${subUnit.id}-area-input`} onChange={(e) => onUpdate({ metricValue: Math.max(0, Number(e.target.value) || 0) })} style={{ ...inputStyle, fontSize: 11 }} />
        )}
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        <input type="number" min={0} value={subUnit.unitArea ?? 0} data-testid={`subunit-${subUnit.id}-unitArea`} onChange={(e) => onUpdate({ unitArea: Math.max(0, Number(e.target.value) || 0) })} style={{ ...inputStyle, fontSize: 11 }} disabled={!isCount} />
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {isCount ? (
          <input type="number" min={0} value={subUnit.metricValue} data-testid={`subunit-${subUnit.id}-count`} onChange={(e) => onUpdate({ metricValue: Math.max(0, Number(e.target.value) || 0) })} style={{ ...inputStyle, fontSize: 11 }} />
        ) : (
          <span style={{ ...calcOutputStyle, fontSize: 11 }}>n/a</span>
        )}
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        <input type="number" min={0} value={subUnit.unitPrice} data-testid={`subunit-${subUnit.id}-rate`} onChange={(e) => onUpdate({ unitPrice: Math.max(0, Number(e.target.value) || 0) })} style={{ ...inputStyle, fontSize: 11 }} />
      </td>
      <td style={{ padding: '4px 6px', fontSize: 10, color: 'var(--color-meta)' }} data-testid={`subunit-${subUnit.id}-rate-unit`}>
        {rateUnit ? `${currency} ${rateUnit}` : ''}
      </td>
      <td style={{ padding: '4px 6px' }}>
        <button type="button" onClick={onRemove} data-testid={`subunit-${subUnit.id}-remove`} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}>x</button>
      </td>
    </tr>
  );
}

// ── ManagementAgreementForm (M2.0d) ───────────────────────────────────────
interface ManagementAgreementFormProps {
  asset: Asset;
  onUpdate: (patch: Partial<Asset>) => void;
}

function ManagementAgreementForm({ asset, onUpdate }: ManagementAgreementFormProps): React.JSX.Element {
  const ag = asset.managementAgreement ?? DEFAULT_MANAGEMENT_AGREEMENT;
  const setAg = (patch: Partial<ManagementAgreement>): void => {
    onUpdate({ managementAgreement: { ...ag, ...patch } });
  };
  return (
    <div
      style={{
        border: '1px solid var(--color-navy)',
        background: 'var(--color-navy-pale)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-2)',
      }}
      data-testid={`asset-${asset.id}-mgmt-agreement`}
    >
      <strong style={{ fontSize: 'var(--font-small)', display: 'block', marginBottom: 'var(--sp-1)' }}>Management Agreement, Sell + Manage</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)' }}>
        <div>
          <InputLabel label="Management Fee %" help="Share of operating revenue accruing to the developer post-handover." inputId={`asset-${asset.id}-mgmt-fee`} />
          <input id={`asset-${asset.id}-mgmt-fee`} data-testid={`asset-${asset.id}-mgmt-fee`} type="number" min={0} max={100} value={ag.managementFeePct} onChange={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); setAg({ managementFeePct: v, ownerRevenueSharePct: 100 - v }); }} style={inputStyle} />
        </div>
        <div>
          <InputLabel label="Owner Share %" help="Share to unit owners. Auto = 100 minus fee." inputId={`asset-${asset.id}-mgmt-owner-share`} />
          <input id={`asset-${asset.id}-mgmt-owner-share`} data-testid={`asset-${asset.id}-mgmt-owner-share`} type="number" min={0} max={100} value={ag.ownerRevenueSharePct} onChange={(e) => setAg({ ownerRevenueSharePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} style={inputStyle} />
        </div>
        <div>
          <InputLabel label="Start Period" help="Optional. Default = handover (sales schedule end)." inputId={`asset-${asset.id}-mgmt-start`} />
          <input id={`asset-${asset.id}-mgmt-start`} data-testid={`asset-${asset.id}-mgmt-start`} type="number" min={0} value={ag.agreementStartPeriod ?? 0} onChange={(e) => { const v = Number(e.target.value); setAg({ agreementStartPeriod: v > 0 ? v : undefined }); }} style={inputStyle} />
        </div>
        <div>
          <InputLabel label="Duration (periods)" help="Optional. Blank = perpetual." inputId={`asset-${asset.id}-mgmt-duration`} />
          <input id={`asset-${asset.id}-mgmt-duration`} data-testid={`asset-${asset.id}-mgmt-duration`} type="number" min={0} value={ag.agreementDurationPeriods ?? 0} onChange={(e) => { const v = Number(e.target.value); setAg({ agreementDurationPeriods: v > 0 ? v : undefined }); }} style={inputStyle} />
        </div>
      </div>
    </div>
  );
}

// ── UsefulLifeForm (M2.0d) ────────────────────────────────────────────────
interface UsefulLifeFormProps {
  asset: Asset;
  onUpdate: (patch: Partial<Asset>) => void;
}

function UsefulLifeForm({ asset, onUpdate }: UsefulLifeFormProps): React.JSX.Element {
  const resolved = resolveUsefulLifeYears(asset);
  const explicit = asset.usefulLifeYears && asset.usefulLifeYears > 0;
  const fallback = asset.strategy === 'Operate' ? DEFAULT_USEFUL_LIFE_YEARS.hospitality
                  : asset.strategy === 'Lease'   ? DEFAULT_USEFUL_LIFE_YEARS.retail
                  : DEFAULT_USEFUL_LIFE_YEARS.default;
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        background: 'var(--color-grey-pale)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-2)',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--sp-2)',
        alignItems: 'flex-end',
      }}
      data-testid={`asset-${asset.id}-useful-life`}
    >
      <div>
        <InputLabel label="Useful Life (years)" help="Depreciation horizon. Blank = category default. Land never depreciates." inputId={`asset-${asset.id}-useful-life-input`} />
        <input id={`asset-${asset.id}-useful-life-input`} data-testid={`asset-${asset.id}-useful-life-input`} type="number" min={0} value={asset.usefulLifeYears ?? 0} onChange={(e) => { const v = Number(e.target.value); onUpdate({ usefulLifeYears: v > 0 ? v : undefined }); }} placeholder={`default ${fallback}`} style={inputStyle} />
      </div>
      <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}>
        <strong>Resolved:</strong> {resolved} years{!explicit && (<span style={{ display: 'block', marginTop: 2 }}>(category default)</span>)}
      </div>
    </div>
  );
}
