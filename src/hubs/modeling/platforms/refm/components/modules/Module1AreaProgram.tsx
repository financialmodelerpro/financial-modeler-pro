'use client';

/**
 * Module1AreaProgram.tsx
 *
 * REFM Module 1, Area Program tab (Phase M1.7).
 *
 * Sits between the Hierarchy tab (which manages MH / SubProject / Phase
 * / Asset / SubUnit) and the Land & Area / Costs / Financing tabs. The
 * Area Program tab is where the user defines per-Plot envelope inputs
 * (FAR, coverage, podium / typical floors, landscape / hardscape split,
 * basement parking config) and per-Asset operating strategy + area-
 * cascade overrides.
 *
 * Phase split:
 *   - M1.7/5 (this commit): Plot CRUD + Zone CRUD + per-Asset strategy
 *     selector + area cascade preview pulled from M1.7/2 calc engines.
 *   - M1.7/6: Sub-Unit schedule with parking-bays-per-unit overrides
 *     and the parking allocator readout (surface / vertical / basement
 *     bay counts + deficit warning).
 *
 * Subscribes to useModule1Store directly (store-direct tab pattern from
 * M1.5). All mutations go through store actions, so cascade rules
 * (removePlot drops zones + clears asset.plotId / zoneId) live in one
 * place.
 *
 * Empty states:
 *   - No phase selected: blocks the rest of the UI with a hint to add
 *     a phase via the Hierarchy tab. Mirrors the M1.5/5 onboarding
 *     pattern.
 *   - No plots in the active phase: empty-state card with
 *     "+ Add first Plot" CTA. The form below the card seeds default
 *     plot inputs (DEFAULT_PLOT_FAR / DEFAULT_PLOT_COVERAGE_PCT etc.
 *     from module1-types.ts) so the user can land + tweak in one move.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LandParcel } from '@/src/core/types/project.types';
import {
  computePlotEnvelope, computeAreaCascade,
  computePlotParkingCapacity, allocateParking,
  type PlotEnvelopeAreas, type ParkingAllocationResult, type PlotCapacityResult,
} from '@core/calculations';
import { formatNumber } from '@/src/core/formatters';
import { useModule1Store } from '../../lib/state/module1-store';
import PlotSetupWizard from '../modals/PlotSetupWizard';
import ParcelSetupWizard from '../modals/ParcelSetupWizard';
import InputLabel from '../ui/InputLabel';
import FormulaCaption from '../ui/FormulaCaption';
import { PLOT_FIELD_HELP } from '../../lib/copy/plotFieldHelp';
import { ASSET_STRATEGY_HELP } from '../../lib/copy/assetStrategyHelp';
import { PARCEL_FIELD_HELP } from '../../lib/copy/parcelFieldHelp';
import {
  ASSET_STRATEGIES, DEFAULT_AREA_CASCADE_BY_CATEGORY,
  DEFAULT_PARKING_BAYS_BY_SUBUNIT_TYPE,
  resolveAssetStrategy, resolveAssetCascadePcts, resolveSubUnitParkingBays,
  makeDefaultPlot,
  type Plot, type Zone, type AssetClass, type AssetStrategy, type SubUnit, type AssetCategory,
} from '../../lib/state/module1-types';
import Module1Hierarchy from './Module1Hierarchy';

// ── Tokens (FAST blue convention; matches Module1Hierarchy / Costs / etc.) ──
const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  fontWeight: 'var(--fw-semibold)',
  boxSizing: 'border-box',
  width: '100%',
};

const calcOutputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  fontWeight: 'var(--fw-semibold)',
  boxSizing: 'border-box',
  textAlign: 'right' as const,
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-meta)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
  display: 'block',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--sp-3)',
  marginBottom: 'var(--sp-3)',
};

// M1.13b: small section divider for the inline-formula layout. Sits
// above each input cluster and carries a thin top border so the
// envelope -> podium -> typical -> public area -> parking flow reads
// like a sequence rather than one undifferentiated form.
const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-heading)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '10px 0 6px',
  borderTop: '1px solid var(--color-border)',
  marginTop: 'var(--sp-1)',
};

function SectionHeader({ label, testId }: { label: string; testId?: string }) {
  return <div style={sectionHeaderStyle} data-testid={testId}>{label}</div>;
}

// M1.13b: small grouped grid wrapper. Inputs in a section sit in a
// 2-col or 3-col grid (depending on count); formula captions sit
// below the grid at full width.
const sectionGridStyle = (cols: number): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${cols}, 1fr)`,
  gap: 'var(--sp-2)',
  marginBottom: 'var(--sp-1)',
});

const formulaStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginTop: 6,
  marginBottom: 'var(--sp-2)',
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 14px',
  fontSize: 'var(--font-body)',
  fontWeight: 'var(--fw-semibold)',
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-meta)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  fontSize: 'var(--font-meta)',
  cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-negative)',
  border: '1px solid var(--color-negative)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  fontSize: 'var(--font-micro)',
  cursor: 'pointer',
};

// ── Number formatting helper (sqm with thousands grouping) ────────────────
function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ── Plot row ───────────────────────────────────────────────────────────────
// Subscribe to base arrays + actions separately and derive filtered slices
// via useMemo. Wrapping a `.filter(...)` inside the `useShallow` selector
// would return a fresh array reference on every render, Zustand v5's
// shallow uses Object.is on the OUTER object's top-level values, so a new
// filtered array ref makes the snapshot differ every render, which fires
// React's "getSnapshot should be cached to avoid an infinite loop"
// warning and ultimately throws "Maximum update depth exceeded" once the
// store actually has data (see Module1AreaProgram top-level for the same
// pattern + why it only manifests once plots/zones/assets are non-empty).
function PlotEditor({ plot, allPlotsCount, onOpenWizard }: { plot: Plot; allPlotsCount: number; onOpenWizard: (plotId: string) => void }) {
  const { updatePlot, removePlot, addZone } = useModule1Store(useShallow(s => ({
    updatePlot: s.updatePlot,
    removePlot: s.removePlot,
    addZone:    s.addZone,
  })));
  const allZones      = useModule1Store(s => s.zones);
  const allAssets     = useModule1Store(s => s.assets);
  const zones         = useMemo(() => allZones.filter(z => z.plotId === plot.id), [allZones, plot.id]);
  const assetsOnPlot  = useMemo(() => allAssets.filter(a => a.plotId === plot.id), [allAssets, plot.id]);

  const envelope: PlotEnvelopeAreas = useMemo(() => computePlotEnvelope({
    plotArea: plot.plotArea, maxFAR: plot.maxFAR, coveragePct: plot.coveragePct,
    podiumFloors: plot.podiumFloors, typicalFloors: plot.typicalFloors,
    typicalCoveragePct: plot.typicalCoveragePct,
    landscapePct: plot.landscapePct, hardscapePct: plot.hardscapePct,
    basementCount: plot.basementCount, basementEfficiencyPct: plot.basementEfficiencyPct,
  }), [plot]);

  // M1.10b/5, InputLabel with shared tooltip copy. Wrapper is no longer
  // a <label> (InputLabel renders its own structured label markup), so
  // the input is paired by visual proximity rather than label-htmlFor.
  const numField = (key: keyof Plot, label: string, suffix?: string) => (
    <div style={{ display: 'block' }}>
      <InputLabel
        label={`${label}${suffix ? ` (${suffix})` : ''}`}
        help={PLOT_FIELD_HELP[key as string]}
        inputId={`plot-${plot.id}-${key as string}`}
      />
      <input
        type="number"
        id={`plot-${plot.id}-${key as string}`}
        value={(plot[key] as number) ?? 0}
        onChange={e => updatePlot(plot.id, { [key]: parseFloat(e.target.value) || 0 } as Partial<Plot>)}
        style={inputStyle}
      />
    </div>
  );

  const handleAddZone = () => {
    const nextN = zones.length + 1;
    addZone({ id: `zone_${plot.id}_${Date.now()}`, name: `Zone ${nextN}`, plotId: plot.id });
  };

  const handleDeletePlot = () => {
    const msg = `Delete "${plot.name}"?\n\n` +
      (zones.length > 0      ? `· ${zones.length} zone(s) under it will be dropped.\n` : '') +
      (assetsOnPlot.length > 0 ? `· ${assetsOnPlot.length} asset(s) bound to this plot will lose their plot/zone link (the asset itself stays, you can reassign).\n` : '') +
      `\nThis cannot be undone.`;
    if (window.confirm(msg)) removePlot(plot.id);
  };

  return (
    <div style={{ ...cardStyle, borderLeft: '4px solid var(--color-primary)' }} data-testid={`plot-card-${plot.id}`}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <input
          type="text"
          value={plot.name}
          onChange={e => updatePlot(plot.id, { name: e.target.value })}
          style={{ ...inputStyle, fontSize: 'var(--font-h3)', flex: 1 }}
          aria-label="Plot name"
        />
        {envelope.isOverFAR && (
          <span style={{
            background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)',
            padding: '4px 8px', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-micro)', fontWeight: 'var(--fw-semibold)',
          }}>
            ⚠ Over FAR ({fmt(envelope.utilizationPct, 1)}%)
          </span>
        )}
        <button
          onClick={() => onOpenWizard(plot.id)}
          data-testid={`plot-open-wizard-${plot.id}`}
          style={{
            ...primaryBtnStyle,
            background: 'var(--color-surface)',
            color: 'var(--color-primary)',
            border: '1px solid var(--color-primary)',
          }}
          aria-label={`Open setup wizard for ${plot.name}`}
        >
          🪄 Setup wizard
        </button>
        <button onClick={handleDeletePlot} style={dangerBtnStyle} disabled={allPlotsCount <= 0} aria-label={`Delete ${plot.name}`}>Delete</button>
      </div>

      {/* M1.13b: inputs grouped into 5 ordered sections with formula
         captions sitting directly below the input row that completes
         them. Eliminates the previous "Computed envelope" panel; every
         derived value lives next to its driving inputs.
         Order: Plot Envelope -> Podium -> Typical Tower -> Total Floors
         (check) -> Public Area Split -> Parking. */}

      {/* Section: Plot Envelope */}
      <SectionHeader label="Plot envelope" testId={`section-envelope-${plot.id}`} />
      <div style={sectionGridStyle(2)}>
        {numField('plotArea', 'Plot Buildable Area', 'sqm')}
        {numField('maxFAR',   'Max FAR',             'ratio')}
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-max-gfa-${plot.id}`}
          text={`Max GFA = Plot Area * Max FAR = ${fmt(plot.plotArea)} * ${plot.maxFAR} = ${fmt(envelope.maxGFA)} sqm`}
        />
      </div>

      {/* Section: Podium */}
      <SectionHeader label="Podium" testId={`section-podium-${plot.id}`} />
      <div style={sectionGridStyle(2)}>
        {numField('coveragePct',  'Podium Coverage', '%')}
        {numField('podiumFloors', 'Podium Floors',   '#')}
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-footprint-${plot.id}`}
          text={`Footprint = Plot Area * Podium Coverage = ${fmt(plot.plotArea)} * ${plot.coveragePct}% = ${fmt(envelope.footprint)} sqm`}
        />
        <FormulaCaption
          testId={`formula-podium-gfa-${plot.id}`}
          text={`Podium GFA = Footprint * Podium Floors = ${fmt(envelope.footprint)} * ${plot.podiumFloors} = ${fmt(envelope.podiumGFA)} sqm`}
        />
        <FormulaCaption
          testId={`formula-public-area-${plot.id}`}
          text={`Public Area = Plot Area - Footprint = ${fmt(plot.plotArea)} - ${fmt(envelope.footprint)} = ${fmt(envelope.publicArea)} sqm`}
        />
      </div>

      {/* Section: Typical Tower */}
      <SectionHeader label="Typical tower" testId={`section-typical-${plot.id}`} />
      <div style={sectionGridStyle(2)}>
        {numField('typicalCoveragePct', 'Typical Coverage', '%')}
        {numField('typicalFloors',      'Typical Floors',   '#')}
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-typical-gfa-${plot.id}`}
          text={`Typical GFA = Plot Area * Typical Coverage * Typical Floors = ${fmt(plot.plotArea)} * ${plot.typicalCoveragePct}% * ${plot.typicalFloors} = ${fmt(envelope.typicalGFA)} sqm`}
        />
        <FormulaCaption
          testId={`formula-total-built-${plot.id}`}
          text={`Total Built GFA = Podium GFA + Typical GFA = ${fmt(envelope.podiumGFA)} + ${fmt(envelope.typicalGFA)} = ${fmt(envelope.totalBuiltGFA)} sqm (utilization ${fmt(envelope.utilizationPct, 1)}% of Max GFA)`}
        />
      </div>

      {/* Section: Total Floors check (informational, not a calc input
         in the envelope chain; kept so users can sanity-check
         podium + typical against total). */}
      <SectionHeader label="Floors check" testId={`section-floors-check-${plot.id}`} />
      <div style={sectionGridStyle(2)}>
        {numField('numberOfFloors', 'Total Floors', '#')}
        <div />
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-floors-check-${plot.id}`}
          text={`Sanity check: Podium Floors + Typical Floors = ${plot.podiumFloors} + ${plot.typicalFloors} = ${plot.podiumFloors + plot.typicalFloors} floors${plot.numberOfFloors !== plot.podiumFloors + plot.typicalFloors ? ` (does not match Total Floors ${plot.numberOfFloors})` : ' (matches Total Floors)'}`}
        />
      </div>

      {/* Section: Public area split */}
      <SectionHeader label="Public area split" testId={`section-public-area-${plot.id}`} />
      <div style={sectionGridStyle(2)}>
        {numField('landscapePct', 'Landscape', '% public')}
        {numField('hardscapePct', 'Hardscape', '% public')}
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-landscape-${plot.id}`}
          text={`Landscape Area = Public Area * Landscape % = ${fmt(envelope.publicArea)} * ${plot.landscapePct}% = ${fmt(envelope.landscapeArea)} sqm`}
        />
        <FormulaCaption
          testId={`formula-hardscape-${plot.id}`}
          text={`Hardscape Area = Public Area * Hardscape % = ${fmt(envelope.publicArea)} * ${plot.hardscapePct}% = ${fmt(envelope.hardscapeArea)} sqm`}
        />
        <FormulaCaption
          testId={`formula-surface-parking-${plot.id}`}
          text={`Surface Parking = Public Area - Landscape - Hardscape = ${fmt(envelope.publicArea)} - ${fmt(envelope.landscapeArea)} - ${fmt(envelope.hardscapeArea)} = ${fmt(envelope.surfaceParkingArea)} sqm`}
        />
      </div>

      {/* Section: Parking, three sub-clusters (surface / vertical /
         basement). Each sub-cluster's formulas sit immediately below
         the inputs that complete its capacity calculation. */}
      <SectionHeader label="Parking, surface" testId={`section-parking-surface-${plot.id}`} />
      <div style={sectionGridStyle(2)}>
        {numField('surfaceBaySqm', 'Surface Bay', 'sqm')}
        <div />
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-surface-capacity-${plot.id}`}
          text={`Surface Capacity = Surface Parking / Surface Bay = ${fmt(envelope.surfaceParkingArea)} / ${plot.surfaceBaySqm} = ${fmt(Math.floor(envelope.surfaceParkingArea / Math.max(1, plot.surfaceBaySqm)))} bays`}
        />
      </div>

      <SectionHeader label="Parking, vertical" testId={`section-parking-vertical-${plot.id}`} />
      <div style={sectionGridStyle(2)}>
        {numField('verticalBaySqm', 'Vertical Bay', 'sqm')}
        <div style={{ display: 'block' }}>
          <InputLabel
            label="Vertical Parking Floors (#)"
            help={PLOT_FIELD_HELP.verticalParkingFloors}
            inputId={`plot-${plot.id}-verticalParkingFloors`}
          />
          <input
            type="number"
            id={`plot-${plot.id}-verticalParkingFloors`}
            value={plot.verticalParkingFloors ?? 0}
            onChange={e => updatePlot(plot.id, { verticalParkingFloors: parseFloat(e.target.value) || 0 })}
            style={inputStyle}
          />
        </div>
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-vertical-capacity-${plot.id}`}
          text={`Vertical Capacity = Footprint * Vertical Floors / Vertical Bay = ${fmt(envelope.footprint)} * ${plot.verticalParkingFloors ?? 0} / ${plot.verticalBaySqm} = ${fmt(Math.floor((envelope.footprint * (plot.verticalParkingFloors ?? 0)) / Math.max(1, plot.verticalBaySqm)))} bays`}
        />
      </div>

      <SectionHeader label="Parking, basement" testId={`section-parking-basement-${plot.id}`} />
      <div style={sectionGridStyle(3)}>
        {numField('basementBaySqm',         'Basement Bay',        'sqm')}
        {numField('basementCount',          'Basement Count',      '#')}
        {numField('basementEfficiencyPct',  'Basement Efficiency', '%')}
      </div>
      <div style={formulaStackStyle}>
        <FormulaCaption
          testId={`formula-basement-usable-${plot.id}`}
          text={`Basement Usable = Footprint * Basement Count * Basement Efficiency = ${fmt(envelope.footprint)} * ${plot.basementCount} * ${plot.basementEfficiencyPct}% = ${fmt(envelope.basementUsableArea)} sqm`}
        />
        <FormulaCaption
          testId={`formula-basement-capacity-${plot.id}`}
          text={`Basement Capacity = Basement Usable / Basement Bay = ${fmt(envelope.basementUsableArea)} / ${plot.basementBaySqm} = ${fmt(Math.floor(envelope.basementUsableArea / Math.max(1, plot.basementBaySqm)))} bays`}
        />
      </div>

      {/* Allocator summary, separate from envelope inputs because it
         depends on sub-units (which live below this card). Stays as a
         compact summary panel showing Required vs. Allocated bay flow. */}
      <ParkingSummary plot={plot} envelope={envelope} />


      {/* Zones */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
          <h4 style={{ margin: 0, fontSize: 'var(--font-h4)' }}>Zones</h4>
          <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>(optional sub-divisions)</span>
          <button onClick={handleAddZone} style={{ ...ghostBtnStyle, marginLeft: 'auto' }}>+ Add Zone</button>
        </div>
        {zones.length === 0 ? (
          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', fontStyle: 'italic' }}>
            No zones. Add one to label sub-divisions of this plot (e.g. "1A Residential", "1B Mixed").
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            {zones.map(z => <ZoneRow key={z.id} zone={z} />)}
          </div>
        )}
      </div>

      {/* Assets bound to this plot */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
          <h4 style={{ margin: 0, fontSize: 'var(--font-h4)' }}>Assets on this plot</h4>
          <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
            ({assetsOnPlot.length} of {plot.id})
          </span>
        </div>
        {assetsOnPlot.length === 0 ? (
          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', fontStyle: 'italic' }}>
            No assets are bound to this plot yet. Use the picker below to assign existing assets, or add new ones via the Hierarchy tab.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            {assetsOnPlot.map(a => <AssetStrategyRow key={a.id} asset={a} envelope={envelope} plotAssetCount={assetsOnPlot.length} totalAllocPctOnPlot={assetsOnPlot.reduce((s, x) => s + (x.allocationPct > 0 ? x.allocationPct : 0), 0)} />)}
          </div>
        )}
        <AssetAssignPicker plotId={plot.id} />
      </div>
    </div>
  );
}

// ── Zone row ──────────────────────────────────────────────────────────────
function ZoneRow({ zone }: { zone: Zone }) {
  const { updateZone, removeZone, assetCount } = useModule1Store(useShallow(s => ({
    updateZone: s.updateZone,
    removeZone: s.removeZone,
    assetCount: s.assets.filter(a => a.zoneId === zone.id).length,
  })));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 'var(--sp-2)', alignItems: 'center' }} data-testid={`zone-row-${zone.id}`}>
      <input
        type="text"
        value={zone.name}
        onChange={e => updateZone(zone.id, { name: e.target.value })}
        style={inputStyle}
        aria-label="Zone name"
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>Area share %</span>
        <input
          type="number"
          value={zone.areaSharePct ?? ''}
          onChange={e => {
            const v = e.target.value;
            updateZone(zone.id, { areaSharePct: v === '' ? undefined : parseFloat(v) || 0 });
          }}
          placeholder="auto"
          style={{ ...inputStyle, width: 80 }}
        />
      </label>
      <button
        onClick={() => {
          const msg = assetCount > 0
            ? `Delete "${zone.name}"?\n\n${assetCount} asset(s) point at this zone, they will keep their plot binding but lose the zone label.`
            : `Delete "${zone.name}"?`;
          if (window.confirm(msg)) removeZone(zone.id);
        }}
        style={dangerBtnStyle}
        aria-label={`Delete ${zone.name}`}
      >Delete</button>
    </div>
  );
}

// ── Asset strategy row ─────────────────────────────────────────────────────
function AssetStrategyRow({ asset, envelope, plotAssetCount, totalAllocPctOnPlot }: {
  asset: AssetClass; envelope: PlotEnvelopeAreas; plotAssetCount: number; totalAllocPctOnPlot: number;
}) {
  const updateAsset = useModule1Store(s => s.updateAsset);
  const allZones    = useModule1Store(s => s.zones);
  const zonesForPlot = useMemo(
    () => allZones.filter(z => z.plotId === (asset.plotId ?? '')),
    [allZones, asset.plotId],
  );

  const effectivePrimary = resolveAssetStrategy(asset);
  const cascadePcts = resolveAssetCascadePcts(asset);
  const gfaShare = asset.gfaOverrideSqm !== undefined
    ? Math.max(0, asset.gfaOverrideSqm)
    : (totalAllocPctOnPlot > 0
        ? envelope.totalBuiltGFA * ((asset.allocationPct > 0 ? asset.allocationPct : 0) / totalAllocPctOnPlot)
        : envelope.totalBuiltGFA / Math.max(1, plotAssetCount));
  const cascade = computeAreaCascade({ gfa: gfaShare, ...cascadePcts, efficiencyPct: asset.efficiencyPct });
  const def = DEFAULT_AREA_CASCADE_BY_CATEGORY[asset.category];

  return (
    <div style={{
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
      padding: 'var(--sp-2) var(--sp-3)',
    }} data-testid={`asset-strategy-${asset.id}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <strong style={{ fontSize: 'var(--font-body)' }}>{asset.name}</strong>
        <span style={{
          fontSize: 'var(--font-micro)', color: 'var(--color-meta)',
          background: 'var(--color-grey-pale)', padding: '2px 8px', borderRadius: 4,
        }}>{asset.category} · {asset.type}</span>
      </div>

      {/* Strategy + zone + GFA. M1.11/M2 wraps every label in InputLabel
         with plain-English help so first-time users understand the
         revenue consequence of each choice. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <div>
          <InputLabel
            label="Primary strategy"
            help={ASSET_STRATEGY_HELP.primaryStrategy}
            inputId={`asset-${asset.id}-primaryStrategy`}
          />
          <select
            id={`asset-${asset.id}-primaryStrategy`}
            value={effectivePrimary}
            onChange={e => updateAsset(asset.id, { primaryStrategy: e.target.value as AssetStrategy })}
            style={inputStyle}
          >
            {ASSET_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <InputLabel
            label="Primary %"
            help={ASSET_STRATEGY_HELP.primaryStrategyPct}
            inputId={`asset-${asset.id}-primaryStrategyPct`}
          />
          <input
            id={`asset-${asset.id}-primaryStrategyPct`}
            type="number"
            value={asset.primaryStrategyPct ?? 100}
            onChange={e => updateAsset(asset.id, { primaryStrategyPct: parseFloat(e.target.value) || 0 })}
            style={inputStyle}
          />
        </div>
        <div>
          <InputLabel
            label="Secondary strategy"
            help={ASSET_STRATEGY_HELP.secondaryStrategy}
            inputId={`asset-${asset.id}-secondaryStrategy`}
          />
          <select
            id={`asset-${asset.id}-secondaryStrategy`}
            value={asset.secondaryStrategy ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { secondaryStrategy: v === '' ? undefined : v as AssetStrategy });
            }}
            style={inputStyle}
          >
            <option value="">(none)</option>
            {ASSET_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <InputLabel
            label="Secondary %"
            help={ASSET_STRATEGY_HELP.secondaryStrategyPct}
            inputId={`asset-${asset.id}-secondaryStrategyPct`}
          />
          <input
            id={`asset-${asset.id}-secondaryStrategyPct`}
            type="number"
            value={asset.secondaryStrategyPct ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { secondaryStrategyPct: v === '' ? undefined : parseFloat(v) || 0 });
            }}
            placeholder="(blank if 100)"
            style={inputStyle}
            disabled={asset.secondaryStrategy === undefined}
          />
        </div>
      </div>

      {/* Zone + GFA override + cascade pcts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <div>
          <InputLabel
            label="Zone"
            help={ASSET_STRATEGY_HELP.zone}
            inputId={`asset-${asset.id}-zoneId`}
          />
          <select
            id={`asset-${asset.id}-zoneId`}
            value={asset.zoneId ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { zoneId: v === '' ? undefined : v });
            }}
            style={inputStyle}
          >
            <option value="">(no zone)</option>
            {zonesForPlot.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div>
          <InputLabel
            label="GFA override (sqm)"
            help={ASSET_STRATEGY_HELP.gfaOverride}
            inputId={`asset-${asset.id}-gfaOverride`}
          />
          <input
            id={`asset-${asset.id}-gfaOverride`}
            type="number"
            value={asset.gfaOverrideSqm ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { gfaOverrideSqm: v === '' ? undefined : parseFloat(v) || 0 });
            }}
            placeholder={`pro-rata ${fmt(gfaShare)}`}
            style={inputStyle}
          />
        </div>
        <label>
          <span style={labelStyle}>MEP % (default {def.mepPct}%)</span>
          <input
            type="number"
            value={asset.mepPct ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { mepPct: v === '' ? undefined : parseFloat(v) || 0 });
            }}
            placeholder={String(def.mepPct)}
            style={inputStyle}
          />
        </label>
        <label>
          <span style={labelStyle}>BoH % (default {def.backOfHousePct}%)</span>
          <input
            type="number"
            value={asset.backOfHousePct ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { backOfHousePct: v === '' ? undefined : parseFloat(v) || 0 });
            }}
            placeholder={String(def.backOfHousePct)}
            style={inputStyle}
          />
        </label>
      </div>

      {/* M1.13b: cascade output formulas inline. The "Cascade preview"
         panel is dissolved; outputs render as a stack of formula
         captions immediately under the MEP / BoH / Efficiency inputs
         that drive them. GFA is the upstream input (override or pro-
         rata), then MEP and BoH each compute their share, then Net
         GFA, BUA Excl, TBA, and GSA / GLA roll up. */}
      {(() => {
        const mepPctEff = cascadePcts.mepPct;
        const bohPctEff = cascadePcts.backOfHousePct;
        const otherPctEff = cascadePcts.otherTechnicalPct;
        const effPctEff = asset.efficiencyPct ?? 80;
        return (
          <div
            style={{ ...formulaStackStyle, marginBottom: 'var(--sp-2)' }}
            data-testid={`cascade-formulas-${asset.id}`}
          >
            <FormulaCaption
              testId={`formula-cascade-gfa-${asset.id}`}
              text={asset.gfaOverrideSqm !== undefined
                ? `GFA = manual override = ${fmt(cascade.gfa)} sqm`
                : `GFA = Total Built GFA / asset count = ${fmt(envelope.totalBuiltGFA)} / ${plotAssetCount} = ${fmt(cascade.gfa)} sqm`}
            />
            <FormulaCaption
              testId={`formula-cascade-mep-${asset.id}`}
              text={`MEP = GFA * MEP % = ${fmt(cascade.gfa)} * ${mepPctEff}% = ${fmt(cascade.mep)} sqm`}
            />
            <FormulaCaption
              testId={`formula-cascade-boh-${asset.id}`}
              text={`Back-of-House = GFA * BoH % = ${fmt(cascade.gfa)} * ${bohPctEff}% = ${fmt(cascade.backOfHouse)} sqm`}
            />
            <FormulaCaption
              testId={`formula-cascade-other-${asset.id}`}
              text={`Other Tech = GFA * Other Tech % = ${fmt(cascade.gfa)} * ${otherPctEff}% = ${fmt(cascade.otherTechnical)} sqm`}
            />
            <FormulaCaption
              testId={`formula-cascade-net-${asset.id}`}
              text={`Net GFA = GFA - MEP - BoH - Other = ${fmt(cascade.gfa)} - ${fmt(cascade.mep)} - ${fmt(cascade.backOfHouse)} - ${fmt(cascade.otherTechnical)} = ${fmt(cascade.netGFA)} sqm`}
            />
            <FormulaCaption
              testId={`formula-cascade-gsa-${asset.id}`}
              text={`GSA / GLA = Net GFA * Efficiency = ${fmt(cascade.netGFA)} * ${effPctEff}% = ${fmt(cascade.gsaGla)} sqm`}
            />
            <FormulaCaption
              testId={`formula-cascade-bua-${asset.id}`}
              text={`BUA Excl = GFA + BoH + Other = ${fmt(cascade.gfa)} + ${fmt(cascade.backOfHouse)} + ${fmt(cascade.otherTechnical)} = ${fmt(cascade.buaExcl)} sqm`}
            />
            <FormulaCaption
              testId={`formula-cascade-tba-${asset.id}`}
              text={`TBA = BUA Excl + MEP + Basement Share = ${fmt(cascade.buaExcl)} + ${fmt(cascade.mep)} + 0 = ${fmt(cascade.tba)} sqm`}
            />
          </div>
        );
      })()}

      <SubUnitTable assetId={asset.id} category={asset.category} />
    </div>
  );
}

