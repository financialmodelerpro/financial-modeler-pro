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

import React, { useEffect, useMemo, useState } from 'react';
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
  computeAssetLandSqm,
  computeLandAggregate,
  computeLandReconciliation,
  computeOperatingEndDate,
  computeParcelNda,
  computeSubUnitArea,
  computePhaseTimeline,
  formatOperatingEndDate,
  resolveAssetAreaMetrics,
  resolveUsefulLifeYears,
  validateLandAllocation,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatArea, formatScaled, formatScaledCurrency, formatAccounting } from '@/src/core/formatters';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import InputLabel from '../ui/InputLabel';
import { CELL_HEADER } from './_shared/tableStyles';

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

// Universal table header alignment standard (2026-05-13): route Tab 2
// Land Parcels (+ asset sub-unit tables) headers through the shared
// CELL_HEADER token so every header column is centered horizontally +
// vertically.
const tableHeaderStyle: React.CSSProperties = CELL_HEADER;

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
): string => formatAccounting(n, scale, decimals);
const fmtCurrencyWithCode = (
  n: number,
  currency: string,
  scale: import('../../lib/state/module1-types').DisplayScale = 'full',
  decimals: import('../../lib/state/module1-types').DisplayDecimals = 2,
): string => formatScaledCurrency(n, currency, scale, decimals);

// M2.0e: short strategy labels for the dropdown (M2.0i Fix 7
// 2026-05-07: dropped the verbose descriptions; long-form details
// surface as title-attribute hover tooltips via STRATEGY_TOOLTIPS).
const STRATEGY_LABELS: Record<AssetStrategy, string> = {
  'Sell':          'Sell',
  'Operate':       'Operate',
  'Lease':         'Lease',
  'Sell + Manage': 'Sell + Manage',
};

// M2.0i Fix 7 (2026-05-07): hover tooltip text per strategy.
const STRATEGY_TOOLTIPS: Record<AssetStrategy, string> = {
  'Sell':          'Build and sell units to investors (residential apartments, villa compounds).',
  'Operate':       'Build, retain, and operate (hotel ownership, hospitality).',
  'Lease':         'Build, retain, and lease (retail mall, office tower).',
  'Sell + Manage': 'Sell to investors, retain operating rights via management agreement (branded residences with hotel operator).',
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
  if (category === 'Sellable') return metric === 'units' ? 'per unit' : 'per sqm';
  if (category === 'Operable') return metric === 'units' ? 'per room/night' : 'per sqm/year';
  if (category === 'Leasable') return metric === 'units' ? 'per unit/year' : 'per sqm/year';
  return '';
}

// M2.0M Pass 6 Fix 1 (2026-05-11): per-row count-unit label rendered
// as a caption beneath the Count cell. Category + asset strategy +
// (optional) asset type drive the label so a hospitality Operable
// row reads "keys", a healthcare Operable row reads "beds", parking
// reads "bays", etc. Falls back to "units" for anything unmapped.
function countUnitLabel(
  category: SubUnitCategory,
  strategy: AssetStrategy,
  assetType?: string,
): string {
  if (category === 'Support') return 'items';
  if (category === 'Sellable') return 'units';
  if (category === 'Operable') {
    const t = (assetType ?? '').toLowerCase();
    if (t.includes('hospital') || t.includes('clinic') || t.includes('care') || t.includes('medical')) {
      return 'beds';
    }
    if (strategy === 'Operate' || strategy === 'Sell + Manage') {
      return 'keys';
    }
    return 'units';
  }
  if (category === 'Leasable') return 'tenants';
  return 'units';
}

// Type catalog for the asset Type dropdown. Project.projectType wins
// when set; otherwise falls back to strategy-keyed catalog.
//
// M2.0j Fix 2: Mixed-Use and Custom return the UNION of all per-category
// catalogs (deduped) so users on a Mixed-Use project can pick any asset
// type from any sector. Specific project types still filter to their
// own catalog.
function resolveTypeCatalog(asset: Asset, project: Project): readonly string[] {
  const pt = project.projectType;
  if (pt === 'Mixed-Use' || pt === 'Custom') {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const cat of Object.values(ASSET_TYPES_BY_PROJECT_TYPE)) {
      for (const t of cat) {
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
    }
    return out;
  }
  if (pt && ASSET_TYPES_BY_PROJECT_TYPE[pt]) {
    return ASSET_TYPES_BY_PROJECT_TYPE[pt];
  }
  return ASSET_TYPES_BY_STRATEGY[asset.strategy];
}

