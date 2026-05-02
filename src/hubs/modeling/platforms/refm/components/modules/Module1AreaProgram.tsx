'use client';

/**
 * Module1AreaProgram.tsx
 *
 * REFM Module 1 — Area Program tab (Phase M1.7).
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
import {
  computePlotEnvelope, computeAreaCascade,
  type PlotEnvelopeAreas,
} from '@core/calculations';
import {
  useModule1Store,
  selectPlotsForPhase,
  selectZonesForPlot,
  selectAssetsForPlot,
} from '../../lib/state/module1-store';
import {
  ASSET_STRATEGIES, DEFAULT_AREA_CASCADE_BY_CATEGORY,
  resolveAssetStrategy, resolveAssetCascadePcts,
  makeDefaultPlot,
  type Plot, type Zone, type AssetClass, type AssetStrategy,
} from '../../lib/state/module1-types';

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
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ── Plot row ───────────────────────────────────────────────────────────────
function PlotEditor({ plot, allPlotsCount }: { plot: Plot; allPlotsCount: number }) {
  const { updatePlot, removePlot, addZone, zones, assetsOnPlot } = useModule1Store(useShallow(s => ({
    updatePlot:   s.updatePlot,
    removePlot:   s.removePlot,
    addZone:      s.addZone,
    zones:        selectZonesForPlot(plot.id)(s),
    assetsOnPlot: selectAssetsForPlot(plot.id)(s),
  })));

  const envelope: PlotEnvelopeAreas = useMemo(() => computePlotEnvelope({
    plotArea: plot.plotArea, maxFAR: plot.maxFAR, coveragePct: plot.coveragePct,
    podiumFloors: plot.podiumFloors, typicalFloors: plot.typicalFloors,
    typicalCoveragePct: plot.typicalCoveragePct,
    landscapePct: plot.landscapePct, hardscapePct: plot.hardscapePct,
    basementCount: plot.basementCount, basementEfficiencyPct: plot.basementEfficiencyPct,
  }), [plot]);

  const numField = (key: keyof Plot, label: string, suffix?: string) => (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}{suffix ? ` (${suffix})` : ''}</span>
      <input
        type="number"
        value={(plot[key] as number) ?? 0}
        onChange={e => updatePlot(plot.id, { [key]: parseFloat(e.target.value) || 0 } as Partial<Plot>)}
        style={inputStyle}
      />
    </label>
  );

  const calcRow = (label: string, value: number, suffix = 'sqm') => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--sp-2)', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>{label}</span>
      <span style={{ ...calcOutputStyle, minWidth: 130 }}>{fmt(value)} {suffix}</span>
    </div>
  );

  const handleAddZone = () => {
    const nextN = zones.length + 1;
    addZone({ id: `zone_${plot.id}_${Date.now()}`, name: `Zone ${nextN}`, plotId: plot.id });
  };

  const handleDeletePlot = () => {
    const msg = `Delete "${plot.name}"?\n\n` +
      (zones.length > 0      ? `· ${zones.length} zone(s) under it will be dropped.\n` : '') +
      (assetsOnPlot.length > 0 ? `· ${assetsOnPlot.length} asset(s) bound to this plot will lose their plot/zone link (the asset itself stays — you can reassign).\n` : '') +
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
        <button onClick={handleDeletePlot} style={dangerBtnStyle} disabled={allPlotsCount <= 0} aria-label={`Delete ${plot.name}`}>Delete</button>
      </div>

      {/* Inputs grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        {numField('plotArea',           'Plot Area',          'sqm')}
        {numField('maxFAR',             'Max FAR',            'ratio')}
        {numField('coveragePct',        'Coverage',           '%')}
        {numField('typicalCoveragePct', 'Typical Coverage',   '%')}
        {numField('numberOfFloors',     'Total Floors',       '#')}
        {numField('podiumFloors',       'Podium Floors',      '#')}
        {numField('typicalFloors',      'Typical Floors',     '#')}
        {numField('landscapePct',       'Landscape',          '% public')}
        {numField('hardscapePct',       'Hardscape',          '% public')}
        {numField('basementCount',      'Basements',          '#')}
        {numField('basementEfficiencyPct', 'Basement Eff.',   '%')}
      </div>

      {/* Computed envelope */}
      <div style={{
        background: 'var(--color-grey-pale)', borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2) var(--sp-3)', marginBottom: 'var(--sp-3)',
      }}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Computed envelope</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--sp-3)' }}>
          <div>
            {calcRow('Max GFA',           envelope.maxGFA)}
            {calcRow('Footprint',         envelope.footprint)}
            {calcRow('Podium GFA',        envelope.podiumGFA)}
            {calcRow('Typical GFA',       envelope.typicalGFA)}
            {calcRow('Total Built GFA',   envelope.totalBuiltGFA)}
          </div>
          <div>
            {calcRow('Public Area',       envelope.publicArea)}
            {calcRow('Landscape Area',    envelope.landscapeArea)}
            {calcRow('Hardscape Area',    envelope.hardscapeArea)}
            {calcRow('Surface Parking',   envelope.surfaceParkingArea)}
            {calcRow('Basement Usable',   envelope.basementUsableArea)}
          </div>
        </div>
      </div>

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
          placeholder="—"
          style={{ ...inputStyle, width: 80 }}
        />
      </label>
      <button
        onClick={() => {
          const msg = assetCount > 0
            ? `Delete "${zone.name}"?\n\n${assetCount} asset(s) point at this zone — they will keep their plot binding but lose the zone label.`
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
  const { updateAsset, zonesForPlot } = useModule1Store(useShallow(s => ({
    updateAsset:   s.updateAsset,
    zonesForPlot:  selectZonesForPlot(asset.plotId ?? '')(s),
  })));

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

      {/* Strategy + zone + GFA */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <label>
          <span style={labelStyle}>Primary strategy</span>
          <select
            value={effectivePrimary}
            onChange={e => updateAsset(asset.id, { primaryStrategy: e.target.value as AssetStrategy })}
            style={inputStyle}
          >
            {ASSET_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Primary %</span>
          <input
            type="number"
            value={asset.primaryStrategyPct ?? 100}
            onChange={e => updateAsset(asset.id, { primaryStrategyPct: parseFloat(e.target.value) || 0 })}
            style={inputStyle}
          />
        </label>
        <label>
          <span style={labelStyle}>Secondary strategy</span>
          <select
            value={asset.secondaryStrategy ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { secondaryStrategy: v === '' ? undefined : v as AssetStrategy });
            }}
            style={inputStyle}
          >
            <option value="">—</option>
            {ASSET_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Secondary %</span>
          <input
            type="number"
            value={asset.secondaryStrategyPct ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { secondaryStrategyPct: v === '' ? undefined : parseFloat(v) || 0 });
            }}
            placeholder="—"
            style={inputStyle}
            disabled={asset.secondaryStrategy === undefined}
          />
        </label>
      </div>

      {/* Zone + GFA override + cascade pcts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <label>
          <span style={labelStyle}>Zone</span>
          <select
            value={asset.zoneId ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { zoneId: v === '' ? undefined : v });
            }}
            style={inputStyle}
          >
            <option value="">— (no zone)</option>
            {zonesForPlot.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
        <label>
          <span style={labelStyle}>GFA override (sqm)</span>
          <input
            type="number"
            value={asset.gfaOverrideSqm ?? ''}
            onChange={e => {
              const v = e.target.value;
              updateAsset(asset.id, { gfaOverrideSqm: v === '' ? undefined : parseFloat(v) || 0 });
            }}
            placeholder={`pro-rata ${fmt(gfaShare)}`}
            style={inputStyle}
          />
        </label>
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

      {/* Cascade preview */}
      <div style={{
        background: 'var(--color-grey-pale)', borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2)',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)',
      }}>
        <CascadeCell label="GFA"        value={cascade.gfa} />
        <CascadeCell label="MEP"        value={cascade.mep} />
        <CascadeCell label="Net GFA"    value={cascade.netGFA} />
        <CascadeCell label="GSA / GLA"  value={cascade.gsaGla} />
        <CascadeCell label="BUA Excl."  value={cascade.buaExcl} />
        <CascadeCell label="TBA"        value={cascade.tba} />
        <CascadeCell label="Back-of-House" value={cascade.backOfHouse} />
        <CascadeCell label="Other Tech."   value={cascade.otherTechnical} />
      </div>
    </div>
  );
}