// ── Asset assignment picker (assets in this phase that are NOT yet on a plot) ──
function AssetAssignPicker({ plotId }: { plotId: string }) {
  const updateAsset = useModule1Store(s => s.updateAsset);
  const allAssets   = useModule1Store(s => s.assets);
  const allPlots    = useModule1Store(s => s.plots);
  const unassignedAssets = useMemo(() => {
    const plot = allPlots.find(p => p.id === plotId);
    if (!plot) return [];
    return allAssets.filter(a => a.plotId === undefined && a.phaseId === plot.phaseId);
  }, [allAssets, allPlots, plotId]);

  const [pick, setPick] = useState<string>('');

  if (unassignedAssets.length === 0) return null;

  return (
    <div style={{ marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <select value={pick} onChange={e => setPick(e.target.value)} style={{ ...inputStyle, maxWidth: 300 }}>
        <option value="">+ Assign an existing asset to this plot…</option>
        {unassignedAssets.map(a => <option key={a.id} value={a.id}>{a.name} ({a.category})</option>)}
      </select>
      <button
        onClick={() => {
          if (pick) { updateAsset(pick, { plotId }); setPick(''); }
        }}
        style={primaryBtnStyle}
        disabled={!pick}
      >Assign</button>
    </div>
  );
}

// ── Sub-Unit table (per asset) ─────────────────────────────────────────────
// Editable schedule of dwellings / keys / GLA blocks beneath an asset.
// Each row contributes parking demand via resolveSubUnitParkingBays.
// `name` is freeform but seeded from category-specific suggestions
// (Studio / 1BR / 2BR / 3BR for Sell + Hybrid; Hotel Key / Serviced
// Apartment for Operate; Office / Retail for Lease) so the parking
// ratio default lookup hits a known row.
function SubUnitTable({ assetId, category }: { assetId: string; category: AssetCategory }) {
  const { addSubUnit, updateSubUnit, removeSubUnit } = useModule1Store(useShallow(s => ({
    addSubUnit:    s.addSubUnit,
    updateSubUnit: s.updateSubUnit,
    removeSubUnit: s.removeSubUnit,
  })));
  const allSubUnits = useModule1Store(s => s.subUnits);
  const subUnits = useMemo(() => allSubUnits.filter(u => u.assetId === assetId), [allSubUnits, assetId]);

  const suggestions = SUBUNIT_SUGGESTIONS_BY_CATEGORY[category];
  const defaultMetric: SubUnit['metric'] = category === 'Lease' ? 'area' : 'count';

  const handleAdd = () => {
    const seed = suggestions[subUnits.length % suggestions.length] ?? 'Type 1';
    addSubUnit({
      id: `su_${assetId}_${Date.now()}`,
      assetId,
      name: seed,
      metric: defaultMetric,
      metricValue: 0,
      unitPrice: 0,
    });
  };

  return (
    <div data-testid={`subunit-table-${assetId}`}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <h5 style={{ margin: 0, fontSize: 'var(--font-h5, var(--font-h4))' }}>Sub-Units</h5>
        <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
          ({subUnits.length}{subUnits.length > 0 ? ` · ${fmt(subUnits.reduce((s, u) => s + resolveSubUnitParkingBays(u), 0))} bays demanded` : ''})
        </span>
        <button onClick={handleAdd} style={{ ...ghostBtnStyle, marginLeft: 'auto' }} data-testid={`add-subunit-${assetId}`}>+ Add Sub-Unit</button>
      </div>
      {subUnits.length === 0 ? (
        <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', fontStyle: 'italic', marginBottom: 'var(--sp-2)' }}>
          No sub-units yet. Add one to drive parking demand and revenue inputs (M2 will read the schedule).
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
              <th style={{ padding: '4px 8px' }}>Type</th>
              <th style={{ padding: '4px 8px' }}>Metric</th>
              <th style={{ padding: '4px 8px' }}>Quantity</th>
              <th style={{ padding: '4px 8px' }}>Parking / Unit</th>
              <th style={{ padding: '4px 8px' }}>Bays Demanded</th>
              <th style={{ padding: '4px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {subUnits.map(u => {
              const defaultRatio = DEFAULT_PARKING_BAYS_BY_SUBUNIT_TYPE[u.name];
              const baysDemanded = resolveSubUnitParkingBays(u);
              return (
                <tr key={u.id} data-testid={`subunit-row-${u.id}`}>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="text"
                      list={`subunit-types-${category}`}
                      value={u.name}
                      onChange={e => updateSubUnit(u.id, { name: e.target.value })}
                      style={{ ...inputStyle, minWidth: 140 }}
                      aria-label="Sub-unit type"
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <select
                      value={u.metric}
                      onChange={e => updateSubUnit(u.id, { metric: e.target.value as SubUnit['metric'] })}
                      style={{ ...inputStyle, width: 90 }}
                    >
                      <option value="count">count</option>
                      <option value="area">area (sqm)</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="number"
                      value={u.metricValue}
                      onChange={e => updateSubUnit(u.id, { metricValue: parseFloat(e.target.value) || 0 })}
                      style={{ ...inputStyle, width: 100 }}
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="number"
                      value={u.parkingBaysPerUnit ?? ''}
                      onChange={e => {
                        const v = e.target.value;
                        updateSubUnit(u.id, { parkingBaysPerUnit: v === '' ? undefined : parseFloat(v) || 0 });
                      }}
                      placeholder={defaultRatio !== undefined ? `default ${defaultRatio}` : 'default 1.0'}
                      style={{ ...inputStyle, width: 110 }}
                      step="0.1"
                    />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <span style={{ ...calcOutputStyle, display: 'inline-block', minWidth: 90 }}>{fmt(baysDemanded, 1)}</span>
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <button
                      onClick={() => removeSubUnit(u.id)}
                      style={dangerBtnStyle}
                      aria-label={`Delete ${u.name}`}
                    >×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {/* datalist providing type suggestions for the category */}
      <datalist id={`subunit-types-${category}`}>
        {suggestions.map(s => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

const SUBUNIT_SUGGESTIONS_BY_CATEGORY: Record<AssetCategory, string[]> = {
  Sell:    ['Studio', '1BR', '2BR', '3BR', 'Apartments Type 1', 'Apartments Type 2', 'Apartments Type 3', 'Branded Residences'],
  Operate: ['Hotel Key', 'Serviced Apartment'],
  Lease:   ['Office', 'Retail'],
  Hybrid:  ['Studio', '1BR', '2BR', 'Office', 'Retail'],
};

// ── Parking summary card (per plot) ────────────────────────────────────────
// Live-aggregates parking demand from every sub-unit on every asset
// bound to the plot, runs the same waterfall allocator the M1.7/4
// pipeline uses, and renders capacity vs. allocated vs. deficit.
function ParkingSummary({ plot, envelope }: { plot: Plot; envelope: PlotEnvelopeAreas }) {
  const allAssets   = useModule1Store(s => s.assets);
  const allSubUnits = useModule1Store(s => s.subUnits);
  const plotAssets = useMemo(
    () => allAssets.filter(a => a.plotId === plot.id),
    [allAssets, plot.id],
  );
  const subUnitsByAsset = useMemo(() => {
    const byAsset: Record<string, SubUnit[]> = {};
    for (const a of plotAssets) byAsset[a.id] = allSubUnits.filter(u => u.assetId === a.id);
    return byAsset;
  }, [plotAssets, allSubUnits]);

  const totalBaysRequired = plotAssets.reduce(
    (s, a) => s + (subUnitsByAsset[a.id]?.reduce((b, u) => b + resolveSubUnitParkingBays(u), 0) ?? 0),
    0,
  );
  const capacity: PlotCapacityResult = computePlotParkingCapacity({
    envelope,
    surfaceBaySqm:         plot.surfaceBaySqm,
    verticalBaySqm:        plot.verticalBaySqm,
    basementBaySqm:        plot.basementBaySqm,
    verticalParkingFloors: plot.verticalParkingFloors ?? 0,
  });
  const alloc: ParkingAllocationResult = allocateParking({
    totalBaysRequired,
    surfaceCapacityBays:  capacity.surfaceCapacityBays,
    verticalCapacityBays: capacity.verticalCapacityBays,
    basementCapacityBays: capacity.basementCapacityBays,
  });

  return (
    <div
      style={{
        background: alloc.deficit > 0 ? 'var(--color-negative-bg, var(--color-grey-pale))' : 'var(--color-grey-pale)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2) var(--sp-3)', marginBottom: 'var(--sp-3)',
        border: alloc.deficit > 0 ? '1px solid var(--color-negative)' : '1px solid var(--color-border)',
      }}
      data-testid={`parking-summary-${plot.id}`}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <span style={labelStyle}>Parking</span>
        {alloc.deficit > 0 && (
          <span style={{
            background: 'var(--color-negative)', color: 'var(--color-on-negative, white)',
            padding: '2px 8px', borderRadius: 4, fontSize: 'var(--font-micro)', fontWeight: 'var(--fw-semibold)',
          }} data-testid={`parking-deficit-${plot.id}`}>
            ⚠ Deficit: {fmt(alloc.deficit)} bays
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--sp-2)', alignItems: 'end' }}>
        <ParkingCell label="Required (sub-units)" value={totalBaysRequired}
          formula={`Sum of bays demanded across every Sub-Unit on this plot = ${fmt(totalBaysRequired)} bays`} />
        <ParkingCell label="Surface" value={alloc.surfaceBays} cap={capacity.surfaceCapacityBays}
          formula={`Surface Parking / Surface Bay = ${fmt(envelope.surfaceParkingArea)} / ${plot.surfaceBaySqm} = ${fmt(capacity.surfaceCapacityBays)} bay capacity, ${fmt(alloc.surfaceBays)} allocated`} />
        <ParkingCell label="Vertical" value={alloc.verticalBays} cap={capacity.verticalCapacityBays}
          formula={`Footprint * Vertical Floors / Vertical Bay = ${fmt(envelope.footprint)} * ${plot.verticalParkingFloors ?? 0} / ${plot.verticalBaySqm} = ${fmt(capacity.verticalCapacityBays)} bay capacity, ${fmt(alloc.verticalBays)} allocated`} />
        <ParkingCell label="Basement" value={alloc.basementBays} cap={capacity.basementCapacityBays}
          formula={`Basement Usable / Basement Bay = ${fmt(envelope.basementUsableArea)} / ${plot.basementBaySqm} = ${fmt(capacity.basementCapacityBays)} bay capacity, ${fmt(alloc.basementBays)} allocated`} />
        <ParkingCell label="Total Allocated" value={alloc.totalAllocated}
          formula={`Surface + Vertical + Basement = ${fmt(alloc.surfaceBays)} + ${fmt(alloc.verticalBays)} + ${fmt(alloc.basementBays)} = ${fmt(alloc.totalAllocated)} bays${alloc.deficit > 0 ? ` (deficit ${fmt(alloc.deficit)} vs ${fmt(totalBaysRequired)} required)` : ''}`} />
      </div>
    </div>
  );
}

function ParkingCell({ label, value, cap, formula }: { label: string; value: number; cap?: number; formula?: string }) {
  return (
    <div data-testid={`parking-cell-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
      <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>{label}</span>
      <div style={{ ...calcOutputStyle, textAlign: 'left' }}>
        {fmt(value)}{cap !== undefined ? <span style={{ color: 'var(--color-meta)', fontWeight: 'var(--fw-normal)', marginLeft: 4 }}>/ {fmt(cap)}</span> : null}
      </div>
      {formula && <FormulaCaption text={formula} />}
    </div>
  );
}

// ── Land Parcels block (M1.12) ─────────────────────────────────────────────
// Lifted from the dissolved Land tab into Build Program (top section,
// above the Plot list). Edits flow through Zustand setLand directly so
// the wizard create flow + ParcelSetupWizard + this inline editor share
// one update path.
//
// Renders a compact parcel table with name / area / rate / cash% /
// in-kind% inputs + per-row totals + a tfoot summary row. Header cells
// use the FAST contrast convention (navy bg + white text + uppercase
// label) so the column titles stay readable in both light and dark mode.
function LandParcelsBlock({ landParcels, currency, readOnly }: {
  landParcels: LandParcel[];
  currency: string;
  readOnly: boolean;
}) {
  const setLand = useModule1Store(s => s.setLand);
  const [parcelWizardOpen, setParcelWizardOpen] = useState(false);

  const totalArea  = landParcels.reduce((s, p) => s + (Number(p.area) || 0), 0);
  const totalValue = landParcels.reduce((s, p) => s + p.area * p.rate, 0);
  const cashValue  = landParcels.reduce((s, p) => s + p.area * p.rate * (p.cashPct / 100), 0);
  const cashPct    = totalValue > 0 ? (cashValue / totalValue) * 100 : 0;

  const addParcel = () => {
    const newId = (landParcels.length === 0 ? 1 : Math.max(...landParcels.map(p => p.id)) + 1);
    setLand({ landParcels: [
      ...landParcels,
      { id: newId, name: `Land ${newId}`, area: 0, rate: 0, cashPct: 60, inKindPct: 40 },
    ] });
  };
  const updateParcel = (id: number, field: keyof LandParcel, value: string | number) => {
    setLand({ landParcels: landParcels.map(p => {
      if (p.id !== id) return p;
      const next = { ...p, [field]: value };
      if (field === 'cashPct')   next.inKindPct = 100 - Number(value);
      if (field === 'inKindPct') next.cashPct   = 100 - Number(value);
      return next;
    }) });
  };
  const removeParcel = (id: number) => {
    if (landParcels.length <= 1) return;
    setLand({ landParcels: landParcels.filter(p => p.id !== id) });
  };

  return (
    <div data-testid="build-program-land-parcels" style={{ ...cardStyle }}>
      {parcelWizardOpen && <ParcelSetupWizard onClose={() => setParcelWizardOpen(false)} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{
          fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)',
          color: 'var(--color-heading)', margin: 0,
        }}>
          🏞️ Land Parcels (financial, what you own)
        </h3>
        {!readOnly && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setParcelWizardOpen(true)}
              data-testid="bp-open-parcel-wizard"
              style={{
                fontSize: 'var(--font-meta)', padding: '5px 12px',
                border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-sm)',
                background: 'var(--color-surface)', color: 'var(--color-primary)',
                cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontWeight: 'var(--fw-semibold)',
              }}
            >
              🪄 Setup wizard
            </button>
            <button
              type="button"
              onClick={addParcel}
              data-testid="bp-add-parcel"
              style={{ ...primaryBtnStyle, fontSize: 'var(--font-meta)', padding: '5px 12px' }}
            >
              + Add Parcel
            </button>
          </div>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table-standard" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={parcelHeaderStyle}>
                <InputLabel label="Parcel Name" help={PARCEL_FIELD_HELP.name} textStyle={parcelHeaderLabelStyle} />
              </th>
              <th style={parcelHeaderStyle}>
                <InputLabel label="Area (sqm)" help={PARCEL_FIELD_HELP.area} textStyle={parcelHeaderLabelStyle} />
              </th>
              <th style={parcelHeaderStyle}>
                <InputLabel label={`Rate (per sqm, ${currency})`} help={PARCEL_FIELD_HELP.rate} textStyle={parcelHeaderLabelStyle} />
              </th>
              <th style={parcelHeaderStyle}>Total Value</th>
              <th style={parcelHeaderStyle}>
                <InputLabel label="Cash %" help={PARCEL_FIELD_HELP.cashPct} textStyle={parcelHeaderLabelStyle} />
              </th>
              <th style={parcelHeaderStyle}>
                <InputLabel label="In-Kind %" help={PARCEL_FIELD_HELP.inKindPct} textStyle={parcelHeaderLabelStyle} />
              </th>
              {!readOnly && <th style={parcelHeaderStyle}>Del</th>}
            </tr>
          </thead>
          <tbody>
            {landParcels.map(p => {
              const total = p.area * p.rate;
              return (
                <tr key={p.id} data-testid={`bp-parcel-row-${p.id}`}>
                  <td>
                    <input
                      type="text"
                      value={p.name}
                      onChange={e => updateParcel(p.id, 'name', e.target.value)}
                      disabled={readOnly}
                      style={{ ...inputStyle, minWidth: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={p.area}
                      onChange={e => updateParcel(p.id, 'area', Number(e.target.value))}
                      disabled={readOnly}
                      style={{ ...inputStyle, textAlign: 'right' }}
                      data-testid={`bp-parcel-${p.id}-area`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={p.rate}
                      onChange={e => updateParcel(p.id, 'rate', Number(e.target.value))}
                      disabled={readOnly}
                      style={{ ...inputStyle, textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ ...calcOutputStyle }}>{formatNumber(total)}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={p.cashPct}
                      onChange={e => updateParcel(p.id, 'cashPct', Number(e.target.value))}
                      disabled={readOnly}
                      style={{ ...inputStyle, textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={p.inKindPct}
                      onChange={e => updateParcel(p.id, 'inKindPct', Number(e.target.value))}
                      disabled={readOnly}
                      style={{ ...inputStyle, textAlign: 'right' }}
                    />
                  </td>
                  {!readOnly && (
                    <td>
                      <button
                        type="button"
                        onClick={() => removeParcel(p.id)}
                        disabled={landParcels.length <= 1}
                        aria-label={`Remove ${p.name}`}
                        style={{
                          padding: '3px 8px', fontSize: 'var(--font-meta)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-surface)',
                          color: landParcels.length <= 1 ? 'var(--color-meta)' : 'var(--color-negative)',
                          cursor: landParcels.length <= 1 ? 'not-allowed' : 'pointer',
                        }}
                        data-testid={`bp-parcel-${p.id}-remove`}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--color-grey-pale)' }}>
              <td style={{ fontWeight: 'var(--fw-bold)' }}>TOTAL</td>
              <td style={{ ...calcOutputStyle }}>{formatNumber(totalArea)}</td>
              <td style={{ color: 'var(--color-meta)', textAlign: 'right' }}>
                {totalArea > 0 ? `${formatNumber(totalValue / totalArea)}/sqm` : ''}
              </td>
              <td style={{ ...calcOutputStyle }}>{formatNumber(totalValue)}</td>
              <td style={{ ...calcOutputStyle }}>{cashPct.toFixed(1)}%</td>
              <td style={{ ...calcOutputStyle }}>{(100 - cashPct).toFixed(1)}%</td>
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* M1.13/2: plain-English totals formulas. Sit under the table so
         the reader sees how the tfoot row was assembled from per-parcel
         inputs. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
        <FormulaCaption
          testId="parcel-formula-area"
          text={`Total Area = sum of parcel areas = ${formatNumber(totalArea)} sqm`}
        />
        <FormulaCaption
          testId="parcel-formula-value"
          text={`Total Value = sum of (Area * Rate) = ${formatNumber(totalValue)} ${currency}${totalArea > 0 ? ` (weighted ${formatNumber(totalValue / totalArea)} ${currency} per sqm)` : ''}`}
        />
        <FormulaCaption
          testId="parcel-formula-cash"
          text={`Weighted Cash % = Cash Value / Total Value * 100 = ${formatNumber(cashValue)} / ${formatNumber(totalValue)} * 100 = ${cashPct.toFixed(1)}%`}
        />
      </div>
    </div>
  );
}

const parcelHeaderStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-on-primary-navy)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--color-border)',
};

// White-on-navy variant of InputLabel's label so the FAST header
// contrast carries through to the embedded ⓘ help button.
const parcelHeaderLabelStyle: React.CSSProperties = {
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-on-primary-navy)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

// ── Top-level component ───────────────────────────────────────────────────
// Subscribe to base arrays + scalars + actions separately and derive
// `plots` for the active phase via useMemo. Putting `s.plots.filter(...)`
// inside the `useShallow` selector returns a new array reference on every
// render, Zustand v5's shallow comparator runs Object.is on the OUTER
// object's top-level values, so a new filter result makes the snapshot
// differ every render. React's useSyncExternalStore then logs
// "The result of getSnapshot should be cached to avoid an infinite loop"
// and the render loop trips "Maximum update depth exceeded", which the
// error boundary surfaces as "This page couldn't load" once the store
// has at least one plot. (Empty arrays happen to compare equal under
// shallow because Map(0) === Map(0), so the bug stays latent until the
// wizard creates the first plot.)
export default function Module1AreaProgram() {
  const { activePhaseId, phases, addPlot } = useModule1Store(useShallow(s => ({
    activePhaseId: s.activePhaseId,
    phases:        s.phases,
    addPlot:       s.addPlot,
  })));
  const allPlots = useModule1Store(s => s.plots);
  const currency = useModule1Store(s => s.currency);
  const plots    = useMemo(
    () => allPlots.filter(p => p.phaseId === activePhaseId),
    [allPlots, activePhaseId],
  );

  // M1.10/5, Land Parcels (financial) vs Plots (physical) reconciliation.
  // The two arrays are independently editable (a parcel is what you own;
  // a plot is what you build on). When they line up, single parcel with
  // area = total plot area, show ✓ matches. When they diverge, show a
  // warning so the user knows their financial footprint and physical
  // footprint disagree.
  const landParcels = useModule1Store(s => s.landParcels);
  const totalParcelArea = useMemo(
    () => landParcels.reduce((s, p) => s + (Number(p.area) || 0), 0),
    [landParcels],
  );
  const totalPlotAreaAllPhases = useMemo(
    () => allPlots.reduce((s, p) => s + (Number(p.plotArea) || 0), 0),
    [allPlots],
  );

  // M1.10/6, wizard mount state. Holds the plotId of the plot whose
  // setup wizard is currently open, or null when no wizard is mounted.
  const [wizardPlotId, setWizardPlotId] = useState<string | null>(null);

  const activePhase = phases.find(p => p.id === activePhaseId);

  if (!activePhase) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 'var(--sp-5)' }} data-testid="area-program-no-phase">
        <h3 style={{ margin: 0, marginBottom: 'var(--sp-2)' }}>No phase selected</h3>
        <p style={{ color: 'var(--color-meta)', margin: 0 }}>
          Add a Sub-Project + Phase via the Hierarchy tab, then come back here to define the Area Program.
        </p>
      </div>
    );
  }

  const handleAddFirstPlot = () => {
    const id = `plot_${Date.now()}`;
    const nextN = plots.length + 1;
    // Default the new plot to 50,000 sqm, a typical mid-size urban
    // parcel. Users tweak immediately in the form. plotArea must be
    // positive to avoid divide-by-zero in the envelope calc.
    addPlot(makeDefaultPlot(id, `Plot ${nextN}`, activePhase.id, 50000));
  };

  return (
    <div data-testid="area-program-tab">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-h2)' }}>Build Program</h2>
        <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
          Phase: <strong>{activePhase.name}</strong> · {plots.length} plot(s)
        </span>
        <button onClick={handleAddFirstPlot} style={{ ...primaryBtnStyle, marginLeft: 'auto' }} data-testid="add-plot-btn">
          + Add Plot
        </button>
      </div>

      {/* M1.9b/6, "What goes here" callout. */}
      <div style={{
        padding: 'var(--sp-2) var(--sp-3)',
        marginBottom: 'var(--sp-3)',
        background: 'color-mix(in srgb, var(--color-primary) 6%, transparent)',
        borderLeft: '3px solid var(--color-primary)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-body)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--color-heading)' }}>📋 What goes here:</strong>{' '}
          per-plot envelope (FAR, coverage, podium + typical floors,
          parking allocator), per-zone GFA splits, and the Asset +
          Sub-Unit detail editor (mix %, deduct %, efficiency %, sub-
          unit count + sale / lease metrics).{' '}
          <strong style={{ color: 'var(--color-heading)' }}>Not here:</strong>{' '}
          project-wide FAR / land parcels (Land), schedule + structure
          (Schedule), revenue ramps (Module 2, coming next).
        </div>
      </div>

      {/* M1.12, Land Parcels block lifted from the dissolved Land tab.
         Renders above the reconciliation row so users see the parcel
         table first, then the financial-vs-physical comparison. Inline
         editor + Setup Wizard mount + Add Parcel CTA in one card. */}
      <LandParcelsBlock landParcels={landParcels} currency={currency} readOnly={false} />

      {/* M1.10/5, Land vs Plot reconciliation row. Surfaces the relationship
         between Land Parcels (financial, what you own) and Plots
         (physical, what you build on) so users see at a glance whether
         the two arrays agree. Tolerance: 1 sqm to absorb rounding from
         the wizard's 100,000 / plotCount division. */}
      {(() => {
        const diff = totalPlotAreaAllPhases - totalParcelArea;
        const matches = Math.abs(diff) < 1;
        const tone = matches
          ? { bg: 'color-mix(in srgb, var(--color-success) 8%, transparent)',  border: 'var(--color-success)',  icon: '✓', label: 'matches' }
          : { bg: 'color-mix(in srgb, var(--color-warning) 10%, transparent)', border: 'var(--color-warning)',  icon: '⚠', label: diff > 0 ? `plot total exceeds parcel by ${Math.round(diff).toLocaleString()} sqm` : `parcel total exceeds plot by ${Math.round(-diff).toLocaleString()} sqm` };
        return (
          <div
            data-testid="land-plot-reconciliation"
            style={{
              padding: 'var(--sp-2) var(--sp-3)',
              marginBottom: 'var(--sp-3)',
              background: tone.bg,
              borderLeft: `3px solid ${tone.border}`,
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              fontSize: 'var(--font-meta)',
              color: 'var(--color-body)',
            }}
          >
            <span style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)' }}>
              {tone.icon} Land vs Plot:
            </span>
            <span>
              <strong>Land Parcel total:</strong>{' '}
              {totalParcelArea.toLocaleString()} sqm
            </span>
            <span style={{ color: 'var(--color-meta)' }}>·</span>
            <span>
              <strong>Plot total (all phases):</strong>{' '}
              {totalPlotAreaAllPhases.toLocaleString()} sqm
            </span>
            <span style={{ color: 'var(--color-meta)' }}>·</span>
            <span style={{ fontStyle: matches ? 'normal' : 'italic', fontWeight: matches ? 'var(--fw-semibold)' : 'var(--fw-normal)' }}>
              {tone.label}
            </span>
          </div>
        );
      })()}

      {/* Empty state OR plots list */}
      {plots.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 'var(--sp-4)' }} data-testid="area-program-empty">
          <h3 style={{ margin: 0, marginBottom: 'var(--sp-2)' }}>No plots in this phase yet</h3>
          <p style={{ color: 'var(--color-meta)', margin: 0, marginBottom: 'var(--sp-3)' }}>
            A Plot defines the physical envelope (FAR, coverage, podium / typical floors, parking config) beneath this phase.
            Add your first plot to start the Area Program.
          </p>
          <button onClick={handleAddFirstPlot} style={primaryBtnStyle} data-testid="add-first-plot-btn">+ Add first Plot</button>
        </div>
      ) : (
        plots.map(p => <PlotEditor key={p.id} plot={p} allPlotsCount={plots.length} onOpenWizard={setWizardPlotId} />)
      )}

      {/* M1.10/6, Plot Setup Wizard mount. Renders only when a plotId
         is selected; PlotSetupWizard returns null itself when its plot
         has been removed mid-flight (defensive). */}
      {wizardPlotId && (
        <PlotSetupWizard plotId={wizardPlotId} onClose={() => setWizardPlotId(null)} />
      )}

      {/* M1.9b/3, asset + sub-unit detail editors mounted from the
         dissolved Hierarchy tab. Renders Sub-Project + Phase headers
         (slim) + every Asset card with full CRUD (name, type, category,
         allocation %, deduct %, efficiency %, visible toggle) + every
         Sub-Unit card with full CRUD (name, metric, metricValue,
         unitPrice, priceEscalationPct, parkingBaysPerUnit). Master
         Holding + structural Sub-Project/Phase add/delete live on the
         Schedule tab; this mode hides those controls. */}
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <h3 style={{
          fontSize: 'var(--font-h3)', fontWeight: 'var(--fw-bold)',
          color: 'var(--color-heading)', margin: '0 0 4px 0',
        }}>
          🧱 Asset &amp; Sub-Unit Detail Editor
        </h3>
        <p style={{
          fontSize: 'var(--font-meta)', color: 'var(--color-meta)',
          margin: '0 0 var(--sp-2) 0', lineHeight: 1.5,
        }}>
          Edit each asset&apos;s inventory schedule + pricing. Add or remove
          assets here. Structure (Sub-Project / Phase / Master Holding)
          lives on the Schedule tab.
        </p>
        <Module1Hierarchy sections="assets" />
      </div>
    </div>
  );
}