// ── Module1Assets root ────────────────────────────────────────────────────
export default function Module1Assets(): React.JSX.Element {
  const {
    project,
    setProject,
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
      setProject: s.setProject,
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
      // M2.0j Fix 2: default to empty string. Type is optional and the
      // user can leave it blank or pick / type any value.
      type: '',
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

      {/* Land Parcels block */}
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
        {/* P7-Fix 1 (2026-05-11): per-parcel NDA columns dropped. The
            project-level NDA summary block below the totals row owns
            this surface now (single Apply NDA + Roads% + Parks% inputs
            with explicit Gross / Net derivation). Schema fields
            (parcel.hasNdaDeduction / parcel.roadsPct / parcel.parksPct)
            retained for back-compat with legacy snapshots but no
            longer surfaced in the inputs UI. */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="parcels-table">
          <thead>
            <tr>
              <th style={tableHeaderStyle}><InputLabel label="Parcel Name" help="Free-text label." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Area (sqm)" help="Land area for this parcel." textStyle={tableHeaderLabelStyle} /></th>
              {/* M2.0j Fix 3: Header is just `{currency}/sqm`. Tooltip explains the rate model. */}
              <th style={tableHeaderStyle}><InputLabel label={`${project.currency}/sqm`} help="Per-sqm acquisition cost. Total parcel cost = Area x Rate. Asset land cost = asset's allocated sqm x parcel's rate (or weighted average / custom override at the asset level)." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="Cash %" help="Share paid in cash. Cash + In-kind = 100." textStyle={tableHeaderLabelStyle} /></th>
              <th style={tableHeaderStyle}><InputLabel label="In-Kind %" help="Share paid in-kind (equity from landowner)." textStyle={tableHeaderLabelStyle} /></th>
              {/* P7-Fix 1: per-parcel NDA / Roads % / Parks % / NDA (sqm) / {currency}/NDA sqm columns removed; project-level NDA card below owns this. */}
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
                scale={project.displayScale ?? 'full'}
                decimals={project.displayDecimals ?? 2}
              />
            ))}
          </tbody>
          <tfoot>
            {/* M2.0j Fix 5: totals row uses formatArea for sqm and
                formatScaled (project displayScale + displayDecimals) for
                rate / monetary cells. */}
            <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 'var(--fw-bold)' }}>
              <td style={{ padding: 'var(--sp-1)' }}>Totals</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-area">{formatArea(aggregate.totalAreaSqm, project.displayDecimals ?? 2)} sqm</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-weighted-rate">{formatAccounting(aggregate.weightedRate, project.displayScale ?? 'full', project.displayDecimals ?? 2)} /sqm</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-cash-value">{formatAccounting(aggregate.cashValue, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-inkind-value">{formatAccounting(aggregate.inKindValue, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-value">{formatAccounting(aggregate.totalValue, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        {/* P8-Fix 1 (2026-05-12): NDA card with scope toggle. Replaces
            Pass 7's project-only NDA card. Scope = 'project' (single
            project-level Roads%/Parks% applied to total land) or 'asset'
            (each asset card carries its own Roads%/Parks%). Land COST
            always stays on gross land; NDA reduces only the developable
            area consumed by rate_per_nda / development-capacity calcs.
            Light-amber background per brief makes the deduction
            distinction obvious. */}
        {(() => {
          const ndaEnabled = project.projectNdaEnabled === true;
          const scope = project.projectNdaScope ?? 'project';
          const roadsPct = Math.max(0, Math.min(100, project.projectRoadsPct ?? 0));
          const parksPct = Math.max(0, Math.min(100, project.projectParksPct ?? 0));
          const totalDeductPct = Math.min(100, roadsPct + parksPct);
          const totalLand = aggregate.totalAreaSqm;
          const grossNda = totalLand * (1 - totalDeductPct / 100);
          const netNda = grossNda;
          const projectMode = scope === 'project';
          return (
            <div
              style={{
                marginTop: 'var(--sp-2)',
                padding: 'var(--sp-2)',
                background: 'color-mix(in srgb, var(--color-accent-warm) 8%, transparent)',
                border: '1px solid var(--color-accent-warm)',
                borderRadius: 'var(--radius-sm)',
              }}
              data-testid="parcels-nda-summary"
            >
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Net Developable Area (NDA)
              </strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 6 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }} data-testid="parcels-nda-toggle-label">
                  <input
                    type="checkbox"
                    data-testid="parcels-nda-enabled"
                    checked={ndaEnabled}
                    onChange={(e) => setProject({ projectNdaEnabled: e.target.checked })}
                  />
                  Apply Roads/Parks Deduction
                </label>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }} data-testid="parcels-nda-scope">
                  <span style={{ color: 'var(--color-meta)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}>Scope:</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: ndaEnabled ? 'pointer' : 'not-allowed', opacity: ndaEnabled ? 1 : 0.5 }}>
                    <input
                      type="radio"
                      name="nda-scope"
                      value="project"
                      data-testid="parcels-nda-scope-project"
                      checked={projectMode}
                      disabled={!ndaEnabled}
                      onChange={() => setProject({ projectNdaScope: 'project' })}
                    />
                    Project-level
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: ndaEnabled ? 'pointer' : 'not-allowed', opacity: ndaEnabled ? 1 : 0.5 }}>
                    <input
                      type="radio"
                      name="nda-scope"
                      value="asset"
                      data-testid="parcels-nda-scope-asset"
                      checked={!projectMode}
                      disabled={!ndaEnabled}
                      onChange={() => setProject({ projectNdaScope: 'asset' })}
                    />
                    Per-Asset
                  </label>
                </div>
              </div>
              {projectMode && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Roads %:
                      <input
                        type="number" min={0} max={100} step={0.5}
                        data-testid="parcels-nda-roads-pct"
                        value={roadsPct}
                        onChange={(e) => setProject({ projectRoadsPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                        disabled={!ndaEnabled}
                        style={{ ...inputStyle, width: 80, opacity: ndaEnabled ? 1 : 0.6 }}
                      />
                    </label>
                    <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Parks %:
                      <input
                        type="number" min={0} max={100} step={0.5}
                        data-testid="parcels-nda-parks-pct"
                        value={parksPct}
                        onChange={(e) => setProject({ projectParksPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                        disabled={!ndaEnabled}
                        style={{ ...inputStyle, width: 80, opacity: ndaEnabled ? 1 : 0.6 }}
                      />
                    </label>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', display: 'grid', gap: 4 }} data-testid="parcels-nda-derivation">
                    <div>Gross Land: <strong style={{ color: 'var(--color-body)' }}>{formatArea(totalLand, project.displayDecimals ?? 2)} sqm</strong></div>
                    <div>Less Roads: <strong style={{ color: 'var(--color-body)' }}>{formatArea(totalLand * (roadsPct / 100), project.displayDecimals ?? 2)} sqm</strong> ({roadsPct.toFixed(1)}%)</div>
                    <div>Less Parks: <strong style={{ color: 'var(--color-body)' }}>{formatArea(totalLand * (parksPct / 100), project.displayDecimals ?? 2)} sqm</strong> ({parksPct.toFixed(1)}%)</div>
                    <div data-testid="parcels-nda-net">Net Developable: <strong style={{ color: 'var(--color-body)' }}>{formatArea(netNda, project.displayDecimals ?? 2)} sqm</strong></div>
                    <div data-testid="parcels-nda-gross" style={{ fontStyle: 'italic', marginTop: 4 }}>
                      Asset land allocation uses Net Developable Land. Land COST stays on gross land (purchase price unchanged).
                    </div>
                  </div>
                </>
              )}
              {!projectMode && ndaEnabled && (
                <div style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid="parcels-nda-per-asset-note">
                  Per-Asset mode: each asset card below carries its own Roads % + Parks % + Apply Roads/Parks toggle. Project-level inputs disabled while scope = Per-Asset.
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* M2.0g Fix 2 + M2.0h Fix 4 + M2.0i Fix 9: Land Reconciliation
          block. Collapsed by default (single summary line). Expand
          reveals the full grid. Auto-expands on mismatch.
          localStorage persistence keyed on `m20i-land-recon-collapsed`. */}
      <LandReconciliationBlock
        landReconciliation={landReconciliation}
        parcels={parcels}
        currency={project.currency}
        scale={project.displayScale ?? 'full'}
        decimals={project.displayDecimals ?? 2}
        projectNdaEnabled={project.projectNdaEnabled === true}
        projectRoadsPct={Math.max(0, Math.min(100, project.projectRoadsPct ?? 0))}
        projectParksPct={Math.max(0, Math.min(100, project.projectParksPct ?? 0))}
        assets={assets}
        phases={phases}
        assetLandSqmByAssetId={(() => {
          const map = new Map<string, number>();
          for (const a of assets) {
            if (!a.visible) continue;
            const phaseAssets = assets.filter((x) => x.phaseId === a.phaseId && x.visible);
            const sqm = computeAssetLandSqm(a, parcels, phaseAssets, subUnits, landAllocationMode);
            map.set(a.id, sqm);
          }
          return map;
        })()}
        // P10-Fix 5 (2026-05-12): per-asset land VALUE map for the
        // Asset Land Cost column in the NDA recon table.
        assetLandValueByAssetId={(() => {
          const map = new Map<string, number>();
          for (const a of assets) {
            if (!a.visible) continue;
            const phaseAssets = assets.filter((x) => x.phaseId === a.phaseId && x.visible);
            const bd = computeAssetLandBreakdown(a, parcels, phaseAssets, subUnits, landAllocationMode);
            map.set(a.id, bd.landValue);
          }
          return map;
        })()}
        // T3-edit-runtime v7 (2026-05-13): per-asset Cash + In-Kind
        // value maps. resolveAssetAreaMetrics is the single source of
        // truth shared with Tab 3 Land cost lines.
        assetCashValueByAssetId={(() => {
          const map = new Map<string, number>();
          for (const a of assets) {
            if (!a.visible || a.isCompanion === true) continue;
            const phaseAssets = assets.filter((x) => x.phaseId === a.phaseId && x.visible);
            const m = resolveAssetAreaMetrics(a, project, parcels, phaseAssets, subUnits, landAllocationMode);
            map.set(a.id, m.cashLandValue);
          }
          return map;
        })()}
        assetInKindValueByAssetId={(() => {
          const map = new Map<string, number>();
          for (const a of assets) {
            if (!a.visible || a.isCompanion === true) continue;
            const phaseAssets = assets.filter((x) => x.phaseId === a.phaseId && x.visible);
            const m = resolveAssetAreaMetrics(a, project, parcels, phaseAssets, subUnits, landAllocationMode);
            map.set(a.id, m.inKindLandValue);
          }
          return map;
        })()}
        totalCashValue={parcels.reduce((s, p) => s + Math.max(0, p.area) * Math.max(0, p.rate) * (Math.max(0, p.cashPct) / 100), 0)}
        totalInKindValue={parcels.reduce((s, p) => s + Math.max(0, p.area) * Math.max(0, p.rate) * (Math.max(0, p.inKindPct) / 100), 0)}
      />

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

      {/* P10-Fix 6 (2026-05-12): Tab 2 Expand all / Collapse all bulk
          toggles. Rewrites localStorage for every visible phase + asset
          card then dispatches m20-tab2-collapse-bulk so each section's
          listener re-reads its key. Mirrors the per-section pattern in
          Tab 3 Costs (Pass 9 Fix 6 broadcast m20-cost-row-collapse-bulk). */}
      <div
        style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' }}
        data-testid="assets-collapse-bulk"
      >
        <button
          type="button"
          onClick={() => {
            try {
              phases.forEach((p) => window.localStorage.setItem(`m20-phase-collapsed-${p.id}`, 'false'));
              assets.forEach((a) => window.localStorage.setItem(`m20-asset-collapsed-${a.id}`, 'false'));
              window.dispatchEvent(new Event('m20-tab2-collapse-bulk'));
            } catch { /* noop */ }
          }}
          style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
          data-testid="assets-expand-all"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              phases.forEach((p) => window.localStorage.setItem(`m20-phase-collapsed-${p.id}`, 'true'));
              assets.forEach((a) => window.localStorage.setItem(`m20-asset-collapsed-${a.id}`, 'true'));
              window.dispatchEvent(new Event('m20-tab2-collapse-bulk'));
            } catch { /* noop */ }
          }}
          style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
          data-testid="assets-collapse-all"
        >
          Collapse all
        </button>
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
  // M2.0j Fix 5: thread project display preferences so the parcel rate,
  // NDA, total value cells respect Display Scale + Decimals.
  scale: import('../../lib/state/module1-types').DisplayScale;
  decimals: import('../../lib/state/module1-types').DisplayDecimals;
}

function ParcelRow({ parcel, onUpdate, onRemove, canRemove, scale, decimals }: ParcelRowProps): React.JSX.Element {
  const total = parcel.area * parcel.rate;
  // P7-Fix 1: per-parcel NDA cells removed; project-level NDA card owns this surface now.
  return (
    <tr data-testid={`parcel-row-${parcel.id}`}>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input type="text" value={parcel.name} data-testid={`parcel-${parcel.id}-name`} onChange={(e) => onUpdate({ name: e.target.value })} style={inputStyle} />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        {/* P10-Fix 8 (2026-05-12): accounting format on blur. Parcel
            area is sqm; large enough that thousand separators help. */}
        <AccountingNumberInput
          value={parcel.area}
          onChange={(n) => onUpdate({ area: Math.max(0, n) })}
          scale="full"
          decimals={0}
          min={0}
          style={inputStyle}
          data-testid={`parcel-${parcel.id}-area`}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        {/* M2.0j Fix 7: accounting format on blur. Raw number on focus.
            Rate is per sqm; usually small enough we keep scale='full'
            so 500/sqm doesn't display as 0.50 K. */}
        <AccountingNumberInput
          value={parcel.rate}
          onChange={(n) => onUpdate({ rate: Math.max(0, n) })}
          scale="full"
          decimals={decimals}
          min={0}
          style={inputStyle}
          data-testid={`parcel-${parcel.id}-rate`}
        />
        {/* M2.0j Fix 5: rate respects Display Scale + Decimals (informational caption when scaled). */}
        {scale !== 'full' && (
          <div style={{ fontSize: 10, color: 'var(--color-meta)', textAlign: 'right' }} data-testid={`parcel-${parcel.id}-rate-fmt`}>{formatAccounting(parcel.rate, scale, decimals)}</div>
        )}
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
      {/* P7-Fix 1: NDA checkbox + Roads % + Parks % + NDA (sqm) +
          effective NDA rate cells dropped. The project-level NDA card
          below the parcels totals row owns these inputs now. */}
      <td style={{ padding: 'var(--sp-1)', color: 'var(--color-heading)' }} data-testid={`parcel-${parcel.id}-total`}>{formatAccounting(total, scale, decimals)}</td>
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
  // P10-Fix 6 (2026-05-12): default-collapsed + localStorage persistence
  // + bulk event listener. Tab 2 phase headers collapse by default so
  // the user opens what they want to work on (clean default view per
  // Pass 10 brief). Bulk event m20-tab2-collapse-bulk lets the top-of-
  // tab Expand all / Collapse all buttons toggle every phase+asset card
  // simultaneously by rewriting localStorage and dispatching the event.
  const collapseKey = `m20-phase-collapsed-${phase.id}`;
  const readCollapsed = (): boolean => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem(collapseKey);
      return stored === null ? true : stored === 'true';
    } catch { return true; }
  };
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  useEffect(() => {
    try { window.localStorage.setItem(collapseKey, String(collapsed)); } catch { /* noop */ }
  }, [collapsed, collapseKey]);
  useEffect(() => {
    const handler = (): void => setCollapsed(readCollapsed());
    window.addEventListener('m20-tab2-collapse-bulk', handler);
    return () => window.removeEventListener('m20-tab2-collapse-bulk', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);
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
  // P10-Fix 6 (2026-05-12): default-collapsed + localStorage persistence
  // + bulk event listener (m20-tab2-collapse-bulk). Each asset card opens
  // only when the user explicitly clicks the chevron. Reduces visual
  // noise on first load of multi-asset projects.
  const collapseKey = `m20-asset-collapsed-${asset.id}`;
  const readCollapsed = (): boolean => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem(collapseKey);
      return stored === null ? true : stored === 'true';
    } catch { return true; }
  };
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  useEffect(() => {
    try { window.localStorage.setItem(collapseKey, String(collapsed)); } catch { /* noop */ }
  }, [collapsed, collapseKey]);
  useEffect(() => {
    const handler = (): void => setCollapsed(readCollapsed());
    window.addEventListener('m20-tab2-collapse-bulk', handler);
    return () => window.removeEventListener('m20-tab2-collapse-bulk', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);
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
      metric: asset.strategy === 'Lease' ? 'area' : 'units',
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
                title={STRATEGY_TOOLTIPS[asset.strategy]}
              >
                {ASSET_STRATEGIES.map((s) => (
                  <option key={s} value={s} title={STRATEGY_TOOLTIPS[s]}>{STRATEGY_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              {/* M2.0j Fix 2: Type is OPTIONAL. Field accepts free text;
                  datalist suggestions cover the project type's catalog
                  (Mixed-Use / Custom show the union of every catalog).
                  Type drives the Useful Life default suggestion only. */}
              <InputLabel label="Type (optional)" help={`Optional asset type. Suggestions filtered by Project Type (${project.projectType ?? 'Mixed-Use'}); free-text any other value or leave blank. Drives Useful Life default only.`} inputId={`asset-${asset.id}-type`} />
              <input id={`asset-${asset.id}-type`} data-testid={`asset-${asset.id}-type`} type="text" list={`asset-types-${asset.id}`} value={asset.type ?? ''} placeholder="e.g. Tower, Branded Apartments, Hotel..." onChange={(e) => onUpdate({ type: e.target.value })} style={inputStyle} />
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

          {/* P10-Fix 4 (2026-05-12): ManagementAgreementForm hidden.
              Sell + Manage now auto-creates a companion Operate asset
              that captures the hospitality role. Management fee +
              owner share fields stay on schema (asset.managementAgreement)
              for back-compat but no longer render. Companion's
              hospitality params (occupancy / indexation / days) land
              in M2.1 Revenue. */}
          {/* T2P3 Fix 3 (2026-05-12) + T2P3-followup (2026-05-12):
              Universal Operating End Date. Every asset, regardless of
              strategy (Sell, Operate, Lease, Sell + Manage, plus the
              Operate companion), surfaces the same chip sourced from
              the parent phase. For Sell strategy the date reads as the
              post-handover horizon (when phase operations end);
              for Lease it's the lease-term end from phase setup;
              for Operate it's the hospitality operations end; for
              Support / mixed assets it's the same phase operations
              end. The M5 implementer reads
              `computeOperatingEndDate(asset, phase)` for terminal
              valuation regardless of strategy. UsefulLifeForm is
              retired entirely (depreciation horizon collapses into
              the same phase-driven end-date now). */}
          {(() => {
            const phase = allPhases.find((p) => p.id === asset.phaseId);
            const endDate = computeOperatingEndDate(asset, phase);
            const display = formatOperatingEndDate(endDate);
            return (
              <div
                data-testid={`asset-${asset.id}-operating-end-date`}
                style={{
                  background: 'var(--color-grey-pale)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--sp-1) var(--sp-2)',
                  marginBottom: 'var(--sp-2)',
                  fontSize: 'var(--font-small)',
                  color: 'var(--color-body)',
                }}
              >
                <strong>Operating End:</strong>{' '}
                <span data-testid={`asset-${asset.id}-operating-end-date-value`}>{display}</span>
                <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginTop: 2 }}>
                  Operating end date from Phase Setup. Edit phase operating period to change.
                </div>
              </div>
            );
          })()}
          {asset.isCompanion && (
            <div
              data-testid={`asset-${asset.id}-companion-badge`}
              style={{
                background: 'color-mix(in srgb, var(--color-navy) 8%, transparent)',
                border: '1px dashed var(--color-navy)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: 11,
                color: 'var(--color-navy)',
                marginBottom: 'var(--sp-1)',
              }}
            >
              ↳ Auto-generated Operate companion. Units track parent
              ({asset.unitsFromParent ?? 0} keys from parent's Sellable
              sub-units). Removing the parent removes this companion.
            </div>
          )}

          {/* M2.0f Fix 2: Land row (parcel dropdown + sqm/% input + multi-parcel splits)
              + M2.0f Fix 6: Areas row (BUA + breakdown derived from sub-units; GFA optional input).
              T2-Fix 5a (2026-05-12): hidden on companion assets (Operate). The companion
              inherits its units count from the parent and never carries its own land. */}
          {!asset.isCompanion && (
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
                        <AccountingNumberInput
                          id={`asset-${asset.id}-split-${idx}-sqm`}
                          data-testid={`asset-${asset.id}-split-${idx}-sqm`}
                          min={0}
                          value={sp.sqm}
                          onChange={(n) => updateSplit(idx, { sqm: Math.max(0, n) })}
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
                      <AccountingNumberInput
                        id={`asset-${asset.id}-landAreaSqm`}
                        data-testid={`asset-${asset.id}-landAreaSqm`}
                        value={allocation.sqm ?? asset.landAreaSqm ?? 0}
                        onChange={(n) => setAllocation({ sqm: Math.max(0, n) })}
                        scale="full"
                        decimals={0}
                        min={0}
                        style={inputStyle}
                      />
                    </div>
                    {allocation.parcelId === PARCEL_CUSTOM_RATE ? (
                      <div>
                        <InputLabel label="Custom Rate" help="Per-sqm rate override. Used instead of any parcel's rate." inputId={`asset-${asset.id}-customRate`} />
                        <AccountingNumberInput
                          id={`asset-${asset.id}-customRate`}
                          data-testid={`asset-${asset.id}-customRate`}
                          value={allocation.customRate ?? 0}
                          onChange={(n) => setAllocation({ customRate: Math.max(0, n) })}
                          scale="full"
                          decimals={2}
                          min={0}
                          style={inputStyle}
                        />
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
          )}

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
              model it as a Leasable sub-unit.
              T2P2 Fix 2 (2026-05-12): companions never carry their own
              areas (Support / Parking / GFA). Section is hidden. */}
          {!asset.isCompanion && (
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}
            data-testid={`asset-${asset.id}-areas-row`}
          >
            <div>
              <InputLabel label="Support Area (sqm)" help="Asset-level Support / back-of-house area. Combined with any Support sub-units to derive BUA = NSA + Support." inputId={`asset-${asset.id}-supportArea`} />
              <AccountingNumberInput
                id={`asset-${asset.id}-supportArea`}
                data-testid={`asset-${asset.id}-supportArea`}
                value={asset.supportArea ?? 0}
                onChange={(n) => onUpdate({ supportArea: Math.max(0, n) })}
                scale="full"
                decimals={0}
                min={0}
                style={inputStyle}
              />
            </div>
            <div>
              <InputLabel label="Parking Area (sqm)" help="Asset-level Parking area. GFA = BUA + Parking. Cost-only, no revenue." inputId={`asset-${asset.id}-parkingArea`} />
              <AccountingNumberInput
                id={`asset-${asset.id}-parkingArea`}
                data-testid={`asset-${asset.id}-parkingArea`}
                value={asset.parkingArea ?? 0}
                onChange={(n) => onUpdate({ parkingArea: Math.max(0, n) })}
                scale="full"
                decimals={0}
                min={0}
                style={inputStyle}
              />
            </div>
            <div>
              <InputLabel label="GFA Override (sqm)" help="Optional GFA override. Leave 0 to use derived BUA + Parking." inputId={`asset-${asset.id}-gfaSqm`} />
              <AccountingNumberInput
                id={`asset-${asset.id}-gfaSqm`}
                data-testid={`asset-${asset.id}-gfaSqm`}
                value={asset.gfaSqm}
                onChange={(n) => onUpdate({ gfaSqm: Math.max(0, n) })}
                scale="full"
                decimals={0}
                min={0}
                placeholder="auto = derived"
                style={inputStyle}
              />
            </div>
          </div>
          )}

          {/* P8-Fix 1 (2026-05-12): per-asset NDA inputs. Only rendered when
              project.projectNdaEnabled === true AND projectNdaScope === 'asset'.
              Otherwise the project-level NDA card at the top of Tab 2 owns
              the deduction.
              T2P2 Fix 2 (2026-05-12): companion has no land, so NDA never
              applies. Hidden on companion. */}
          {!asset.isCompanion && project.projectNdaEnabled === true && project.projectNdaScope === 'asset' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr 1fr',
                gap: 'var(--sp-2)',
                marginBottom: 'var(--sp-2)',
                padding: 'var(--sp-1) var(--sp-2)',
                background: 'color-mix(in srgb, var(--color-accent-warm) 8%, transparent)',
                border: '1px solid var(--color-accent-warm)',
                borderRadius: 'var(--radius-sm)',
                alignItems: 'center',
              }}
              data-testid={`asset-${asset.id}-nda-row`}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid={`asset-${asset.id}-nda-enabled`}
                  checked={asset.assetNdaEnabled === true}
                  onChange={(e) => onUpdate({ assetNdaEnabled: e.target.checked })}
                />
                Apply NDA
              </label>
              <div>
                <InputLabel label="Roads %" help="Per-asset roads deduction. Applied to this asset's land allocation when Apply NDA is on." inputId={`asset-${asset.id}-roads-pct`} />
                <input
                  id={`asset-${asset.id}-roads-pct`}
                  data-testid={`asset-${asset.id}-roads-pct`}
                  type="number" min={0} max={100} step={0.5}
                  value={asset.assetRoadsPct ?? 0}
                  onChange={(e) => onUpdate({ assetRoadsPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                  disabled={asset.assetNdaEnabled !== true}
                  style={{ ...inputStyle, opacity: asset.assetNdaEnabled !== true ? 0.6 : 1 }}
                />
              </div>
              <div>
                <InputLabel label="Parks %" help="Per-asset parks deduction." inputId={`asset-${asset.id}-parks-pct`} />
                <input
                  id={`asset-${asset.id}-parks-pct`}
                  data-testid={`asset-${asset.id}-parks-pct`}
                  type="number" min={0} max={100} step={0.5}
                  value={asset.assetParksPct ?? 0}
                  onChange={(e) => onUpdate({ assetParksPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                  disabled={asset.assetNdaEnabled !== true}
                  style={{ ...inputStyle, opacity: asset.assetNdaEnabled !== true ? 0.6 : 1 }}
                />
              </div>
            </div>
          )}

          {/* M2.0h Fix 3: NSA / BUA / GFA hierarchy chips. Read-only
              derived from sub-units + asset-level Support + Parking.
              T2P2 Fix 2 (2026-05-12): companion has no BUA / NSA / GFA
              of its own (Rule 2). Hidden on companion. */}
          {!asset.isCompanion && (() => {
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

          {/* M2.0h Fix 3 (2026-05-07) + M2.0i Fix 9 (2026-05-07): Area
              Reconciliation block. Collapsed by default with summary
              line; expand reveals itemized three-tier breakdown. The
              user's expand/collapse preference persists in
              localStorage per project (key 'm20i-asset-recon-{id}').
              T2P2 Fix 3 (2026-05-12): companion has no BUA / NSA / Land,
              so the area recon summary is meaningless. Hidden on
              companion.
              T2P2 Fix 4 (2026-05-12): non-companion assets that carry
              ZERO data in every physical attribute (no BUA, no NSA, no
              sub-units, no land area) auto-hide the recon block too.
              The user is just starting; surfacing "0 / 0 / 0%" is
              noise. The block reappears the moment the user enters
              any of: a sub-unit, an explicit land allocation, an
              asset-level Support/Parking/GFA value. */}
          {!asset.isCompanion && (() => {
            const reconRevenue = assetSubUnits
              .filter((u) => u.category === 'Sellable' || u.category === 'Operable' || u.category === 'Leasable')
              .reduce((s, u) => s + Math.max(0, u.metricValue) * Math.max(0, u.unitPrice ?? 0), 0);
            const hierForRecon = computeAssetAreaHierarchy(asset, subUnits);
            const allZero =
              assetSubUnits.length === 0
              && hierForRecon.bua === 0
              && hierForRecon.nsa === 0
              && hierForRecon.breakdown.supportArea === 0
              && hierForRecon.breakdown.parkingArea === 0
              && landBreakdown.landSqm === 0
              && landCost === 0
              && reconRevenue === 0;
            if (allZero) return null;
            return (
              <AssetAreaReconciliationBlock
                asset={asset}
                assetSubUnits={assetSubUnits}
                derivedSellable={derivedSellable}
                supportSum={supportSum}
                parkingSum={parkingSum}
                landSqm={landBreakdown.landSqm}
                landCost={landCost}
                totalRevenue={reconRevenue}
                currency={project.currency}
                scale={project.displayScale ?? 'full'}
                decimals={project.displayDecimals ?? 2}
              />
            );
          })()}
          {/* Sub-unit table */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
            {(() => {
              // P8-Fix 2c (2026-05-12): metric uniform per asset. Read
              // asset.subUnitMetric (Pass 8 schema field), fall back to
              // the first sub-unit's metric, then 'area'. Switching the
              // asset metric converts every sub-unit (preserve area).
              const firstSubMetric = assetSubUnits[0]?.metric === 'units'
                || (assetSubUnits[0]?.metric as unknown as string) === 'count'
                ? 'units' : 'area';
              const assetMetric: SubUnitMetric = asset.subUnitMetric ?? firstSubMetric;
              // P8-Fix 2b: dominant Count-label by first revenue sub-unit.
              const revenueSub = assetSubUnits.find((u) => u.category !== 'Support') ?? assetSubUnits[0];
              const dynamicCountHeader = revenueSub
                ? countUnitLabel(revenueSub.category, asset.strategy, asset.type)
                : 'Units';
              const switchAssetMetric = (next: SubUnitMetric): void => {
                if (next === assetMetric) return;
                for (const u of assetSubUnits) {
                  const check = canSwitchMetric(u, next);
                  if (!check.ok) {
                    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                      window.alert(`Sub-unit "${u.name || 'unnamed'}": ${check.reason}`);
                    }
                    return;
                  }
                }
                onUpdate({ subUnitMetric: next });
                for (const u of assetSubUnits) {
                  const patch = switchMetric(u, next);
                  updateSubUnit(u.id, patch);
                }
              };
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)', flexWrap: 'wrap', gap: 8 }}>
                    <strong style={{ fontSize: 'var(--font-small)' }}>Sub-units</strong>
                    {asset.isCompanion ? (
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic' }} data-testid={`asset-${asset.id}-companion-subunit-note`}>
                        Mirrored from parent. Edit ADR only.
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metric:</span>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`subunit-metric-${asset.id}`}
                            value="area"
                            data-testid={`asset-${asset.id}-subunit-metric-area`}
                            checked={assetMetric === 'area'}
                            onChange={() => switchAssetMetric('area')}
                          />
                          Area
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`subunit-metric-${asset.id}`}
                            value="units"
                            data-testid={`asset-${asset.id}-subunit-metric-units`}
                            checked={assetMetric === 'units'}
                            onChange={() => switchAssetMetric('units')}
                          />
                          Units
                        </label>
                        <button
                          type="button"
                          onClick={handleAddSubUnit}
                          data-testid={`asset-${asset.id}-add-subunit`}
                          style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '2px 10px', cursor: 'pointer', fontSize: 'var(--font-micro)', marginLeft: 8 }}
                        >
                          + Sub-unit
                        </button>
                      </div>
                    )}
                  </div>
                  {assetSubUnits.length === 0 ? (
                    <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', padding: 'var(--sp-1)' }}>
                      No sub-units yet. Add at least one so revenue (Module 2) can attach.
                    </div>
                  ) : (
                    /* P8-Fix 2 (2026-05-12): Metric column dropped from
                       per-row (asset-level toggle above). Area is always
                       editable. In Units mode, Unit Size editable + Count
                       derived (Area / Unit Size); in Area mode, Unit Size
                       + Count render muted dashes. Count header uses
                       dynamic label (Units / Keys / Beds / Bays / Tenants). */
                    <table
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}
                      data-testid={`asset-${asset.id}-subunit-table`}
                    >
                      <colgroup>
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '19%' }} />
                        <col style={{ width: '5%' }} />
                      </colgroup>
                      <thead>
                        <tr style={{ background: 'var(--color-grey-pale)' }}>
                          <th style={{ padding: '4px 6px', textAlign: 'left' }}>Type</th>
                          <th style={{ padding: '4px 6px', textAlign: 'left' }}>Category</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Area (sqm)</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Unit Size (sqm)</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }} data-testid={`asset-${asset.id}-subunit-count-header`}>{dynamicCountHeader}</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Rate ({project.currency})</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }} data-testid={`asset-${asset.id}-subunit-total-revenue-header`}>Total Revenue (No Indexation)</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {assetSubUnits.map((u) => (
                          <SubUnitRow
                            key={u.id}
                            subUnit={u}
                            assetMetric={assetMetric}
                            currency={project.currency}
                            onUpdate={(patch) => updateSubUnit(u.id, patch)}
                            onRemove={() => removeSubUnit(u.id)}
                            decimals={project.displayDecimals ?? 2}
                            scale={project.displayScale ?? 'full'}
                            assetStrategy={asset.strategy}
                            assetType={asset.type}
                            isCompanionSub={asset.isCompanion === true && !!u.parentSubUnitId}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              );
            })()}
          </div>

          {/* M2.0h Fix 3: footer summary uses the three-tier hierarchy.
              T2P2 Fix 2 (2026-05-12): companion has no BUA / NSA /
              Efficiency / Land cost. Hidden on companion. */}
          {!asset.isCompanion && (() => {
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

// M2.0i Fix 6 (2026-05-07): metric switch preserves the area sqm.
// metric='units' -> metricValue is count; area = count × unitArea.
// metric='area'  -> metricValue is total sqm; count derives = area / unitArea.
// On switch we re-normalize metricValue so the displayed area stays the
// same (no accidental multiplication when toggling).
//
// M2.0L (2026-05-11): when switching from 'area' to 'units' with
// unitArea=0 we previously zeroed out metricValue (because count =
// area / 0 is undefined). That destroyed the area sqm on round-trip.
// canSwitchMetric guards the dropdown: if the switch would lose
// non-zero area data, refuse and surface an inline warning so the
// user sets Unit Size first.
export function canSwitchMetric(subUnit: SubUnit, next: SubUnitMetric): { ok: true } | { ok: false; reason: string } {
  if (next === 'area') return { ok: true };
  const unitArea = Math.max(0, subUnit.unitArea ?? 0);
  if (unitArea === 0) {
    const isUnits = subUnit.metric === 'units' || (subUnit.metric as unknown as string) === 'count';
    const currentArea = isUnits ? subUnit.metricValue * unitArea : subUnit.metricValue;
    if (currentArea > 0) {
      return { ok: false, reason: 'Set Unit Size before switching to Units (current area would be lost)' };
    }
  }
  return { ok: true };
}

function switchMetric(
  subUnit: SubUnit,
  next: SubUnitMetric,
): { metric: SubUnitMetric; metricValue: number } {
  const prev = (subUnit.metric === 'units' || (subUnit.metric as unknown as string) === 'count') ? 'units' : 'area';
  const unitArea = Math.max(0, subUnit.unitArea ?? 0);
  const currentArea = prev === 'units' ? subUnit.metricValue * unitArea : subUnit.metricValue;
  if (next === 'units') {
    const newCount = unitArea > 0 ? currentArea / unitArea : (prev === 'units' ? subUnit.metricValue : 0);
    return { metric: 'units', metricValue: newCount };
  }
  return { metric: 'area', metricValue: currentArea };
}

function SubUnitRow({ subUnit, assetMetric, currency, onUpdate, onRemove, decimals, scale, assetStrategy, assetType, isCompanionSub }: SubUnitRowProps & { assetMetric: SubUnitMetric; decimals: import('../../lib/state/module1-types').DisplayDecimals; scale: import('../../lib/state/module1-types').DisplayScale; assetStrategy: AssetStrategy; assetType?: string; isCompanionSub?: boolean }): React.JSX.Element {
  // T2-Fix 5c (2026-05-12): companion sub-unit (parentSubUnitId set) is
  // a read-only mirror of its parent's Sellable row. Type / Category /
  // Area / Unit Size / Count are derived; the user only edits ADR
  // (startingAdr). No delete button (the row vanishes when the parent
  // Sellable is removed). Total Revenue = count * startingAdr.
  if (isCompanionSub) {
    const companionCount = Math.max(0, Math.round(subUnit.metricValue));
    const adr = subUnit.startingAdr ?? subUnit.unitPrice;
    const countLabel = countUnitLabel('Operable', assetStrategy, assetType);
    const companionRevenue = companionCount * Math.max(0, adr);
    return (
      <tr data-testid={`subunit-row-${subUnit.id}`} data-companion-row="true">
        <td style={{ padding: '4px 6px' }}>
          <div style={{ fontSize: 11, color: 'var(--color-heading)' }} data-testid={`subunit-${subUnit.id}-name-readonly`}>{subUnit.name || '-'}</div>
          <div style={{ fontSize: 9, color: 'var(--color-meta)', fontStyle: 'italic' }}>from parent</div>
        </td>
        <td style={{ padding: '4px 6px' }}>
          <div style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid={`subunit-${subUnit.id}-category-readonly`}>Operable</div>
        </td>
        <td style={{ padding: '4px 6px', textAlign: 'right' }}>
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid={`subunit-${subUnit.id}-area-hidden`}>-</span>
        </td>
        <td style={{ padding: '4px 6px', textAlign: 'right' }}>
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid={`subunit-${subUnit.id}-unitArea-hidden`}>-</span>
        </td>
        <td style={{ padding: '4px 6px', textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--color-heading)' }} data-testid={`subunit-${subUnit.id}-count`}>
            {companionCount.toLocaleString('en-US')}
            <div style={{ fontSize: 9, color: 'var(--color-meta)', textAlign: 'right', marginTop: 2, fontStyle: 'italic' }} data-testid={`subunit-${subUnit.id}-count-unit`}>
              {countLabel}
            </div>
          </div>
        </td>
        <td style={{ padding: '4px 6px', textAlign: 'right' }}>
          <AccountingNumberInput
            value={adr}
            onChange={(n) => onUpdate({ startingAdr: Math.max(0, n), unitPrice: Math.max(0, n) })}
            scale="full"
            decimals={decimals}
            min={0}
            style={{ ...inputStyle, fontSize: 11 }}
            data-testid={`subunit-${subUnit.id}-startingAdr`}
          />
          <div style={{ fontSize: 9, color: 'var(--color-meta)', textAlign: 'right', marginTop: 2, fontStyle: 'italic' }} data-testid={`subunit-${subUnit.id}-rate-unit`}>
            {currency} ADR / key / night
          </div>
        </td>
        <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--color-heading)' }} data-testid={`subunit-${subUnit.id}-total-revenue`}>
          {formatAccounting(companionRevenue, scale, decimals)}
        </td>
        <td style={{ padding: '4px 6px' }} />
      </tr>
    );
  }
  // P8-Fix 2 (2026-05-12): metric is per-asset (no per-row dropdown).
  // Storage stays the same: subUnit.metricValue carries total area when
  // metric='area' and count when metric='units'. In Units mode the user
  // edits Area (we back-calc count = area / unitArea) + Unit Size, and
  // Count is the read-only derived value. Count header label is dynamic
  // (Units / Keys / Beds / Bays / Tenants) via countUnitLabel.
  const isUnits = assetMetric === 'units';
  const unitArea = Math.max(0, subUnit.unitArea ?? 0);
  const storedIsUnits = subUnit.metric === 'units' || (subUnit.metric as unknown as string) === 'count';
  const totalArea = storedIsUnits ? subUnit.metricValue * unitArea : subUnit.metricValue;
  // P9-Fix 1 (2026-05-12): derived Count rounds to whole number for
  // display. Apartments / keys / beds / bays / tenants are integer
  // concepts; decimal counts are nonsensical. Total Revenue also
  // computes off the rounded count so the displayed math holds.
  const rawCount = storedIsUnits
    ? subUnit.metricValue
    : (unitArea > 0 ? subUnit.metricValue / unitArea : 0);
  const count = isUnits ? Math.round(rawCount) : rawCount;
  const totalRevenueNoIdx = isUnits
    ? count * subUnit.unitPrice
    : subUnit.metricValue * subUnit.unitPrice;
  const rateUnit = rateUnitLabel(subUnit.category, assetMetric);
  const countUnit = countUnitLabel(subUnit.category, assetStrategy, assetType);
  const unitsButNoSize = isUnits && unitArea === 0 && totalArea > 0;
  // P8-Fix 2a: in Units mode, the user edits AREA (sqm). We back-calc
  // count = area / unitArea and store that as metricValue when stored
  // shape is 'units'. When stored shape lags (legacy 'area' subunit
  // inside a Units-mode asset), we flip the row to 'units' shape on
  // first edit so back-calc holds.
  const onEditAreaUnits = (nextArea: number): void => {
    const a = Math.max(0, nextArea);
    if (unitArea <= 0) {
      // No unit size yet, store area in metricValue temporarily but flag
      // for derivation once Unit Size is provided.
      onUpdate({ metric: 'units', metricValue: 0, unitArea: 0 });
      return;
    }
    onUpdate({ metric: 'units', metricValue: a / unitArea });
  };
  const onEditUnitSize = (nextUnitArea: number): void => {
    const ua = Math.max(0, nextUnitArea);
    // Preserve currently displayed Area: when stored is 'units',
    // newCount = area / new ua = (oldCount * oldUnitArea) / ua.
    if (storedIsUnits && ua > 0 && unitArea > 0) {
      const area = subUnit.metricValue * unitArea;
      onUpdate({ unitArea: ua, metricValue: area / ua, metric: 'units' });
    } else if (!storedIsUnits && ua > 0) {
      // Stored is 'area'; convert to 'units' with derived count.
      onUpdate({ unitArea: ua, metricValue: subUnit.metricValue / ua, metric: 'units' });
    } else {
      onUpdate({ unitArea: ua, metric: 'units' });
    }
  };
  const onEditAreaWhenArea = (next: number): void => {
    onUpdate({ metric: 'area', metricValue: Math.max(0, next) });
  };
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
      {/* Area: always editable. In Units mode, user-entered Area drives
          the derived Count via Unit Size.
          P10-Fix 8 (2026-05-12): accounting format on blur. */}
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        <AccountingNumberInput
          value={Number(totalArea.toFixed(2))}
          onChange={(n) => isUnits ? onEditAreaUnits(n) : onEditAreaWhenArea(n)}
          scale="full"
          decimals={0}
          min={0}
          style={{ ...inputStyle, fontSize: 11 }}
          data-testid={`subunit-${subUnit.id}-area-input`}
        />
      </td>
      {/* Unit Size: editable in Units mode, muted dash in Area mode.
          P10-Fix 8 (2026-05-12): accounting format on blur. */}
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {isUnits ? (
          <>
            <AccountingNumberInput
              value={Number((subUnit.unitArea ?? 0).toFixed(2))}
              onChange={(n) => onEditUnitSize(n)}
              scale="full"
              decimals={0}
              min={0}
              style={{ ...inputStyle, fontSize: 11 }}
              data-testid={`subunit-${subUnit.id}-unitArea`}
              aria-invalid={unitsButNoSize}
            />
            {unitsButNoSize && (
              <div style={{ fontSize: 9, color: 'var(--color-negative)' }} data-testid={`subunit-${subUnit.id}-units-no-size-error`}>Unit Size required</div>
            )}
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid={`subunit-${subUnit.id}-unitArea-hidden`}>-</span>
        )}
      </td>
      {/* Count: derived (read-only) in Units mode; muted dash in Area mode. */}
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {isUnits ? (
          <div style={{ fontSize: 11, color: 'var(--color-heading)' }} data-testid={`subunit-${subUnit.id}-count`}>
            {unitArea > 0 ? count.toLocaleString('en-US') : '-'}
            <div style={{ fontSize: 9, color: 'var(--color-meta)', textAlign: 'right', marginTop: 2, fontStyle: 'italic' }} data-testid={`subunit-${subUnit.id}-count-unit`}>
              {countUnit}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid={`subunit-${subUnit.id}-count-hidden`}>-</span>
        )}
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        <AccountingNumberInput
          value={subUnit.unitPrice}
          onChange={(n) => onUpdate({ unitPrice: Math.max(0, n) })}
          scale="full"
          decimals={decimals}
          min={0}
          style={{ ...inputStyle, fontSize: 11 }}
          data-testid={`subunit-${subUnit.id}-rate`}
        />
        {rateUnit && (
          <div style={{ fontSize: 9, color: 'var(--color-meta)', textAlign: 'right', marginTop: 2, fontStyle: 'italic' }} data-testid={`subunit-${subUnit.id}-rate-unit`}>
            {currency} {rateUnit}
          </div>
        )}
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--color-heading)' }} data-testid={`subunit-${subUnit.id}-total-revenue`}>
        {formatAccounting(totalRevenueNoIdx, scale, decimals)}
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
          <AccountingNumberInput id={`asset-${asset.id}-mgmt-start`} data-testid={`asset-${asset.id}-mgmt-start`} min={0} decimals={0} value={ag.agreementStartPeriod ?? 0} onChange={(n) => setAg({ agreementStartPeriod: n > 0 ? n : undefined })} style={inputStyle} />
        </div>
        <div>
          <InputLabel label="Duration (periods)" help="Optional. Blank = perpetual." inputId={`asset-${asset.id}-mgmt-duration`} />
          <AccountingNumberInput id={`asset-${asset.id}-mgmt-duration`} data-testid={`asset-${asset.id}-mgmt-duration`} min={0} decimals={0} value={ag.agreementDurationPeriods ?? 0} onChange={(n) => setAg({ agreementDurationPeriods: n > 0 ? n : undefined })} style={inputStyle} />
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
        <AccountingNumberInput id={`asset-${asset.id}-useful-life-input`} data-testid={`asset-${asset.id}-useful-life-input`} min={0} decimals={0} value={asset.usefulLifeYears ?? 0} onChange={(n) => onUpdate({ usefulLifeYears: n > 0 ? n : undefined })} placeholder={`default ${fallback}`} style={inputStyle} />
      </div>
      <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}>
        <strong>Resolved:</strong> {resolved} years{!explicit && (<span style={{ display: 'block', marginTop: 2 }}>(category default)</span>)}
      </div>
    </div>
  );
}

// ── M2.0i Fix 9: LandReconciliationBlock (compact / expandable) ──────────
interface LandReconciliationBlockProps {
  landReconciliation: import('@/src/core/calculations').LandReconciliation;
  parcels: Parcel[];
  currency: string;
  scale: import('../../lib/state/module1-types').DisplayScale;
  decimals: import('../../lib/state/module1-types').DisplayDecimals;
  // P9-Fix 2 (2026-05-12): project-level NDA inputs for the deductions
  // walk. When ndaEnabled is true, the block renders an explicit
  // Total - Roads% - Parks% = NDA walk + a per-asset allocation block
  // whose sums tie back to NDA (vs Total when disabled).
  projectNdaEnabled: boolean;
  projectRoadsPct: number;
  projectParksPct: number;
  assets: Asset[];
  assetLandSqmByAssetId: Map<string, number>;
  assetLandValueByAssetId: Map<string, number>;
  // T3-edit-runtime v7 (2026-05-13): per-asset Cash + In-Kind value
  // maps. Tab 3 Land (Cash) + Land (In-Kind) cost lines read these
  // pre-computed values directly per asset (single source of truth).
  assetCashValueByAssetId: Map<string, number>;
  assetInKindValueByAssetId: Map<string, number>;
  // Parcel-level totals for the top "Total Parcel Land" row.
  totalCashValue: number;
  totalInKindValue: number;
  phases: Phase[];
}

const RECON_LS_KEY = 'm20i-land-recon-collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(RECON_LS_KEY) !== 'false'; }
  catch { return true; }
}

function writeCollapsed(v: boolean): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(RECON_LS_KEY, v ? 'true' : 'false'); }
  catch { /* noop */ }
}

function LandReconciliationBlock({
  landReconciliation, parcels, currency, scale, decimals,
  projectNdaEnabled, projectRoadsPct, projectParksPct,
  assets, assetLandSqmByAssetId, assetLandValueByAssetId,
  assetCashValueByAssetId, assetInKindValueByAssetId,
  totalCashValue, totalInKindValue, phases,
}: LandReconciliationBlockProps): React.JSX.Element {
  const totalParcelsNda = parcels.reduce((s, p) => s + computeParcelNda(p).nda, 0);
  const totalReservedRoadsParks = landReconciliation.parcelsTotalSqm - totalParcelsNda;
  const anyNda = parcels.some((p) => p.hasNdaDeduction === true);

  const hasMismatch = !landReconciliation.matches;
  const [userCollapsed, setUserCollapsed] = useState<boolean>(readCollapsed);
  // Auto-expand on mismatch overrides user preference. User can still
  // collapse manually after; the auto-expand is a one-shot signal.
  const collapsed = hasMismatch ? false : userCollapsed;

  const toggle = (): void => {
    const next = !collapsed;
    setUserCollapsed(next);
    writeCollapsed(next);
  };

  const fmtMoney = (n: number): string => fmtCurrency(n, currency, scale, decimals);
  const accent = landReconciliation.matches
    ? 'var(--color-success)'
    : landReconciliation.overBy > 0
      ? 'var(--color-negative)'
      : 'var(--color-accent-warm)';

  return (
    <div
      style={{
        ...sectionCardStyle,
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        border: `1px solid ${accent}`,
        padding: collapsed ? 'var(--sp-2)' : 'var(--sp-3)',
      }}
      data-testid="land-reconciliation"
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 'var(--sp-2)' }}
        onClick={toggle}
        data-testid="land-reconciliation-toggle"
      >
        {/* P10-Fix 5 (2026-05-12): when projectNdaEnabled, the summary
            compares allocations against NDA (post-deduction) instead
            of gross parcels. Drops the misleading "short by 10,630"
            message that confused users (allocations matched NDA but
            were short of gross). The summary suffix follows the same
            three-way state (matches / over / unassigned) using the
            NDA-aware basis. */}
        <div style={{ fontSize: 'var(--font-small)', display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ color: accent, fontWeight: 700 }}>{landReconciliation.matches ? '✓' : landReconciliation.overBy > 0 ? '✗' : '⚠'}</span>
          <strong>Land:</strong>
          <span data-testid="land-reconciliation-summary">
            {(() => {
              const allocated = landReconciliation.assetsAllocatedSqm;
              const allocatedValue = landReconciliation.assetsAllocatedValue;
              if (projectNdaEnabled) {
                const totalLand = landReconciliation.parcelsTotalSqm;
                const nda = Math.max(0, totalLand - totalLand * (projectRoadsPct / 100) - totalLand * (projectParksPct / 100));
                const diff = nda - allocated;
                if (Math.abs(diff) < 1) return `${fmt(allocated)} sqm allocated, ${fmtMoney(allocatedValue)} (matches NDA)`;
                if (diff < 0) return `${fmt(allocated)} sqm allocated, ${fmtMoney(allocatedValue)} (over NDA by ${fmt(Math.abs(diff))} sqm)`;
                return `${fmt(allocated)} sqm allocated, ${fmtMoney(allocatedValue)} (${fmt(diff)} sqm unassigned)`;
              }
              if (landReconciliation.matches) return `${fmt(allocated)} sqm allocated, ${fmtMoney(allocatedValue)} (matches parcels)`;
              if (landReconciliation.overBy > 0) return `${fmt(allocated)} sqm allocated, ${fmtMoney(allocatedValue)} (over by ${fmt(landReconciliation.overBy)} sqm)`;
              return `${fmt(allocated)} sqm allocated, ${fmtMoney(allocatedValue)} (${fmt(landReconciliation.shortBy)} sqm unassigned)`;
            })()}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          data-testid="land-reconciliation-expand"
          style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--color-meta)' }}
        >
          {collapsed ? 'expand' : 'collapse'}
        </button>
      </div>
      {!collapsed && (() => {
        // T2 Fix 2 + 3 (2026-05-12): single 3-column structured table
        // (Description | Sqm | Land Value). Always rendered when
        // expanded; Roads/Parks rows surface only when projectNdaEnabled.
        // NDA row always visible (when NDA disabled, NDA = Total Parcel).
        // Land Value column shows GROSS values (NDA reduces developable
        // sqm only; cost basis stays on gross). Per-asset rows + Total
        // Allocated + Unassigned Land. Equal/Under/Over chips applied
        // to both Sqm and Land Value columns. Replaces the prior
        // NDA-only walk + 3-col bottom grid + red "short by" section.
        const totalLand = landReconciliation.parcelsTotalSqm;
        const totalLandValue = landReconciliation.parcelsTotalValue;
        const roadsSqm = projectNdaEnabled ? totalLand * (projectRoadsPct / 100) : 0;
        const parksSqm = projectNdaEnabled ? totalLand * (projectParksPct / 100) : 0;
        const nda = projectNdaEnabled ? Math.max(0, totalLand - roadsSqm - parksSqm) : totalLand;
        const fmtSqm = (n: number): string => fmt(n);
        const allocatedSqm = landReconciliation.assetsAllocatedSqm;
        const allocatedValue = landReconciliation.assetsAllocatedValue;
        const sqmDiff = nda - allocatedSqm;
        const valueDiff = totalLandValue - allocatedValue;
        // T2P3 Fix 1 (2026-05-12): tolerance band. Status reads Equal
        // when the gap is within 1000 sqm (or 1000 SAR for Land Value).
        // Floating-point rounding artifacts produced spurious Under/Over
        // chips on projects whose math actually tied. The captions
        // surface "(within rounding tolerance)" when the band kicks in
        // so the user knows the chip is a rounding read, not exact zero.
        const SQM_EPSILON = 1000;
        const VALUE_EPSILON = 1000;
        const sqmStatus: 'equal' | 'under' | 'over' =
          Math.abs(sqmDiff) < SQM_EPSILON ? 'equal' : sqmDiff > 0 ? 'under' : 'over';
        const valueStatus: 'equal' | 'under' | 'over' =
          Math.abs(valueDiff) < VALUE_EPSILON ? 'equal' : valueDiff > 0 ? 'under' : 'over';
        const sqmWithinTolerance = sqmStatus === 'equal' && Math.abs(sqmDiff) > 0.5;
        const valueWithinTolerance = valueStatus === 'equal' && Math.abs(valueDiff) > 0.5;
        const chipFor = (status: 'equal' | 'under' | 'over'): React.JSX.Element => {
          if (status === 'equal') return <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓ Equal</span>;
          if (status === 'under') return <span style={{ color: 'var(--color-accent-warm)', fontWeight: 700 }}>⚠ Under</span>;
          return <span style={{ color: 'var(--color-negative)', fontWeight: 700 }}>❌ Over</span>;
        };
        // T3-edit-runtime v7 (2026-05-13): 5-column grid:
        // Description | Sqm | Land Value | Cash Value | In-Kind Value
        const gridStyle: React.CSSProperties = {
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto auto auto auto',
          columnGap: 'var(--sp-3)',
          rowGap: 2,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 'var(--font-small)',
        };
        const cellRight: React.CSSProperties = { textAlign: 'right' };
        const rowTopBorder: React.CSSProperties = {
          borderTop: '1px solid var(--color-border)',
          paddingTop: 4,
          marginTop: 2,
        };
        const rowBold: React.CSSProperties = { fontWeight: 700 };
        return (
          <div
            style={{ marginTop: 'var(--sp-2)', padding: 'var(--sp-2)', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)' }}
            data-testid="land-reconciliation-table"
          >
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 'var(--font-small)' }}>Land Reconciliation</div>
            <div style={gridStyle}>
              {/* Header row */}
              <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</div>
              <div style={{ ...cellRight, fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sqm</div>
              <div style={{ ...cellRight, fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Land Value ({currency})</div>
              <div style={{ ...cellRight, fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cash Value ({currency})</div>
              <div style={{ ...cellRight, fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>In-Kind Value ({currency})</div>

              {/* Total Parcel Land */}
              <div>Total Parcel Land</div>
              <div data-testid="recon-total-land" style={cellRight}>{fmtSqm(totalLand)}</div>
              <div data-testid="recon-total-land-value" style={cellRight}>{fmtMoney(totalLandValue)}</div>
              <div data-testid="recon-total-land-cash" style={cellRight}>{fmtMoney(totalCashValue)}</div>
              <div data-testid="recon-total-land-inkind" style={cellRight}>{fmtMoney(totalInKindValue)}</div>

              {/* Roads / Parks only when NDA enabled */}
              {projectNdaEnabled && (
                <>
                  <div>Less: Roads ({projectRoadsPct.toFixed(1)}%)</div>
                  <div data-testid="recon-roads" style={cellRight}>({fmtSqm(roadsSqm)})</div>
                  <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
                  <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
                  <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
                  <div>Less: Parks ({projectParksPct.toFixed(1)}%)</div>
                  <div data-testid="recon-parks" style={cellRight}>({fmtSqm(parksSqm)})</div>
                  <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
                  <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
                  <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
                </>
              )}

              {/* Net Developable Area (always shown; when NDA disabled, = total) */}
              <div style={{ ...rowTopBorder, ...rowBold }}>Net Developable Area</div>
              <div data-testid="recon-nda" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>{fmtSqm(nda)}</div>
              <div data-testid="recon-nda-value" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>{fmtMoney(totalLandValue)}</div>
              <div data-testid="recon-nda-cash" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>{fmtMoney(totalCashValue)}</div>
              <div data-testid="recon-nda-inkind" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>{fmtMoney(totalInKindValue)}</div>

              {/* Spacer + Asset Allocations header */}
              <div style={{ marginTop: 'var(--sp-1)', fontSize: 11, color: 'var(--color-meta)' }}>Asset Allocations:</div>
              <div />
              <div />
              <div />
              <div />

              {/* Per-asset rows. T2P2 Fix 2 (2026-05-12): companion
                  assets are excluded entirely from the Asset Allocations
                  list because they carry no land (Rule 2 + Rule 4).
                  T3-edit-runtime v7: per-asset Cash + In-Kind values
                  pull from resolveAssetAreaMetrics, same source Tab 3
                  Land cost lines use. */}
              {assets.filter((a) => a.visible && a.isCompanion !== true).map((a) => {
                const phaseName = phases.find((p) => p.id === a.phaseId)?.name ?? '';
                const sqm = assetLandSqmByAssetId.get(a.id) ?? 0;
                const value = assetLandValueByAssetId.get(a.id) ?? 0;
                const cashV = assetCashValueByAssetId.get(a.id) ?? 0;
                const inkV = assetInKindValueByAssetId.get(a.id) ?? 0;
                return (
                  <React.Fragment key={a.id}>
                    <div>{a.name} ({phaseName})</div>
                    <div data-testid={`recon-asset-${a.id}-sqm`} style={cellRight}>{fmtSqm(sqm)}</div>
                    <div data-testid={`recon-asset-${a.id}-value`} style={cellRight}>{fmtMoney(value)}</div>
                    <div data-testid={`recon-asset-${a.id}-cash`} style={cellRight}>{fmtMoney(cashV)}</div>
                    <div data-testid={`recon-asset-${a.id}-inkind`} style={cellRight}>{fmtMoney(inkV)}</div>
                  </React.Fragment>
                );
              })}

              {/* Total Allocated with chips */}
              {(() => {
                const allocatedCash = assets
                  .filter((a) => a.visible && a.isCompanion !== true)
                  .reduce((s, a) => s + (assetCashValueByAssetId.get(a.id) ?? 0), 0);
                const allocatedInk = assets
                  .filter((a) => a.visible && a.isCompanion !== true)
                  .reduce((s, a) => s + (assetInKindValueByAssetId.get(a.id) ?? 0), 0);
                return (
                  <>
                    <div style={{ ...rowTopBorder, ...rowBold }}>Total Allocated</div>
                    <div data-testid="recon-allocated" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>
                      {fmtSqm(allocatedSqm)} <span style={{ marginLeft: 6 }}>{chipFor(sqmStatus)}</span>
                    </div>
                    <div data-testid="recon-allocated-value" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>
                      {fmtMoney(allocatedValue)} <span style={{ marginLeft: 6 }}>{chipFor(valueStatus)}</span>
                    </div>
                    <div data-testid="recon-allocated-cash" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>
                      {fmtMoney(allocatedCash)}
                    </div>
                    <div data-testid="recon-allocated-inkind" style={{ ...cellRight, ...rowTopBorder, ...rowBold }}>
                      {fmtMoney(allocatedInk)}
                    </div>
                  </>
                );
              })()}

              {/* Unassigned Land row */}
              <div>Unassigned Land</div>
              <div data-testid="recon-unassigned-sqm" style={cellRight}>
                {sqmStatus === 'equal' ? <span style={{ color: 'var(--color-meta)' }}>-</span> : sqmStatus === 'over' ? <span style={{ color: 'var(--color-negative)' }}>over by {fmtSqm(Math.abs(sqmDiff))}</span> : fmtSqm(sqmDiff)}
              </div>
              <div data-testid="recon-unassigned-value" style={cellRight}>
                {valueStatus === 'equal' ? <span style={{ color: 'var(--color-meta)' }}>-</span> : valueStatus === 'over' ? <span style={{ color: 'var(--color-negative)' }}>over by {fmtMoney(Math.abs(valueDiff))}</span> : fmtMoney(valueDiff)}
              </div>
              <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
              <div style={{ ...cellRight, color: 'var(--color-meta)' }}>-</div>
            </div>

            {/* Status footer */}
            <div style={{ marginTop: 'var(--sp-2)', fontSize: 11, color: 'var(--color-meta)' }} data-testid="recon-status-footer">
              <div>
                Sqm: {fmtSqm(allocatedSqm)} / {fmtSqm(nda)} {projectNdaEnabled ? 'NDA' : 'Total Parcel'} <span style={{ marginLeft: 6 }}>{chipFor(sqmStatus)}</span>
                {sqmWithinTolerance && (
                  <span style={{ marginLeft: 6, fontStyle: 'italic' }} data-testid="recon-sqm-tolerance-caption">(within rounding tolerance)</span>
                )}
              </div>
              <div style={{ marginTop: 2 }}>
                Land Cost: {fmtMoney(allocatedValue)} / {fmtMoney(totalLandValue)} Total Parcel Value <span style={{ marginLeft: 6 }}>{chipFor(valueStatus)}</span>
                {valueWithinTolerance && (
                  <span style={{ marginLeft: 6, fontStyle: 'italic' }} data-testid="recon-value-tolerance-caption">(within rounding tolerance)</span>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── P7-Fix 2: AssetAreaReconciliationBlock (single compact line) ─────────
// Pass 7 collapses the previously multi-row reconciliation panel down to
// one line: `Verification: BUA X | NSA X | Eff X% | Land X | Land Cost X`.
// Mismatch state (sub-units exist with Support/Parking but NSA = 0) still
// surfaces an inline warning prefix. expand/collapse + localStorage state
// removed (always single-line).
interface AssetAreaReconciliationBlockProps {
  asset: Asset;
  assetSubUnits: SubUnit[];
  derivedSellable: number;
  supportSum: number;
  parkingSum: number;
  landSqm: number;
  landCost: number;
  // P10-Fix 7 (2026-05-12): sum of sub-unit Total Revenue (no
  // indexation). Computed at caller from metricValue * unitPrice
  // across revenue sub-unit categories (Sellable / Operable /
  // Leasable). Surfaces inline in the verification summary so the
  // user sees revenue alongside BUA / NSA / Land at a glance.
  totalRevenue: number;
  currency: string;
  scale: import('../../lib/state/module1-types').DisplayScale;
  decimals: import('../../lib/state/module1-types').DisplayDecimals;
}

function AssetAreaReconciliationBlock({
  asset, assetSubUnits, derivedSellable, supportSum, parkingSum, landSqm, landCost, totalRevenue,
  currency, scale, decimals,
}: AssetAreaReconciliationBlockProps): React.JSX.Element {
  const bua = derivedSellable + supportSum + Math.max(0, asset.supportArea ?? 0);
  const eff = bua > 0 ? (derivedSellable / bua) * 100 : 0;
  const noSubUnits = assetSubUnits.filter((u) => u.category !== 'Support').length === 0;
  const hasSupportOrParking = supportSum > 0 || (asset.supportArea ?? 0) > 0 || parkingSum > 0;
  const mismatch = !noSubUnits && derivedSellable === 0 && hasSupportOrParking;
  const accent = mismatch ? 'var(--color-accent-warm)' : 'var(--color-success)';
  const fmtMoney = (n: number): string => fmtCurrency(n, currency, scale, decimals);
  return (
    <div
      style={{
        border: `1px solid ${accent}`,
        background: `color-mix(in srgb, ${accent} 6%, transparent)`,
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-1) var(--sp-2)',
        marginBottom: 'var(--sp-2)',
        fontSize: 11,
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'baseline',
        flexWrap: 'wrap',
      }}
      data-testid={`asset-${asset.id}-area-reconciliation`}
    >
      <span style={{ color: accent, fontWeight: 700 }}>{mismatch ? '⚠' : '✓'}</span>
      <strong>Verification:</strong>
      <span data-testid={`asset-${asset.id}-recon-summary`} style={{ color: 'var(--color-body)' }}>
        BUA <strong data-testid={`asset-${asset.id}-recon-bua`}>{fmt(bua)}</strong>
        {' | '}NSA <strong data-testid={`asset-${asset.id}-recon-nsa`}>{fmt(derivedSellable)}</strong>
        {' | '}Eff <strong data-testid={`asset-${asset.id}-recon-eff`}>{bua > 0 ? `${fmt(eff, 1)}%` : 'n/a'}</strong>
        {' | '}Land <strong data-testid={`asset-${asset.id}-recon-land`}>{fmt(landSqm)}</strong>
        {' | '}Land Cost <strong data-testid={`asset-${asset.id}-recon-land-cost`}>{fmtMoney(landCost)}</strong>
        {' | '}Revenue <strong data-testid={`asset-${asset.id}-recon-revenue`}>{fmtMoney(totalRevenue)}</strong>
        {mismatch && <span style={{ color: 'var(--color-accent-warm)', marginLeft: 8 }}>· no revenue sub-units yet</span>}
      </span>
    </div>
  );
}