function CascadeCell({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>{label}</span>
      <span style={{ ...calcOutputStyle, textAlign: 'left' }}>{fmt(value)} sqm</span>
    </div>
  );
}

// ── Asset assignment picker (assets in this phase that are NOT yet on a plot) ──
function AssetAssignPicker({ plotId }: { plotId: string }) {
  const { unassignedAssets, updateAsset } = useModule1Store(useShallow(s => ({
    unassignedAssets: s.assets.filter(a => {
      if (a.plotId !== undefined) return false;
      const plot = s.plots.find(p => p.id === plotId);
      return plot ? a.phaseId === plot.phaseId : false;
    }),
    updateAsset: s.updateAsset,
  })));

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

// ── Top-level component ───────────────────────────────────────────────────
export default function Module1AreaProgram() {
  const { activePhaseId, phases, plots, addPlot } = useModule1Store(useShallow(s => ({
    activePhaseId: s.activePhaseId,
    phases:        s.phases,
    plots:         selectPlotsForPhase(s.activePhaseId)(s),
    addPlot:       s.addPlot,
  })));

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
    // Default the new plot to 50,000 sqm — a typical mid-size urban
    // parcel. Users tweak immediately in the form. plotArea must be
    // positive to avoid divide-by-zero in the envelope calc.
    addPlot(makeDefaultPlot(id, `Plot ${nextN}`, activePhase.id, 50000));
  };

  return (
    <div data-testid="area-program-tab">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-h2)' }}>Area Program</h2>
        <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
          Phase: <strong>{activePhase.name}</strong> · {plots.length} plot(s)
        </span>
        <button onClick={handleAddFirstPlot} style={{ ...primaryBtnStyle, marginLeft: 'auto' }} data-testid="add-plot-btn">
          + Add Plot
        </button>
      </div>

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
        plots.map(p => <PlotEditor key={p.id} plot={p} allPlotsCount={plots.length} />)
      )}
    </div>
  );
}
