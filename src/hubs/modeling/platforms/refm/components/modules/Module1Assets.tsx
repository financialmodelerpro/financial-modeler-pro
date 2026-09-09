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
  type AssetStrategy,
  type AssetStatus,
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
  assetTypeCatalogForProjectType,
  SUB_UNIT_CATEGORIES,
  LAND_ALLOCATION_MODES,
  PARCEL_WEIGHTED_AVG,
  PARCEL_WEIGHTED_AVG_ALL,
  PARCEL_CUSTOM_RATE,
} from '../../lib/state/module1-types';
import {
  computeAssetAreaHierarchy,
  computeAssetLandBreakdown,
  resolveAssetPlotDraw,
  computeAssetUnitCount,
  computeAssetLandSqm,
  computeLandAggregate,
  computeLandReconciliation,
  computeOperatingEndDate,
  computeParcelNda,
  computeSubUnitArea,
  formatOperatingEndDate,
  landRateIssueText,
  resolveAssetAreaMetrics,
  validateLandAllocation,
} from '@/src/core/calculations';
import {
  describeSource,
  describeValues,
  resolveAssetTypeKey,
  resolveAssetTypeValues,
  resolveAvgUnitSize,
  resolveParkingRatio,
  type AssetTypeStandard,
  type AssetTypeValues,
} from '../../lib/state/assetTypeStandards';
import LandChainSection from './_shared/LandChainSection';
import {
  groupAssetsByPlot,
  partitionSubUnitsByLine,
  plotCheckText,
  primaryParcelId,
  type AssetPlotGroup,
} from './_shared/assetTableModel';
import {
  groupAssetsForConsolidation,
  type ConsolidationGroup,
} from '@/src/core/calculations/consolidation';
import { poolLineAreas, poolLineLand, resolveConsolidatedLine } from '@/src/core/calculations/consolidatedLine';
import { normaliseAssetTypeId } from '../../lib/state/assetTypeStandards';
import { computeLandChain, type ChainResult } from '@/src/core/calculations/landChain';
import type { LandChainInputs } from '@/src/core/calculations/landChain';
import { currencyHeaderLine, formatArea, formatAccounting } from '@/src/core/formatters';

/** Merge one chain-input patch, where `undefined` CLEARS a field rather than
 *  leaving a dead key, and an entry left stating nothing becomes absent so the
 *  asset returns to showing no derivation at all. */
function mergeLandChain(
  current: LandChainInputs | undefined,
  patch: LandChainInputs,
): LandChainInputs | undefined {
  const next = { ...(current ?? {}) } as Record<string, number | undefined>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length === 0 ? undefined : (next as LandChainInputs);
}
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { PercentageInput } from '../ui/PercentageInput';
import InputLabel from '../ui/InputLabel';
import { CELL_HEADER, TABLE_TITLE } from './_shared/tableStyles';
import { StrategyChangeConfirm, StrategyReviewBanner } from './_shared/StrategyChangeNotice';
import { applyStrategySwitch, assetHasStrategyAssumptions, type StrategySwitchReport } from '../../lib/state/strategySwitch';
import { assetDisplayName, assetNameIsDerived, assetTypeSuffix } from '@/src/core/calculations/assetName';

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

// Type catalog for the asset Type dropdown. 2026-09-07: ONE list, the
// reference land structure's catalog (module1-types), narrowed only for the
// three category-named project types. The strategy-keyed fallback bank is
// retired with the old per-project-type banks; the field stays free text.
/**
 * ONE OPTION IN THE ASSET TYPE DROPDOWN.
 *
 * `key` is what the <select> carries, and it is the ENTRY ID for a firm type
 * and the normalised label for a catalog-only one. Both live in the same id
 * space (the vocabulary mints its entry ids with `normaliseAssetTypeId`), which
 * is what lets a picked firm entry and a typed label be the same type rather
 * than two.
 */
interface TypeChoice {
  key: string;
  label: string;
  /** True when this is the firm's own entry, so picking it records a reference. */
  fromFirm: boolean;
}

/** The sentinel for a stored label that is on neither list. It is not a key
 *  anything can mint, so it can never collide with a real one. */
const UNLISTED_TYPE = '__unlisted__';

/**
 * The firm's vocabulary first, in the firm's own order, then the platform
 * catalog labels the firm has not adopted.
 *
 * DEDUPED BY IDENTITY, NOT BY SPELLING. "Branded Villas" from the firm and
 * "Branded villas" from the catalog are one type, so offering both would ask a
 * user to choose between two spellings of the same thing and then resolve their
 * standards differently depending on which they picked.
 */
function buildTypeChoices(
  entries: readonly AssetTypeStandard[],
  catalog: readonly string[],
): TypeChoice[] {
  const out: TypeChoice[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = (e.id ?? '').trim() || normaliseAssetTypeId(e.label);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: e.label, fromFirm: true });
  }
  for (const label of catalog) {
    const key = normaliseAssetTypeId(label);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, fromFirm: false });
  }
  return out;
}

/** Which option is selected: the asset's resolved type key when the list holds
 *  it, the unlisted sentinel when it has a label the list does not, else none. */
function assetTypeSelectValue(asset: Asset, choices: readonly TypeChoice[]): string {
  const key = resolveAssetTypeKey(asset);
  if (key === undefined) return '';
  return choices.some((c) => c.key === key) ? key : UNLISTED_TYPE;
}

/**
 * What picking an option writes.
 *
 * BOTH FIELDS, ALWAYS, so the label and the reference can never disagree. A
 * firm entry writes its id; a catalog-only label writes NO id, because there is
 * no vocabulary entry to point at and inventing one would put a reference in
 * the snapshot that the standards tab cannot show. The label still resolves
 * through the same normalisation, so its values are found either way.
 *
 * Re-selecting the unlisted sentinel is a no-op patch: it is a label the user
 * typed before this list existed and choosing it must not rewrite it.
 */
function assetTypePatch(next: string, choices: readonly TypeChoice[]): Partial<Asset> {
  if (next === UNLISTED_TYPE) return {};
  if (next === '') return { type: '', assetTypeId: undefined };
  const choice = choices.find((c) => c.key === next);
  if (!choice) return {};
  return { type: choice.label, assetTypeId: choice.fromFirm ? choice.key : undefined };
}

function resolveTypeCatalog(project: Project): readonly string[] {
  return assetTypeCatalogForProjectType(project.projectType);
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
    addSubUnit,
    updateSubUnit,
    removeSubUnit,
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
      addSubUnit: s.addSubUnit,
      updateSubUnit: s.updateSubUnit,
      removeSubUnit: s.removeSubUnit,
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

  // ── Land planning (2026-09-07): the firm's asset type VOCABULARY ──
  //
  // Account-scoped names only (migs 242-244), fetched once like the cost
  // catalog. The VALUES for each type live on the project, so a failed fetch
  // costs a picker, never a number.
  const [assetTypeRegistry, setAssetTypeRegistry] = useState<{
    entries: AssetTypeStandard[];
    available: boolean;
  }>({ entries: [], available: true });
  const refreshAssetTypeRegistry = React.useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/refm/asset-types');
      if (!res.ok) { setAssetTypeRegistry((p) => ({ ...p, available: false })); return; }
      const body = await res.json() as { entries?: AssetTypeStandard[]; available?: boolean };
      setAssetTypeRegistry({
        entries: Array.isArray(body.entries) ? body.entries : [],
        available: body.available !== false,
      });
    } catch {
      setAssetTypeRegistry((p) => ({ ...p, available: false }));
    }
  }, []);
  useEffect(() => { void refreshAssetTypeRegistry(); }, [refreshAssetTypeRegistry]);

  // TWO GROUPINGS, AND THE ORDER BETWEEN THEM IS THE WHOLE POINT (2026-09-09).
  //
  // A first cut merged at table 2, so entry and the chain both ran on a pooled
  // line. That is one table too early. THE CHAIN RUNS PER PLOT: utilisation,
  // coverage, FAR and the retail share are properties of a piece of ground, and
  // two plots of one type can differ on every one of them. Pooling before the
  // chain ran left a merged row with no single answer to give, which is exactly
  // why Landscape %, Average Unit Size and Parking Ratio printed dashes on any
  // two-plot line: not a formatting gap, a category error.
  //
  // So plots group tables 2 and 3, the chain runs once per plot, and the MERGE
  // SUMS RESULTS in table 4. Every ratio there is the quotient of two sums in
  // its own row, never an average of the inputs that produced them.
  //
  // Companions are excluded by both groupings: a companion is the same building
  // under a second treatment, not a plot and not a line.
  const plotGroups = useMemo(
    () => groupAssetsByPlot(assets, parcels),
    [assets, parcels],
  );
  const lineGroups = useMemo(
    () => groupAssetsForConsolidation(assets, phases.map((p) => p.id), normaliseAssetTypeId),
    [assets, phases],
  );

  /** Add a sub-unit to a chosen parent, seeded exactly as the per-asset
   *  button seeds one, so the two entry points cannot diverge. */
  const handleAddSubUnitTo = (assetId: string): void => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    const isLease = asset.strategy === 'Lease';
    addSubUnit({
      id: `subunit_${Date.now()}`,
      assetId,
      name: '',
      category: isLease ? 'Leasable' : asset.strategy === 'Operate' ? 'Operable' : 'Sellable',
      metric: isLease ? 'area' : 'units',
      metricValue: 0,
      unitArea: isLease ? undefined : 0,
      unitPrice: 0,
    });
  };

  // (The per-phase grouping that fed the old card sections is gone with them:
  // the table groups by PLOT, because the chain is per plot, and phase is a
  // column on the row.)

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
    // 2026-08-15: a new parcel is an EMPTY row to fill in. It used to arrive as
    // 50,000 sqm at 500/sqm, which is 25m of land cost the user never entered.
    // The cash / in-kind split routes value rather than creating it, so it
    // stays as it was and moves nothing at a zero rate.
    addParcel({
      id: `parcel_${Date.now()}`,
      phaseId: phases[0].id,
      name: `Land ${parcels.length + 1}`,
      area: 0,
      rate: 0,
      cashPct: 60,
      inKindPct: 40,
    });
  };

  const handleAddAssetToPhase = (phaseId: string, parcelId?: string): void => {
    const phaseAssetCount = assets.filter((a) => a.phaseId === phaseId).length;
    // M2.0g Fix 2: default land allocation to the first phase parcel
    // (not "(weighted average)") so the asset's resolved rate matches
    // a real parcel rate out of the box.
    //
    // 2026-08-17: the `?? parcels[0]` fallback crosses phases, which used to
    // seed a later-phase asset with a reference the dropdown could not show and
    // the engine valued at ZERO. It is kept, because a parcel is now
    // project-wide and the reference resolves; it is the reason the widening
    // had to reach the engine and not only the dropdown.
    // THE PLOT THE BUTTON WAS ON WINS. "Add asset here" on a plot header used
    // to pass its parcel id and this function ignored it, seeding the new
    // asset with the phase's FIRST parcel instead. On a phase with more than
    // one plot the row appeared under a different plot than the one clicked.
    const phaseParcels = parcels.filter((p) => p.phaseId === phaseId);
    const named = parcelId ? parcels.find((p) => p.id === parcelId) : undefined;
    const fallbackParcel = named ?? phaseParcels[0] ?? parcels[0];
    addAsset({
      id: `asset_${Date.now()}`,
      phaseId,
      // NO INVENTED NAME. "Asset 3" is not an identity, it is a placeholder a
      // user then feels obliged to replace, and the schedules group by type and
      // merge the replacements anyway. Blank means "called by its type".
      name: '',
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
      // NO SEEDED SQM. Writing `sqm: 0` made the platform's own seed
      // indistinguishable from a person typing zero, and the two land
      // resolvers then read it two different ways. Absent means "not decided",
      // and a sole occupant draws its whole plot until someone says otherwise.
      landAllocation: fallbackParcel ? { parcelId: fallbackParcel.id } : undefined,
    });
  };

  return (
    <div data-testid="tab-assets">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-3)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-h2)', margin: 0 }}>
            5. Assets &amp; Sub-units
          </h2>
          <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 2 }} data-testid="assets-name-note">
            Schedules group by type, so the name is a label for entry only. Leave it blank and the
            asset is called by its type.
          </div>
        </div>
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
        cards (areas, sub-units, status, useful life). Asset Type suggestions
        come from the standard catalog plus your firm&apos;s list on the{' '}
        <strong>Asset Types &amp; Standards</strong> tab; a{' '}
        <strong>Residential</strong>, <strong>Hospitality</strong> or{' '}
        <strong>Retail</strong> project type narrows the catalog to its own
        category (yours: <strong>{project.projectType ?? 'Mixed-Use'}</strong>).
        Picking a firm type copies its standards onto the asset.
      </div>

      {/* Land Parcels block */}
      <div style={sectionCardStyle} data-testid="parcels-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>1. Plots, the land</h3>
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
                phases={phases}
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
              {/* THE WEIGHTED RATE IS A RATE, so it stays at full scale like
                  every parcel's own rate input directly above it, which already
                  carries the comment "Rate is per sqm; usually small enough we
                  keep scale='full' so 500/sqm doesn't display as 0.50 K". The
                  totals row never got that rule: at thousands with 0 decimals
                  it divided 7,357.14 by 1,000 and rounded, printing "7" under a
                  column of 7,500 and 500. The arithmetic was always right
                  (180,250,000 / 24,500); only the formatting was not. The
                  money totals beside it are totals and keep the scale. */}
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-weighted-rate">{formatAccounting(aggregate.weightedRate, 'full', project.displayDecimals ?? 2)} /sqm</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-cash-value">{formatAccounting(aggregate.cashValue, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-inkind-value">{formatAccounting(aggregate.inKindValue, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</td>
              <td style={{ padding: 'var(--sp-1)' }} data-testid="parcels-total-value">{formatAccounting(aggregate.totalValue, project.displayScale ?? 'full', project.displayDecimals ?? 2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

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

      {/* THE ASSETS TABLES: entry and the chain by PLOT, then the merge by
          LINE. Everything a row cannot hold opens in the drawer, which is the
          asset card, unchanged. */}
      <AssetTables
        groups={plotGroups}
        lineGroups={lineGroups}
        allAssets={assets}
        allPhases={phases}
        parcels={parcels}
        subUnits={subUnits}
        project={project}
        landAllocationMode={landAllocationMode}
        assetTypeRegistry={assetTypeRegistry}
        onUpdateAsset={updateAsset}
        onRemoveAsset={removeAsset}
        onAddAsset={handleAddAssetToPhase}
      />

      <SubUnitsTable
        assets={assets.filter((a) => a.isCompanion !== true)}
        phases={phases}
        subUnits={subUnits}
        project={project}
        onAdd={handleAddSubUnitTo}
        onUpdate={updateSubUnit}
        onRemove={removeSubUnit}
      />

      {/* Global totals (M2.0h Fix 3: three-tier hierarchy) */}
      <div style={{ ...sectionCardStyle, background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }} data-testid="assets-globals">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)', color: 'var(--color-on-primary-navy)' }}>Project Totals</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)', fontSize: 'var(--font-small)', marginBottom: 'var(--sp-2)' }}>
          <div title="Sum of every asset's NSA. INTERNAL FIELD: Asset.sellableBuaSqm, read by the cost method rate_per_nsa.">
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>NSA or GLA</div>
            <strong style={{ fontSize: 16 }} data-testid="globals-nsa">{fmt(globals.nsa)} sqm</strong>
          </div>
          <div title="Sum of every asset's building floor area, parking excluded. INTERNAL FIELD: Asset.buaSqm, read by the cost method rate_per_bua. The field name and the industry name invert here; the tables above use the same words as this tile.">
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total GFA</div>
            <strong style={{ fontSize: 16 }} data-testid="globals-bua">{fmt(globals.bua)} sqm</strong>
          </div>
          <div title="Sum of every asset's built area including parking. INTERNAL FIELD: Asset.gfaSqm, read by the cost method rate_per_gfa. The field name and the industry name invert here; the tables above use the same words as this tile.">
            <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total BUA</div>
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
  /** For the phase picker: a plot is acquired in one phase. */
  phases: Phase[];
  decimals: import('../../lib/state/module1-types').DisplayDecimals;
}

function ParcelRow({ parcel, phases, onUpdate, onRemove, canRemove, decimals }: ParcelRowProps): React.JSX.Element {
  // P7-Fix 1: per-parcel NDA cells removed; project-level NDA card owns this surface now.
  return (
    <tr data-testid={`parcel-row-${parcel.id}`}>
      <td style={{ padding: 'var(--sp-1)' }}>
        <input type="text" value={parcel.name} data-testid={`parcel-${parcel.id}-name`} onChange={(e) => onUpdate({ name: e.target.value })} style={inputStyle} />
      </td>
      {/* THE PHASE IS ENTRY, so it belongs on the plot row. It was only
          editable in a wizard before, which meant a plot bought in the wrong
          phase could not be corrected here. A plot stays PROJECT-WIDE: an asset
          in any phase may draw from it, and the phase says when it is acquired. */}
      <td style={{ padding: 'var(--sp-1)' }}>
        <select
          value={parcel.phaseId}
          data-testid={`parcel-${parcel.id}-phase`}
          onChange={(e) => onUpdate({ phaseId: e.target.value })}
          style={inputStyle}
        >
          {phases.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
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
        {/* THE SCALED CAPTION IS GONE. It showed the rate divided by the
            display scale, so 7,500 per sqm rendered "8" underneath an input
            reading 7,500. It was the same confusion the totals row had, in
            smaller type: a scale is for totals, and a per sqm rate is not a
            total. There is no caption now, because the input above it already
            shows the whole amount. */}
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <PercentageInput
          min={0} max={100} value={parcel.cashPct}
          data-testid={`parcel-${parcel.id}-cashPct`}
          onChange={(n) => {
            const v = Math.max(0, Math.min(100, n));
            onUpdate({ cashPct: v, inKindPct: 100 - v });
          }}
          style={inputStyle}
        />
      </td>
      <td style={{ padding: 'var(--sp-1)' }}>
        <PercentageInput
          min={0} max={100} value={parcel.inKindPct}
          data-testid={`parcel-${parcel.id}-inKindPct`}
          onChange={(n) => {
            const v = Math.max(0, Math.min(100, n));
            onUpdate({ inKindPct: v, cashPct: 100 - v });
          }}
          style={inputStyle}
        />
      </td>
      {/* P7-Fix 1: NDA checkbox + Roads % + Parks % + NDA (sqm) +
          effective NDA rate cells dropped. The project-level NDA card
          below the parcels totals row owns these inputs now. */}
      {/* Total Value is DERIVED (area x rate) and left the row with the
          demotion: the plots table is entry only. The footer still totals it,
          because a total is what a footer is for. */}
      <td style={{ padding: 'var(--sp-1)', textAlign: 'right' }}>
        {canRemove && (
          <button type="button" onClick={onRemove} data-testid={`parcel-${parcel.id}-remove`} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}>Remove</button>
        )}
      </td>
    </tr>
  );
}


// ── The Assets TABLE (2026-09-07, land planning step 3) ────────────────────
//
// One row per asset, grouped under the PLOT it draws from, following the
// reference workbook's shape: identity, then land, then the chain's percent
// inputs, then the derived cascade left to right ending at GFA, the outermost tier.
//
// THE ROW IS THE ASSET. Everything scalar lives in a cell; the nine things a
// row genuinely cannot hold (the multi-parcel split list, the derived-versus-
// entered comparison, the area reconciliation, the standards read-out, the
// parcel picker's rate-annotated options, the sub-unit count's four renders,
// the strategy dialog, the banners, and the mode-dependent land fields) stay
// in the expandable drawer below the row, which is the existing asset card.
//
// NOTHING HERE REACHES THE ENGINE. The derived columns come from
// `computeLandChain`, which no calculation reads; the editable cells write
// the same fields the card always wrote.

const CELL: React.CSSProperties = { padding: '3px 5px', fontSize: 11, whiteSpace: 'nowrap' };
const CELL_NUM: React.CSSProperties = { ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const CELL_DERIVED: React.CSSProperties = { ...CELL_NUM, background: 'var(--color-grey-pale)', color: 'var(--color-heading)' };
// HEADERS WRAP, CELLS DO NOT. A header is the one thing that must never be
// truncated: a column whose label is cut is a column nobody can read. So the
// header text wraps onto as many lines as it needs and the columns are sized
// to their labels, while the numeric cells below stay on one line.
// Padding and leading are deliberately tight: with twenty columns the header
// is two lines whatever we do, and every extra pixel of padding is paid twice.
const TH_T: React.CSSProperties = {
  padding: '4px 5px', fontSize: 10, textAlign: 'center', fontWeight: 600,
  whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.15, verticalAlign: 'bottom',
};
// Numeric columns keep the SAME centred header. A right-aligned label over a
// wrapped two-line head reads as ragged; the CELLS below stay right-aligned,
// which is what makes a column of numbers scannable.
const TH_N: React.CSSProperties = { ...TH_T };
const TABLE_INPUT: React.CSSProperties = {
  background: 'var(--color-navy-pale)', color: 'var(--color-navy)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  padding: '2px 4px', fontSize: 11, width: '100%', fontFamily: 'inherit',
};
const TABLE_NUM_INPUT: React.CSSProperties = { ...TABLE_INPUT, textAlign: 'right' };

/** A chain-input cell: blank means not set, a typed 0 is a real answer, and
 *  every accepted keystroke writes straight through like any model input. */
function ChainCell({
  value, onCommit, testId, title, placeholder,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  testId: string;
  title: string;
  /** Shown when the cell is EMPTY: the figure a derived default would use.
   *  A placeholder cannot be mistaken for a stored value, which is the point:
   *  the cell is empty because nothing was typed, and it still says what the
   *  model is using. */
  placeholder?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const stored = value !== undefined ? String(value) : '';
  const parse = (s: string): number | undefined | 'bad' => {
    const t = s.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : 'bad';
  };
  const bad = draft !== null && parse(draft) === 'bad';
  return (
    <input
      style={{ ...TABLE_NUM_INPUT, ...(bad ? { borderColor: 'var(--color-negative)' } : {}) }}
      value={draft ?? stored}
      inputMode="decimal"
      placeholder={placeholder ?? '-'}
      title={title}
      data-testid={testId}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const p = parse(next);
        if (p !== 'bad') onCommit(p);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

interface AssetTableProps {
  /** Tables 2 and 3: entry and the chain, per plot. */
  groups: AssetPlotGroup[];
  /** Table 4: the merge, per line. */
  lineGroups: ConsolidationGroup[];
  allAssets: Asset[];
  allPhases: Phase[];
  parcels: Parcel[];
  subUnits: SubUnit[];
  project: Project;
  landAllocationMode: LandAllocationMode;
  assetTypeRegistry: { entries: AssetTypeStandard[]; available: boolean };
  onUpdateAsset: (id: string, patch: Partial<Asset>) => void;
  onRemoveAsset: (id: string) => void;
  onAddAsset: (phaseId: string, parcelId?: string) => void;
}

/**
 * ONE row per asset, resolved ONCE.
 *
 * The two tables below are the same rows in the same order, one holding what
 * the user types and one holding what the chain produces. Both render THIS
 * array, so they cannot drift: a row in the results table is the row at the
 * same position in the input table, by construction rather than by two
 * matching sort calls that a later edit could separate.
 */
interface AssetRow {
  groupKey: string;
  plotLabel: string;
  parcel?: Parcel;
  asset: Asset;
  chain: ChainResult;
  landSqm: number;
  // THE TWO STANDARDS THE CHAIN DIVIDED BY, carried on the row. The count and
  // the slot count are meaningless without them, and they were invisible: a
  // reader could see 109 units and had no way to ask 109 of what size.
  unitSizeSqm?: number;
  unitSizeSource?: string;
  /** Where landSqm came from, so the row can say why a blank cell is not
   *  a zero. See resolveAssetPlotDraw. */
  drawSource?: 'typed' | 'whole_plot' | 'unset';
  parkingRatio?: number;
  parkingRatioBasis?: 'slots_per_unit' | 'sqm_per_slot';
}

interface RowGroup {
  group: AssetPlotGroup;
  /** The plot's name, or the marker for assets naming no specific plot. */
  plotLabel: string;
  rows: AssetRow[];
}

/**
 * THE LINE'S ROWS ARE THE PLOT ROWS, REGROUPED. Not rebuilt.
 *
 * Table 4 sums exactly what table 3 shows, because it holds the same AssetRow
 * objects. Running the chain a second time under a different grouping would
 * give the merge its own copy of the arithmetic, and two copies are two answers
 * waiting to diverge on the next edit.
 */
interface LineRowGroup {
  group: ConsolidationGroup;
  rows: AssetRow[];
}

function buildLineRows(rowGroups: RowGroup[], lineGroups: ConsolidationGroup[]): LineRowGroup[] {
  const byAssetId = new Map<string, AssetRow>();
  for (const g of rowGroups) for (const r of g.rows) byAssetId.set(r.asset.id, r);
  return lineGroups.map((group) => ({
    group,
    rows: (group.assets as unknown as Asset[])
      .map((a) => byAssetId.get(a.id))
      .filter((r): r is AssetRow => r !== undefined),
  }));
}

function buildAssetRows(
  groups: AssetPlotGroup[],
  allAssets: Asset[],
  parcels: Parcel[],
  subUnits: SubUnit[],
  project: Project,
  landAllocationMode: LandAllocationMode,
): RowGroup[] {
  return groups.map((g) => {
    const plotLabel = g.parcel ? g.parcel.name : 'No specific plot';
    return {
      group: g,
      plotLabel,
      rows: g.assets.map((asset) => {
        const breakdown = computeAssetLandBreakdown(asset, parcels, allAssets, subUnits, landAllocationMode);
        // THE TYPE RESOLVES ONCE, here as everywhere else: the stored
        // reference when there is one, else the label normalised into the same
        // id space. This read the reference alone, so an asset typed in the
        // table row (which never wrote one) found no standards and the chain
        // stopped dead at NSA.
        const typeValues = resolveAssetTypeValues(asset, project.assetTypeValues);
        const areas = subUnits
          .filter((u) => u.assetId === asset.id && typeof u.unitArea === 'number' && u.unitArea > 0)
          .map((u) => u.unitArea);
        const unitSize = resolveAvgUnitSize(areas, typeValues);
        const chain = computeLandChain(
          breakdown.landSqm,
          asset.landChain,
          {
            avgUnitSizeSqm: unitSize.value,
            parkingRatio: typeValues?.parkingRatio,
            parkingRatioBasis: typeValues?.parkingRatioBasis,
            parkingAreaPerSlotSqm: project.parkingAreaPerSlotSqm,
          },
          computeAssetUnitCount(asset, subUnits),
        );
        return {
          groupKey: g.key,
          plotLabel,
          parcel: g.parcel ?? parcels.find((p) => p.id === primaryParcelId(asset)),
          asset,
          chain,
          landSqm: breakdown.landSqm,
          drawSource: resolveAssetPlotDraw(asset, parcels, allAssets)?.source,
          unitSizeSqm: unitSize.value,
          unitSizeSource: unitSize.source,
          parkingRatio: typeValues?.parkingRatio,
          parkingRatioBasis: typeValues?.parkingRatioBasis,
        };
      }),
    };
  });
}

/** The line's strategy, and whether its plots agree about it. Read from the
 *  members because that is still where it is stored; the LINE is what owns it. */
function lineStrategy(rows: readonly AssetRow[]): string {
  const r = resolveConsolidatedLine(rows.map((x) => x.asset as never));
  const v = String(r.fields.strategy?.value ?? '');
  return r.fields.strategy?.source === 'conflict' ? `${v} (plots disagree)` : v;
}

/** Which LINE-level fields the plots disagree on. Empty on every live line. */
function lineConflicts(rows: readonly AssetRow[]): string[] {
  return resolveConsolidatedLine(rows.map((x) => x.asset as never)).conflicts;
}

/**
 * A PLOT header row, shared by the entry table and the per-plot derived table
 * so their grouping is identical.
 *
 * It came back on 2026-09-09, having been replaced by a line header the day
 * before. The line header merged one table too early: entry and the chain both
 * belong to a piece of ground, and a plot header is what says which ground.
 * The merge now has its own table below, and states the phase in words there
 * too.
 *
 * The CHECK belongs to the entry table only: it is about what was entered.
 */
function PlotHeaderRow({
  g, plotLabel, phaseName, colSpan, showCheck, onAddAsset,
}: {
  g: AssetPlotGroup;
  plotLabel: string;
  /** THE PHASE'S NAME, never its id. The header printed `phase_1`, a storage
   *  key, at a reader who has only ever seen "Phase 1" on every other screen. */
  phaseName?: string;
  colSpan: number;
  showCheck: boolean;
  onAddAsset?: (phaseId: string, parcelId?: string) => void;
}): React.JSX.Element {
  return (
    <tr style={{ background: 'var(--color-primary-pale)' }} data-testid={`plot-group-${g.key}${showCheck ? '' : '-results'}`}>
      <td style={{ ...CELL, fontWeight: 700 }} colSpan={showCheck ? 6 : 2}>
        {plotLabel}
        {phaseName && (
          <span style={{ fontWeight: 400, color: 'var(--color-meta)', marginLeft: 8 }}>{phaseName}</span>
        )}
        <span style={{ fontWeight: 400, color: 'var(--color-meta)', marginLeft: 8 }}>
          {g.assets.length} asset{g.assets.length === 1 ? '' : 's'}
        </span>
      </td>
      {showCheck ? (
        <>
          <td style={{ ...CELL_NUM, fontWeight: 700 }} data-testid={`plot-group-${g.key}-area`}>
            {g.parcelAreaSqm !== undefined ? formatArea(g.parcelAreaSqm) : '-'}
          </td>
          <td style={CELL} colSpan={colSpan - 7}>
            {g.status && (
              <span
                data-testid={`plot-group-${g.key}-check`}
                style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                  background: g.status === 'ok'
                    ? 'color-mix(in srgb, var(--color-positive, #15803d) 16%, transparent)'
                    : 'color-mix(in srgb, var(--color-warning, #92400e) 18%, transparent)',
                  color: g.status === 'ok' ? 'var(--color-positive, #15803d)' : 'var(--color-warning, #92400e)',
                }}
              >
                {g.status === 'ok' ? 'Assets sum to the plot' : g.status === 'under' ? 'Under-drawn' : 'Over-drawn'}
              </span>
            )}
            <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>
              {plotCheckText(g, (n) => formatArea(n))}
            </span>
            {g.parcel && onAddAsset && (
              <button
                type="button"
                onClick={() => onAddAsset(g.parcel!.phaseId, g.parcel!.id)}
                data-testid={`plot-group-${g.key}-add-asset`}
                style={{
                  marginLeft: 10, fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                  background: 'var(--color-surface)', border: '1px solid var(--color-navy)',
                  color: 'var(--color-navy)', borderRadius: 'var(--radius-sm)', fontWeight: 600,
                }}
              >
                + Add asset here
              </button>
            )}
          </td>
        </>
      ) : (
        <td style={CELL} colSpan={colSpan - 2} />
      )}
    </tr>
  );
}
/**
 * TABLE ONE: what the user types.
 *
 * Identity, the plot it draws from, its land, and the five chain percentages.
 * No derived column at all, which is what lets the identity columns be wide
 * enough to read. The plot check lives here because it is about what was
 * entered, and the expander opens the drawer holding everything a row cannot
 * express.
 */
function AssetInputsTable({
  rowGroups, allPhases, project, assetTypeRegistry,
  allAssets, parcels, subUnits, landAllocationMode,
  openId, setOpenId, onUpdateAsset, onRemoveAsset, onAddAsset,
}: {
  rowGroups: RowGroup[];
  allPhases: Phase[];
  project: Project;
  assetTypeRegistry: { entries: AssetTypeStandard[]; available: boolean };
  allAssets: Asset[];
  parcels: Parcel[];
  subUnits: SubUnit[];
  landAllocationMode: LandAllocationMode;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onUpdateAsset: (id: string, patch: Partial<Asset>) => void;
  onRemoveAsset: (id: string) => void;
  onAddAsset: (phaseId: string, parcelId?: string) => void;
}): React.JSX.Element {
  // ONE list for every row, built once: the firm's vocabulary first, in the
  // firm's own order, then the platform catalog labels the firm has not
  // adopted. A firm entry and a catalog label that mean the same type collapse
  // to one option, and only the firm's carries a reference.
  const typeChoices = buildTypeChoices(assetTypeRegistry.entries, resolveTypeCatalog(project));
  // 15 with Retail GFA / slot. Counts agree or U15 fails.
  const COLS = 15;
  return (
    <div style={sectionCardStyle} data-testid="assets-table-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-1)' }}>
        <strong style={{ ...TABLE_TITLE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>2. Assets by plot, what you enter</strong>
        <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
          One row per asset, under the plot it draws from. Grouped for reading, merged nowhere:
          the massing inputs belong to the ground. Open a row for anything a row cannot hold.
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        {/* Identity trimmed to what the text needs, so the five numeric
            columns can hold their wrapped labels ("Retail %", "Util %") at a
            width that fits the numbers too. */}
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1240 }} data-testid="assets-table">
          <colgroup>
            <col style={{ width: 26 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 196 }} />
            <col style={{ width: 168 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 112 }} />
            <col style={{ width: 92 }} />
            {Array.from({ length: 7 }).map((_, i) => (<col key={`in-${i}`} style={{ width: 90 }} />))}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              {/* Land area moves under Chain inputs, where it belongs: it is
                  step 0 of the chain, the figure every later step multiplies. */}
              <th style={TH_T} colSpan={6}>Asset</th>
              <th style={TH_T} colSpan={8}>Plot and massing inputs</th>
              <th style={TH_T}></th>
            </tr>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={TH_T}></th>
              <th style={TH_T}>Plot</th>
              <th style={TH_T}>Asset</th>
              <th style={TH_T}>Type</th>
              <th style={TH_T}>Strategy</th>
              <th style={TH_T}>Phase</th>
              <th style={TH_N} title="The asset's share of its plot. Feeds the land cost methods rate_per_land and rate_per_nda.">Plot Area (sqm)</th>
              <th style={TH_N} title="Share of the plot that is developable. Reference: Land Utilization %.">Land Utilisation %</th>
              {/* The reference calls this "Main Asset Coverage % / Footprint",
                  and the "main asset" half carries meaning: it is the MAIN
                  asset's footprint on the utilised land, not the plot's. */}
              <th style={TH_N} title="Share of the Net Developable Area the MAIN ASSET's footprint covers. Reference: Main Asset Coverage % / Footprint.">Ground Coverage %</th>
              <th style={TH_N} title="Floor area ratio. Total GFA = Net Developable Area x FAR (not the footprint, and not the gross plot).">FAR</th>
              <th style={TH_N} title="Height limit in storeys. Carried beside FAR for planning, and read by nothing: FAR already states the area this plot may build.">Max Floors</th>
              <th style={TH_N} title="Share of the Building Footprint given to GROUND-FLOOR retail. Reference: Retail % (Ground Floor).">Retail % (ground floor)</th>
              <th style={TH_N} title="Service and back-of-house share off Main Asset GFA. Reference: Service %.">Service %</th>
              {/* RETAIL PARKING HAS ITS OWN FIGURE, and until now the only
                  place to type it was inside a row's drawer, under the label
                  "Retail sqm / slot", which named neither retail parking nor
                  what it divides. It is a chain input, so it belongs with the
                  other chain inputs. Without it Retail Parking Slots, Retail
                  Parking Area and Total Parking Area are all dashes, on every
                  asset, however much retail GFA the chain has just derived. */}
              <th style={TH_N} title="Retail GFA per required parking slot. Retail parking divides by THIS, never by the asset's own parking ratio, because a shop's parking is sized off floor area and an apartment's off units. Leave it blank and Retail Parking Slots, Retail Parking Area and Total Parking Area cannot be derived.">Retail GFA / slot (sqm)</th>
              <th style={TH_T}></th>
            </tr>
          </thead>
          <tbody>
            {rowGroups.map(({ group, plotLabel, rows }) => (
              <React.Fragment key={group.key}>
                <PlotHeaderRow
                  g={group}
                  plotLabel={plotLabel}
                  phaseName={group.parcel ? (allPhases.find((p) => p.id === group.parcel!.phaseId)?.name ?? undefined) : undefined}
                  colSpan={COLS}
                  showCheck
                  onAddAsset={onAddAsset}
                />
                {rows.length === 0 && (
                  <tr data-testid={`plot-group-${group.key}-empty`}>
                    <td style={{ ...CELL, color: 'var(--color-meta)', fontStyle: 'italic' }} colSpan={COLS}>
                      No assets drawing from this plot yet.
                    </td>
                  </tr>
                )}
                {rows.map(({ asset, landSqm, parcel, drawSource }) => {
                  const open = openId === asset.id;
                  const patchChain = (p: LandChainInputs): void =>
                    onUpdateAsset(asset.id, { landChain: mergeLandChain(asset.landChain, p) });
                  return (
                    <React.Fragment key={asset.id}>
                      <tr
                        style={{ borderBottom: '1px solid var(--color-border)', opacity: asset.visible ? 1 : 0.55 }}
                        data-testid={`asset-card-${asset.id}`}
                      >
                        <td style={CELL}>
                          <button
                            type="button"
                            onClick={() => setOpenId(open ? null : asset.id)}
                            data-testid={`asset-${asset.id}-expand`}
                            title="Open everything a row cannot hold: the parcel split editor, the derived comparison, the reconciliation and the rest."
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}
                          >
                            {open ? 'v' : '>'}
                          </button>
                        </td>
                        {/* ONE ASSET, ONE PLOT, AND THE PLOT IS EDITABLE HERE.
                            Reassigning used to mean opening the drawer, which
                            made moving an asset between plots a four-click job
                            on a screen whose whole point is the plot grouping.
                            The drawer picker stays: it is the one that can show
                            each option's resolved rate and the weighted-average
                            options, so it is the richer surface, not a
                            duplicate rule. Both write the same field. */}
                        <td style={CELL}>
                          <select
                            style={{ ...TABLE_INPUT, fontSize: 10 }}
                            value={parcel ? parcel.id : ''}
                            data-testid={`asset-row-${asset.id}-plot`}
                            title="The plot this asset draws its land from. Changing it moves the row to that plot's group."
                            onChange={(e) => {
                              const next = e.target.value;
                              onUpdateAsset(asset.id, {
                                landAllocation: next === ''
                                  ? undefined
                                  // The sqm the asset already draws is KEPT: moving a
                                  // row between plots is a reassignment, not a reset,
                                  // and silently zeroing it would delete an input.
                                  : { ...(asset.landAllocation ?? { sqm: 0 }), parcelId: next },
                              });
                            }}
                          >
                            <option value="">no plot</option>
                            {parcels.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                          </select>
                        </td>
                        <td style={CELL}>
                          {/* THE NAME IS OPTIONAL. Blank is a real answer, so
                              the cell stays genuinely empty and shows what the
                              asset will be CALLED as a placeholder. Binding the
                              resolved name as the value would make a blank look
                              filled in and there would be no way to leave it. */}
                          <input
                            style={TABLE_INPUT}
                            value={asset.name}
                            placeholder={assetDisplayName(asset)}
                            title={assetNameIsDerived(asset)
                              ? `Unnamed, so it is called "${assetDisplayName(asset)}" everywhere. Name it only if the name earns its keep.`
                              : 'Clear this to have the asset called by its type.'}
                            data-testid={`asset-row-${asset.id}-name`}
                            onChange={(e) => onUpdateAsset(asset.id, { name: e.target.value })}
                          />
                        </td>
                        {/* A REAL DROPDOWN, NOT A DATALIST.
                            A datalist is browser AUTOCOMPLETE: it filters its
                            options by whatever is already in the box, so a row
                            reading "Branded Villas" offered exactly one option
                            and a row whose label is not in the list offered
                            none at all. It looked like a list that had lost
                            most of itself. Every row now offers the whole
                            vocabulary, always, in one order.

                            AND IT RECORDS WHICH TYPE, not just what it is
                            called. Writing the label alone is what left 11 of
                            12 live assets with no reference to the firm's
                            entry, so their unit size and parking ratio
                            resolved to nothing. Picking writes BOTH. */}
                        <td style={CELL}>
                          <select
                            style={TABLE_INPUT}
                            value={assetTypeSelectValue(asset, typeChoices)}
                            data-testid={`asset-row-${asset.id}-type`}
                            title="The asset type. The firm's list from the standards tab first, then the platform catalog. Picking one records WHICH type this is, which is what lets its unit size and parking ratio resolve."
                            onChange={(e) => onUpdateAsset(asset.id, assetTypePatch(e.target.value, typeChoices))}
                          >
                            <option value="">Not set</option>
                            {typeChoices.map((c) => (
                              <option key={c.key} value={c.key}>{c.label}{c.fromFirm ? '' : ' (catalog)'}</option>
                            ))}
                            {/* A LABEL THAT IS ON NEITHER LIST IS STILL AN
                                OPTION, or selecting it would be impossible and
                                the cell would silently show something else.
                                Nothing a user typed is ever dropped. */}
                            {assetTypeSelectValue(asset, typeChoices) === UNLISTED_TYPE && (
                              <option value={UNLISTED_TYPE}>{(asset.type ?? '').trim()} (not in the list)</option>
                            )}
                          </select>
                        </td>
                        <td style={CELL}>
                          <span style={{ fontSize: 10 }} data-testid={`asset-row-${asset.id}-strategy`}>{asset.strategy}</span>
                        </td>
                        <td style={CELL}>
                          <select
                            style={TABLE_INPUT}
                            value={asset.phaseId}
                            data-testid={`asset-row-${asset.id}-phase`}
                            onChange={(e) => onUpdateAsset(asset.id, { phaseId: e.target.value })}
                          >
                            {allPhases.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                          </select>
                        </td>
                        {/* PLOT AREA IS TYPED HERE IN SQM MODE. It was a plain
                            cell, so the only way to change an asset's draw was
                            the drawer. In percent and auto modes the figure is
                            DERIVED from the mode, so it stays read-only and says
                            which mode owns it rather than accepting a keystroke
                            it would silently discard.

                            ONE <td>, with the content switching inside it. A
                            ternary over two whole cells renders correctly but
                            puts two of them in the source, and U15 counts the
                            source: it caught this as a 15th column on a
                            14-column table the moment it was written. */}
                        <td
                          style={landAllocationMode === 'sqm' ? CELL : CELL_NUM}
                          title={landAllocationMode === 'sqm' ? undefined
                            : `Derived: the project allocates land by ${landAllocationMode === 'percent' ? 'percent' : 'BUA share'}. Change the mode above the parcels table to type sqm directly.`}
                        >
                          {landAllocationMode === 'sqm' ? (
                            <ChainCell
                              // THE CELL FOLLOWS THE RULE, NOT THE RAW FIELD.
                              // It read landAllocation.sqm directly, and a
                              // legacy seeded 0 is not undefined, so the input
                              // rendered "0" and suppressed the placeholder.
                              // The derivation was working the whole time: the
                              // engine and the plot check both drew the plot's
                              // full area while this cell said 0, which is a
                              // worse failure than the default not firing,
                              // because the row disagreed with itself. A stored
                              // figure shows only when the rule counts one.
                              value={drawSource === 'whole_plot' || drawSource === 'unset'
                                ? undefined
                                : asset.landAllocation?.sqm}
                              testId={`asset-row-${asset.id}-land`}
                              placeholder={formatArea(landSqm)}
                              title={drawSource === 'whole_plot'
                                ? `Blank, so this asset draws its whole plot: ${formatArea(landSqm)} sqm. Type a figure to draw less. Adding a second asset to this plot ends the default.`
                                : 'Sqm this asset draws from its plot. Blank on a plot it shares with nothing draws the whole plot.'}
                              onCommit={(v) => onUpdateAsset(asset.id, {
                                landAllocation: { ...(asset.landAllocation ?? {}), sqm: v },
                              })}
                            />
                          ) : (
                            <span data-testid={`asset-row-${asset.id}-land`}>{formatArea(landSqm)}</span>
                          )}
                        </td>
                        <td style={CELL}><ChainCell value={asset.landChain?.utilisationPct} testId={`asset-row-${asset.id}-utilisation`} title="Share of the plot that is developable." onCommit={(v) => patchChain({ utilisationPct: v })} /></td>
                        <td style={CELL}><ChainCell value={asset.landChain?.coveragePct} testId={`asset-row-${asset.id}-coverage`} title="Share of the Net Developable Area the main asset's footprint covers." onCommit={(v) => patchChain({ coveragePct: v })} /></td>
                        <td style={CELL}><ChainCell value={asset.landChain?.farRatio} testId={`asset-row-${asset.id}-far`} title="Total GFA = Net Developable Area x FAR." onCommit={(v) => patchChain({ farRatio: v })} /></td>
                        <td style={CELL}><ChainCell value={asset.landChain?.maxFloors} testId={`asset-row-${asset.id}-max-floors`} title="Height limit in storeys. Carried, not computed with." onCommit={(v) => patchChain({ maxFloors: v })} /></td>
                        <td style={CELL}><ChainCell value={asset.landChain?.retailPct} testId={`asset-row-${asset.id}-retail`} title="Share of the FOOTPRINT given to ground-floor retail." onCommit={(v) => patchChain({ retailPct: v })} /></td>
                        <td style={CELL}><ChainCell value={asset.landChain?.servicePct} testId={`asset-row-${asset.id}-service`} title="Service and back-of-house share off Main Asset GFA." onCommit={(v) => patchChain({ servicePct: v })} /></td>
                        <td style={CELL}><ChainCell value={asset.landChain?.retailAreaPerSlotSqm} testId={`asset-row-${asset.id}-retail-slot`} title="Retail GFA per required parking slot. Retail parking divides by THIS, never by the asset's own parking ratio." onCommit={(v) => patchChain({ retailAreaPerSlotSqm: v })} /></td>
                        <td style={CELL}>
                          <button
                            type="button"
                            onClick={() => onRemoveAsset(asset.id)}
                            data-testid={`asset-row-${asset.id}-remove`}
                            style={{ background: 'transparent', border: '1px solid var(--color-negative)', color: 'var(--color-negative)', borderRadius: 'var(--radius-sm)', padding: '1px 6px', cursor: 'pointer', fontSize: 10 }}
                          >
                            x
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr data-testid={`asset-${asset.id}-drawer`}>
                          <td colSpan={COLS} style={{ padding: 'var(--sp-1)', background: 'var(--color-surface)' }}>
                            <AssetCard
                              asset={asset}
                              allAssets={allAssets}
                              allPhases={allPhases}
                              parcels={parcels}
                              subUnits={subUnits}
                              project={project}
                              landAllocationMode={landAllocationMode}
                              assetTypeRegistry={assetTypeRegistry}
                              onUpdate={(patch) => onUpdateAsset(asset.id, patch)}
                              onRemove={() => onRemoveAsset(asset.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * TABLE TWO: what the chain produces.
 *
 * The WHOLE cascade, in the reference workbook's order, read only. It can
 * carry every step because it carries no input: with the derived columns out
 * of the table above, neither table has to choose between being complete and
 * being readable.
 */
/** The chain fields a line sums. Listed rather than inferred, so a new chain
 *  field is a deliberate addition here rather than a silent omission. */
const POOLED_AREA_KEYS = [
  'landUtilisedSqm', 'footprintSqm', 'landscapeSqm', 'retailGfaSqm', 'lobbyGfaSqm',
  'totalGfaSqm', 'mainAssetGfaSqm', 'netSaleableSqm', 'units', 'parkingSlots',
  'retailParkingSlots', 'totalParkingSlots', 'parkingAreaSqm', 'retailParkingAreaSqm',
  'totalParkingAreaSqm', 'totalBuaSqm',
] as const;

function AssetResultsTable({ rowGroups }: { rowGroups: RowGroup[] }): React.JSX.Element {
  // TWENTY columns, and the count is stated once. It was 19 in three places
  // (here, the colgroup and the band row) against 20 real columns, so the last
  // one had no declared width under `table-layout: fixed` and no band above
  // it: the outermost tier, the single most important figure in the table,
  // rendered as a squeezed nameless strip at the right edge.
  const COLS = 22;
  const d = (v: number | undefined): string => (v === undefined ? '-' : formatArea(v));
  const n = (v: number | undefined): string =>
    v === undefined ? '-' : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  // COUNTS PRINT WHOLE BECAUSE THEY ARE WHOLE. Rendering them through the
  // 2-decimal formatter would hide a regression in the rounding rule behind a
  // formatter that happens to round for display.
  const whole = (v: number | undefined): string =>
    v === undefined ? '-' : Math.round(v).toLocaleString();
  return (
    <div style={sectionCardStyle} data-testid="assets-results-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-1)' }}>
        <strong style={{ ...TABLE_TITLE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>3. Derived areas, per plot</strong>
        <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
          Read only, and read by no calculation. The chain runs once per plot. Same rows,
          same order as the table above.
        </span>
      </div>
      {/* WHICH VOCABULARY IS IN FORCE, stated, because no reader can infer it.
          THE DISPLAY CARRIES INDUSTRY WORDS; the internal fields invert the
          outer two tiers, so every tooltip names the field its column feeds
          and the cost method that reads it. */}
      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }} data-testid="assets-results-vocabulary">
        Columns use standard GCC development terms: NSA or GLA sits inside Total GFA sits inside
        Total BUA, so Total BUA is the outermost tier and includes parking. Our internal fields
        invert the outer two (Asset.buaSqm is Total GFA and Asset.gfaSqm is Total BUA), so each
        column&apos;s tooltip names the field it feeds and the cost method that reads it.
      </div>
      <div style={{ overflowX: 'auto' }}>
        {/* Identity cut to 88 and 150 (the results table needs only enough to
            say WHICH row this is; the input table above is where names are
            edited), which buys every derived column 86px. That is the width at
            which the longest label, "Retail parking area", wraps to TWO lines
            rather than three, so the header band stops being taller than the
            rows it labels. */}
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1958 }} data-testid="assets-results-table">
          <colgroup>
            <col style={{ width: 88 }} />
            <col style={{ width: 150 }} />
            {Array.from({ length: 20 }).map((_, i) => (<col key={`d-${i}`} style={{ width: 86 }} />))}
          </colgroup>
          <thead>
            {/* 2 + 5 + 5 + 7 + 1 = 20. Retail GFA sits in Floor area, not in
                Land and footprint: it is the footprint's retail SHARE expressed
                as floor area, and it pairs with Lobby GFA, which was already
                there. The outermost tier gets its own band called "Total"
                rather than joining Units and parking, which it is not. */}
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={TH_T} colSpan={2}>Asset</th>
              <th style={TH_T} colSpan={5}>Land and footprint</th>
              <th style={TH_T} colSpan={5}>Floor area</th>
              <th style={TH_T} colSpan={9}>Units and parking</th>
              <th style={TH_N}>Total</th>
            </tr>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={TH_T}>Plot</th>
              <th style={TH_T}>Asset</th>
              <th style={TH_N} title="The asset's share of its plot. Read by the land cost methods rate_per_land and rate_per_nda.">Plot Area (sqm)</th>
              <th style={TH_N} title="Plot Area x Land Utilisation %. Reference: Land Utilized Area. NOTE: the cost method rate_per_nda computes its own net developable area from a roads share and does NOT read this column.">Net Developable Area (sqm)</th>
              <th style={TH_N} title="Net Developable Area x Ground Coverage %. Reference: Total Used Footprint. Read by no cost method.">Building Footprint (sqm)</th>
              <th style={TH_N} title="One minus Ground Coverage %. Derived, never typed: the developable land the footprint does not cover.">Landscape %</th>
              <th style={TH_N} title="Net Developable Area x Landscape %. Reference: Total Landscape Area. Read by no cost method.">Landscape and Open Area (sqm)</th>
              <th style={TH_N} title="Building Footprint x Retail % (ground floor). Reference: Retail GFA. Read by no cost method.">Retail GFA (sqm)</th>
              <th style={TH_N} title="Building Footprint less Retail GFA. Reference: Lobby Area GFA. Read by no cost method.">Lobby and Circulation GFA (sqm)</th>
              {/* THE TWO CONTESTED TIERS CARRY THE PLATFORM'S WORDS, and each
                  tooltip names both the reference column and the platform field
                  it will feed, so the wiring cannot be done on the strength of a
                  shared word. Reference BUA is the OUTERMOST tier; platform BUA
                  is an inner one. */}
              <th style={TH_N} title="Net Developable Area x FAR, the building with no parking. INTERNAL FIELD: Asset.buaSqm, which is what the cost method rate_per_bua multiplies. Our field names invert the outer two tiers; the display carries the industry word.">Total GFA (sqm)</th>
              <th style={TH_N} title="Total GFA less Retail GFA and Lobby and Circulation GFA, or the whole of it when there is no retail. Read by no cost method.">Main Asset GFA (sqm)</th>
              <th style={TH_N} title="Main Asset GFA x (1 - Service %). INTERNAL FIELD: Asset.sellableBuaSqm, read by the cost method rate_per_nsa.">NSA or GLA (sqm)</th>
              <th style={TH_N} title="Sqm per unit or key. Sub-unit areas first, the asset type average as the fallback. From this project's asset type values on tab 4. Read by no cost method.">Average Unit Size (sqm)</th>
              <th style={TH_N} title="NSA or GLA / Average Unit Size, ROUNDED to whole units. A sub-unit count wins when there is one. Read by the cost method rate_per_unit.">Units or Keys</th>
              <th style={TH_N} title="Slots per unit, or sqm per slot on a retail basis. From this project's asset type values on tab 4. Read by no cost method.">Parking Ratio</th>
              <th style={TH_N} title="Units or Keys x Parking Ratio, off the ROUNDED count. INTERNAL FIELD: Asset.parkingBaysRequired, read by the cost method rate_per_parking_bay.">Parking Slots</th>
              <th style={TH_N} title="Retail GFA / Area per Slot for retail, on its OWN fixed figure and never the asset's own ratio. Read by no cost method.">Retail Parking Slots</th>
              <th style={TH_N} title="Parking Slots + Retail Parking Slots. Whole by construction. Read by no cost method.">Total Parking Slots</th>
              <th style={TH_N} title="Parking Slots x Area per Slot, the project figure on tab 4. Read by no cost method.">Parking Area (sqm)</th>
              <th style={TH_N} title="Retail Parking Slots x Area per Slot. Read by no cost method.">Retail Parking Area (sqm)</th>
              <th style={TH_N} title="Parking Area + Retail Parking Area. Read by no cost method.">Total Parking Area (sqm)</th>
              <th style={TH_N} title="Total GFA + Total Parking Area, everything built. INTERNAL FIELD: Asset.gfaSqm, which is what the cost method rate_per_gfa multiplies. Our field names invert the outer two tiers; the display carries the industry word.">Total BUA (sqm)</th>
            </tr>
          </thead>
          <tbody>
            {rowGroups.map(({ group, plotLabel, rows }) => (
              <React.Fragment key={group.key}>
                <PlotHeaderRow g={group} plotLabel={plotLabel} colSpan={COLS} showCheck={false} />
                {rows.length === 0 && (
                  <tr data-testid={`plot-group-${group.key}-results-empty`}>
                    <td style={{ ...CELL, color: 'var(--color-meta)', fontStyle: 'italic' }} colSpan={COLS}>
                      No assets drawing from this plot yet.
                    </td>
                  </tr>
                )}
                {/* ONE ROW PER PLOT, THE CHAIN RUN INDIVIDUALLY. Nothing is
                    pooled here. Two plots of one type can have different
                    utilisation, coverage and FAR, so this is the only place
                    those percentages have a single honest answer; the merge
                    below adds up what they produced. */}
                {rows.map(({ asset, chain, landSqm, parcel, unitSizeSqm, unitSizeSource, parkingRatio, parkingRatioBasis }) => (
                  <tr
                    key={asset.id}
                    style={{ borderBottom: '1px solid var(--color-border)', opacity: asset.visible ? 1 : 0.55 }}
                    data-testid={`asset-result-${asset.id}`}
                  >
                    <td style={{ ...CELL, color: 'var(--color-meta)', fontSize: 10 }}>{parcel ? parcel.name : 'none'}</td>
                    {/* NAME AND TYPE, because the merged table below groups by
                        TYPE and a reader tracing a row into it needs to see
                        which one this is. */}
                    <td style={CELL} data-testid={`asset-result-${asset.id}-label`}>
                      {assetDisplayName(asset)}
                      {assetTypeSuffix(asset) && (
                        <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{assetTypeSuffix(asset)}</div>
                      )}
                    </td>
                    <td style={CELL_NUM}>{formatArea(landSqm)}</td>
                    <td style={CELL_DERIVED} data-testid={`asset-result-${asset.id}-land-utilised`}>{d(chain.landUtilisedSqm)}</td>
                    <td style={CELL_DERIVED}>{d(chain.footprintSqm)}</td>
                    <td style={CELL_DERIVED}>{chain.landscapePct === undefined ? '-' : `${n(chain.landscapePct)}%`}</td>
                    <td style={CELL_DERIVED}>{d(chain.landscapeSqm)}</td>
                    <td style={CELL_DERIVED}>{d(chain.retailGfaSqm)}</td>
                    <td style={CELL_DERIVED}>{d(chain.lobbyGfaSqm)}</td>
                    <td style={CELL_DERIVED} data-testid={`asset-result-${asset.id}-total-gfa`}>{d(chain.totalGfaSqm)}</td>
                    <td style={CELL_DERIVED}>{d(chain.mainAssetGfaSqm)}</td>
                    <td style={CELL_DERIVED} data-testid={`asset-result-${asset.id}-net-saleable`}>{d(chain.netSaleableSqm)}</td>
                    <td style={CELL_DERIVED} data-testid={`asset-result-${asset.id}-unit-size`}
                      title={unitSizeSource ? `Source: ${unitSizeSource}` : undefined}>{d(unitSizeSqm)}</td>
                    <td style={CELL_DERIVED} data-testid={`asset-result-${asset.id}-units`}>{whole(chain.units)}</td>
                    <td style={CELL_DERIVED} data-testid={`asset-result-${asset.id}-parking-ratio`}
                      title={parkingRatioBasis === 'sqm_per_slot' ? 'sqm per slot' : 'slots per unit'}>{n(parkingRatio)}</td>
                    <td style={CELL_DERIVED}>{whole(chain.parkingSlots)}</td>
                    <td style={CELL_DERIVED}>{whole(chain.retailParkingSlots)}</td>
                    <td style={CELL_DERIVED}>{whole(chain.totalParkingSlots)}</td>
                    <td style={CELL_DERIVED}>{d(chain.parkingAreaSqm)}</td>
                    <td style={CELL_DERIVED}>{d(chain.retailParkingAreaSqm)}</td>
                    <td style={CELL_DERIVED}>{d(chain.totalParkingAreaSqm)}</td>
                    <td style={{ ...CELL_DERIVED, fontWeight: 700 }} data-testid={`asset-result-${asset.id}-total-bua`}>{d(chain.totalBuaSqm)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
        A dash means a step could not be derived, which is not the same as zero. Open a row above to see why.
      </div>
    </div>
  );
}

/**
 * TABLE FOUR: THE MERGE, AND IT SUMS RESULTS.
 *
 * One row per consolidated line, which is one type in one phase. The areas are
 * summed from the per-plot chain results in the table above, never recomputed:
 * this table holds the same AssetRow objects table 3 rendered, so it cannot
 * disagree with it.
 *
 * THE THREE RATIOS ARE QUOTIENTS OF THIS ROW'S OWN SUMS. Landscape %,
 * Average Unit Size and Parking Ratio are per-plot properties, so a merged row
 * cannot inherit one; the first cut printed a dash and left the reader with
 * nothing. Dividing one summed column by another gives a real blended figure
 * whose definition a reader can check against the two cells beside it, which a
 * mean of the plots' inputs could not.
 *
 * No sub-units here. They have their own table below, grouped under the line.
 */
function MergedLineTable({
  lineRowGroups, allPhases,
}: {
  lineRowGroups: LineRowGroup[];
  allPhases: Phase[];
}): React.JSX.Element {
  // 4 identity + 20 derived. Counts agree or U15 fails.
  const COLS = 24;
  const d = (v: number | undefined): string => (v === undefined ? '-' : formatArea(v));
  const n = (v: number | undefined): string =>
    v === undefined ? '-' : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const whole = (v: number | undefined): string =>
    v === undefined ? '-' : Math.round(v).toLocaleString();
  /** a / b, and ABSENT rather than zero when the denominator is not there. A
   *  zero would read as "this line has no landscape", a different claim. */
  const ratio = (a: number | undefined, b: number | undefined): number | undefined =>
    (typeof a === 'number' && typeof b === 'number' && b > 0) ? a / b : undefined;
  const live = lineRowGroups.filter((l) => l.rows.length > 0);
  return (
    <div style={sectionCardStyle} data-testid="assets-merged-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-1)' }}>
        <strong style={{ ...TABLE_TITLE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>4. Merged by line</strong>
        <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
          One row per type per phase, summing the per-plot areas above. This is how the schedules read the project.
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }} data-testid="assets-merged-note">
        Areas ADD. The three ratio columns are this row&apos;s own sums divided by each other
        (Landscape % is Landscape and Open Area over Net Developable Area, Average Unit Size is
        NSA over Units, Parking Ratio is Parking Slots over Units), so a line built from two
        plots with different massing still states one honest blended figure. Read by no
        calculation yet.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 2094 }} data-testid="assets-merged-table">
          <colgroup>
            <col style={{ width: 150 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 54 }} />
            {Array.from({ length: 20 }).map((_, i) => (<col key={`m-${i}`} style={{ width: 86 }} />))}
          </colgroup>
          <thead>
            {/* 4 + 5 + 5 + 9 + 1 = 24. */}
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={TH_T} colSpan={4}>Line</th>
              <th style={TH_T} colSpan={5}>Land and footprint</th>
              <th style={TH_T} colSpan={5}>Floor area</th>
              <th style={TH_T} colSpan={9}>Units and parking</th>
              <th style={TH_N}>Total</th>
            </tr>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={TH_T}>Type</th>
              <th style={TH_T}>Phase</th>
              <th style={TH_T}>Strategy</th>
              <th style={TH_N} title="How many plots feed this line.">Plots</th>
              <th style={TH_N} title="Sum of the plot areas drawn by this line's assets.">Plot Area (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot Net Developable Areas.">Net Developable Area (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot Building Footprints.">Building Footprint (sqm)</th>
              <th style={TH_N} title="Landscape and Open Area / Net Developable Area, from this row's own sums. It is a blended figure, not one plot's coverage.">Landscape %</th>
              <th style={TH_N} title="Sum of the per-plot Landscape and Open Areas.">Landscape and Open Area (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot Retail GFA.">Retail GFA (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot Lobby and Circulation GFA.">Lobby and Circulation GFA (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot Total GFA. INTERNAL FIELD: Asset.buaSqm, read by the cost method rate_per_bua.">Total GFA (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot Main Asset GFA.">Main Asset GFA (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot NSA or GLA. INTERNAL FIELD: Asset.sellableBuaSqm, read by the cost method rate_per_nsa.">NSA or GLA (sqm)</th>
              <th style={TH_N} title="NSA or GLA / Units or Keys, from this row's own sums. The blended size across the line's plots.">Average Unit Size (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot unit counts, each already whole. Read by the cost method rate_per_unit.">Units or Keys</th>
              <th style={TH_N} title="Parking Slots / Units or Keys, from this row's own sums. The blended slots per unit the line actually builds.">Parking Ratio</th>
              <th style={TH_N} title="Sum of the per-plot Parking Slots. INTERNAL FIELD: Asset.parkingBaysRequired, read by the cost method rate_per_parking_bay.">Parking Slots</th>
              <th style={TH_N} title="Sum of the per-plot Retail Parking Slots.">Retail Parking Slots</th>
              <th style={TH_N} title="Parking Slots + Retail Parking Slots.">Total Parking Slots</th>
              <th style={TH_N} title="Sum of the per-plot Parking Areas.">Parking Area (sqm)</th>
              <th style={TH_N} title="Sum of the per-plot Retail Parking Areas.">Retail Parking Area (sqm)</th>
              <th style={TH_N} title="Parking Area + Retail Parking Area.">Total Parking Area (sqm)</th>
              <th style={TH_N} title="Total GFA + Total Parking Area, everything this line builds. INTERNAL FIELD: Asset.gfaSqm, read by the cost method rate_per_gfa.">Total BUA (sqm)</th>
            </tr>
          </thead>
          <tbody>
            {live.length === 0 && (
              <tr data-testid="assets-merged-empty">
                <td style={{ ...CELL, color: 'var(--color-meta)', fontStyle: 'italic' }} colSpan={COLS}>
                  No lines yet. A line appears once an asset has a type and a phase.
                </td>
              </tr>
            )}
            {live.map(({ group, rows }) => {
              const pooled = poolLineAreas(
                rows.map((r) => r.chain as unknown as Record<string, number | undefined>),
                POOLED_AREA_KEYS,
              );
              const landSqm = rows.reduce((t, r) => t + r.landSqm, 0);
              const land = poolLineLand(rows.map((r) => ({
                assetId: r.asset.id,
                parcelId: r.parcel?.id,
                sqm: r.landSqm,
                rate: r.parcel?.rate ?? 0,
                value: r.landSqm * (r.parcel?.rate ?? 0),
              })));
              const g = (k: string): number | undefined => (k in pooled ? pooled[k] : undefined);
              const p = (k: string): string => d(g(k));
              const w = (k: string): string => whole(g(k));
              const conflicts = lineConflicts(rows);
              const landscapePct = ratio(g('landscapeSqm'), g('landUtilisedSqm'));
              const avgUnitSize = ratio(g('netSaleableSqm'), g('units'));
              const parkingRatio = ratio(g('parkingSlots'), g('units'));
              return (
                <tr
                  key={group.key}
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                  data-testid={`line-result-${group.key}`}
                >
                  <td style={{ ...CELL, fontWeight: 600 }}>
                    {group.typeLabel}
                    {!group.typed && (
                      <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--color-meta)', marginLeft: 6 }}>
                        (untyped, so it merges alone)
                      </span>
                    )}
                  </td>
                  <td style={CELL}>{allPhases.find((ph) => ph.id === group.phaseId)?.name ?? group.phaseId}</td>
                  <td style={CELL}>
                    {lineStrategy(rows)}
                    {/* THE CONFLICT IS SHOWN, NEVER RESOLVED SILENTLY. Empty on
                        every live line today, because a line-level field still
                        lives on the member asset and the plots agree. */}
                    {conflicts.length > 0 && (
                      <span
                        data-testid={`line-result-${group.key}-conflict`}
                        title={`These belong to the line, so the plots should not differ on them: ${conflicts.join(', ')}`}
                        style={{
                          fontSize: 9, fontWeight: 700, marginLeft: 6, padding: '1px 5px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'color-mix(in srgb, var(--color-warning, #92400e) 18%, transparent)',
                          color: 'var(--color-warning, #92400e)',
                        }}
                      >
                        {conflicts.length} disagree
                      </span>
                    )}
                  </td>
                  <td style={CELL_NUM} title={land.plotCount === 0 ? 'draws from no plot yet' : `blended land rate ${fmt(land.weightedRate)} /sqm`}>
                    {rows.length}
                  </td>
                  <td style={CELL_NUM} data-testid={`line-result-${group.key}-land`}>{formatArea(landSqm)}</td>
                  <td style={CELL_DERIVED} data-testid={`line-result-${group.key}-land-utilised`}>{p('landUtilisedSqm')}</td>
                  <td style={CELL_DERIVED}>{p('footprintSqm')}</td>
                  <td style={CELL_DERIVED} data-testid={`line-result-${group.key}-landscape-pct`}>
                    {landscapePct === undefined ? '-' : `${n(landscapePct * 100)}%`}
                  </td>
                  <td style={CELL_DERIVED}>{p('landscapeSqm')}</td>
                  <td style={CELL_DERIVED}>{p('retailGfaSqm')}</td>
                  <td style={CELL_DERIVED}>{p('lobbyGfaSqm')}</td>
                  <td style={CELL_DERIVED} data-testid={`line-result-${group.key}-total-gfa`}>{p('totalGfaSqm')}</td>
                  <td style={CELL_DERIVED}>{p('mainAssetGfaSqm')}</td>
                  <td style={CELL_DERIVED} data-testid={`line-result-${group.key}-net-saleable`}>{p('netSaleableSqm')}</td>
                  <td style={CELL_DERIVED} data-testid={`line-result-${group.key}-unit-size`}>{d(avgUnitSize)}</td>
                  <td style={CELL_DERIVED} data-testid={`line-result-${group.key}-units`}>{w('units')}</td>
                  <td style={CELL_DERIVED} data-testid={`line-result-${group.key}-parking-ratio`}>{n(parkingRatio)}</td>
                  <td style={CELL_DERIVED}>{w('parkingSlots')}</td>
                  <td style={CELL_DERIVED}>{w('retailParkingSlots')}</td>
                  <td style={CELL_DERIVED}>{w('totalParkingSlots')}</td>
                  <td style={CELL_DERIVED}>{p('parkingAreaSqm')}</td>
                  <td style={CELL_DERIVED}>{p('retailParkingAreaSqm')}</td>
                  <td style={CELL_DERIVED}>{p('totalParkingAreaSqm')}</td>
                  <td style={{ ...CELL_DERIVED, fontWeight: 700 }} data-testid={`line-result-${group.key}-total-bua`}>{p('totalBuaSqm')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
        A dash means a step could not be derived on any of the line&apos;s plots, which is not the same as zero.
      </div>
    </div>
  );
}

/** The four asset tables, stacked, from ONE resolved row list. */
function AssetTables({
  groups, lineGroups, allAssets, allPhases, parcels, subUnits, project,
  landAllocationMode, assetTypeRegistry, onUpdateAsset, onRemoveAsset, onAddAsset,
}: AssetTableProps): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const rowGroups = buildAssetRows(groups, allAssets, parcels, subUnits, project, landAllocationMode);
  // The SAME rows, regrouped. Table 4 cannot disagree with table 3 because it
  // is not holding its own copy of them.
  const lineRowGroups = buildLineRows(rowGroups, lineGroups);
  return (
    <>
      <AssetInputsTable
        rowGroups={rowGroups}
        allPhases={allPhases}
        project={project}
        assetTypeRegistry={assetTypeRegistry}
        allAssets={allAssets}
        parcels={parcels}
        subUnits={subUnits}
        landAllocationMode={landAllocationMode}
        openId={openId}
        setOpenId={setOpenId}
        onUpdateAsset={onUpdateAsset}
        onRemoveAsset={onRemoveAsset}
        onAddAsset={onAddAsset}
      />
      <AssetResultsTable rowGroups={rowGroups} />
      <MergedLineTable lineRowGroups={lineRowGroups} allPhases={allPhases} />
    </>
  );
}

// ── The sub-units TABLE ────────────────────────────────────────────────────
//
// Every sub-unit in the project in one table, with the PARENT ASSET picked on
// the add row. The per-asset table inside the card stays for now (this commit
// is additive); commit 2 removes it.

/** One editable number in the sub-unit table. Draft while typing so a
 *  half-typed entry and an empty cell both survive; blank clears to absent. */
function SubUnitNumber({
  value, onCommit, testId, title,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  testId: string;
  title: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const stored = value !== undefined ? String(Math.round(value * 100) / 100) : '';
  const parsed = draft === null ? null : (draft.trim() === '' ? undefined : Number(draft));
  const bad = parsed !== null && parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0);
  return (
    <input
      style={{ ...TABLE_NUM_INPUT, ...(bad ? { borderColor: 'var(--color-negative)' } : {}) }}
      value={draft ?? stored}
      inputMode="decimal"
      placeholder="not set"
      title={title}
      data-testid={testId}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const t = next.trim();
        if (t === '') { onCommit(undefined); return; }
        const num = Number(t);
        if (Number.isFinite(num) && num >= 0) onCommit(num);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** Sub-units under the asset they belong to, with that asset's own NSA and
 *  the sum of its parts, so the check is beside the thing it checks. */
interface SubUnitGroup {
  asset?: Asset;
  rows: SubUnit[];
  nsa: number;
  areaSum: number;
  status?: 'ok' | 'under' | 'over';
}

interface SubUnitLine {
  key: string;
  label: string;
  phaseName?: string;
  groups: SubUnitGroup[];
  nsa: number;
  areaSum: number;
  status?: 'ok' | 'under' | 'over';
}

/**
 * SUB-UNITS GROUP UNDER THE LINE, AND STILL BELONG TO THE PLOT ASSET.
 *
 * The grouping is presentation: a sub-unit assetId is untouched, and it
 * re-parents in the next pass together with the engine's twelve lookup sites
 * and the seventeen asset-keyed cost overrides, because a half-moved parent is
 * two answers to one question.
 *
 * THE SUB-UNITS ARE PARTITIONED BEFORE THE LINES ARE WALKED, and the partition
 * is a pure function in assetTableModel, which is where its own docblock
 * records the defect that produced it. This function only turns that partition
 * into rows: the arithmetic of the check, and nothing about which sub-unit
 * belongs where.
 */
function groupSubUnitsByLine(
  assets: Asset[],
  subUnits: SubUnit[],
  phaseIds: string[],
  phases: Phase[],
): SubUnitLine[] {
  const { lines, stray } = partitionSubUnitsByLine(assets, subUnits, phaseIds, normaliseAssetTypeId);
  const out: SubUnitLine[] = [];
  for (const line of lines) {
    const groups = groupSubUnitsByAsset(line.members, line.subUnits);
    const nsa = groups.reduce((t, g) => t + g.nsa, 0);
    const areaSum = groups.reduce((t, g) => t + g.areaSum, 0);
    let status: 'ok' | 'under' | 'over' | undefined;
    if (nsa > 0) status = Math.abs(areaSum - nsa) < 0.01 ? 'ok' : (areaSum < nsa ? 'under' : 'over');
    if (groups.some((g) => g.rows.length > 0)) {
      out.push({
        key: line.key,
        label: line.typeLabel,
        phaseName: phases.find((p) => p.id === line.phaseId)?.name,
        groups,
        nsa,
        areaSum,
        status,
      });
    }
  }
  // WHAT IS ON NO LINE STILL HAS TO BE REACHABLE. A sub-unit pointing at a
  // deleted asset, or at a companion (which the caller filters out, because a
  // companion's sub-units mirror its parent's), belongs to no line and would
  // otherwise be invisible and undeletable. ONE bucket at the end, holding only
  // what nothing else claimed, rather than one per line holding everything.
  if (stray.length > 0) {
    const groups = groupSubUnitsByAsset([], stray);
    out.push({
      key: '__no_line__',
      label: 'Not on a line',
      groups,
      nsa: 0,
      areaSum: groups.reduce((t, g) => t + g.areaSum, 0),
    });
  }
  return out;
}

function groupSubUnitsByAsset(assets: Asset[], subUnits: SubUnit[]): SubUnitGroup[] {
  const byAssetId = new Map<string, SubUnit[]>();
  for (const u of subUnits) {
    const list = byAssetId.get(u.assetId) ?? [];
    list.push(u);
    byAssetId.set(u.assetId, list);
  }
  const out: SubUnitGroup[] = [];
  const emit = (asset: Asset | undefined, rows: SubUnit[]): void => {
    const areaSum = rows.reduce((t, u) => {
      const unitArea = Math.max(0, u.unitArea ?? 0);
      const isUnits = (asset?.subUnitMetric ?? u.metric) === 'units';
      return t + (isUnits ? u.metricValue * unitArea : u.metricValue);
    }, 0);
    const nsa = Math.max(0, asset?.sellableBuaSqm ?? 0);
    // A HUNDREDTH OF A SQM IS NOT A DISAGREEMENT. The tolerance is absolute
    // and tiny, so a real gap always shows and float noise never does.
    let status: SubUnitGroup['status'];
    if (nsa > 0) status = Math.abs(areaSum - nsa) < 0.01 ? 'ok' : (areaSum < nsa ? 'under' : 'over');
    out.push({ asset, rows, nsa, areaSum, status });
  };
  for (const a of assets) {
    const rows = byAssetId.get(a.id);
    if (rows && rows.length > 0) { emit(a, rows); byAssetId.delete(a.id); }
  }
  // Anything pointing at an asset that no longer exists still has to be
  // reachable, or a row becomes invisible and undeletable.
  const orphans = [...byAssetId.values()].flat();
  if (orphans.length > 0) emit(undefined, orphans);
  return out;
}

function SubUnitsTable({
  assets, phases, subUnits, project, onAdd, onUpdate, onRemove,
}: {
  assets: Asset[];
  phases: Phase[];
  subUnits: SubUnit[];
  project: Project;
  onAdd: (assetId: string) => void;
  onUpdate: (id: string, patch: Partial<SubUnit>) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const [parentId, setParentId] = useState<string>(assets[0]?.id ?? '');
  const subUnitLines = groupSubUnitsByLine(assets, subUnits, phases.map((p) => p.id), phases);

  return (
    <div style={sectionCardStyle} data-testid="subunits-table-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
        <strong style={{ ...TABLE_TITLE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>5. Sub-units, under the merged line</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 10, color: 'var(--color-meta)' }} htmlFor="subunits-parent-pick">Add to</label>
          <select
            id="subunits-parent-pick"
            style={{ ...TABLE_INPUT, width: 220 }}
            value={parentId}
            data-testid="subunits-parent-pick"
            onChange={(e) => setParentId(e.target.value)}
          >
            {/* THE TYPE RIDES ALONG HERE TOO. Picking a parent by an invented
                name is picking which consolidated line the sub-unit joins, so
                the type is the half of the label that decides anything. */}
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {assetDisplayName(a)}{assetTypeSuffix(a) ? ` (${assetTypeSuffix(a)})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!parentId}
            onClick={() => onAdd(parentId)}
            data-testid="subunits-add-subunit"
            className="btn-primary"
            style={{ padding: '3px 10px', fontSize: 11 }}
          >
            + Sub-unit
          </button>
        </div>
      </div>
      {subUnits.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid="subunits-table-empty">
          No sub-units yet. Pick an asset above and add one so revenue (Module 2) can attach.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1180 }} data-testid="subunits-table">
            <colgroup>
              <col style={{ width: 210 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 116 }} />
              <col style={{ width: 116 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={TH_T}>Sub-unit</th>
                <th style={TH_T}>Category</th>
                <th style={TH_N} title="This sub-unit's share of its asset's NSA or GLA. Type this OR the area; the other one derives.">NSA Share %</th>
                <th style={TH_N} title="Sqm this sub-unit occupies. Type this OR the share; the other one derives. In count mode it derives from Count x Average Unit Size.">Area (sqm)</th>
                <th style={TH_N} title="Sqm of ONE unit or key in this sub-unit. Typed here, per sub-unit: without it there is nothing to divide the area by and the count cannot be derived.">Average Unit Size (sqm)</th>
                <th style={TH_N} title="Area / Average Unit Size, rounded to whole units. You cannot build a fraction of an apartment.">Units or Keys</th>
                <th style={TH_N}>Rate ({project.currency})</th>
                <th style={TH_T} title="What the rate is charged ON. It differs by category and by whether the asset counts units or area, so per sqm, per unit, per key and per year all appear in this column and are not interchangeable.">Rate Basis</th>
                <th style={TH_T}></th>
              </tr>
            </thead>
            <tbody>
              {subUnitLines.flatMap((line) => [
                // THE LINE HEADER. One row per consolidated line, with the
                // line's own NSA check above the assets that make it up.
                <tr key={`line-${line.key}`} style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}
                  data-testid={`subunits-line-${line.key}`}>
                  <td style={{ ...CELL, fontWeight: 700, color: 'inherit' }} colSpan={2}>
                    {line.label}
                    {line.phaseName && (
                      <span style={{ fontWeight: 400, opacity: 0.75, marginLeft: 8 }}>{line.phaseName}</span>
                    )}
                  </td>
                  <td style={{ ...CELL_NUM, color: 'inherit' }}>{line.nsa > 0 ? formatArea(line.nsa) : '-'}</td>
                  <td style={{ ...CELL_NUM, color: 'inherit' }} data-testid={`subunits-line-${line.key}-sum`}>{formatArea(line.areaSum)}</td>
                  <td style={{ ...CELL, color: 'inherit', fontSize: 10 }} colSpan={5}>
                    {line.key === '__no_line__'
                      ? 'These point at an asset that is not on a line (deleted, or a companion whose sub-units mirror its parent).'
                      : line.status === undefined
                        ? 'No NSA entered on this line, so there is nothing to check the parts against.'
                        : line.status === 'ok' ? 'Sub-units sum to the line NSA'
                          : line.status === 'under' ? 'Under-allocated against the line NSA'
                            : 'Over-allocated against the line NSA'}
                  </td>
                </tr>,
                ...line.groups.map(({ asset, rows, nsa, areaSum, status }) => (
                <React.Fragment key={asset?.id ?? 'unassigned'}>
                  {/* THE CHECK IS PER ASSET, because the rule it states is per
                      asset: the parts have to sum to the whole they are parts
                      of. It reads the asset's OWN entered NSA, never the
                      derived chain figure, which is what keeps the derivation
                      out of an editing surface. */}
                  <tr style={{ background: 'var(--color-primary-pale)' }} data-testid={`subunits-group-${asset?.id ?? 'unassigned'}`}>
                    {/* THE TYPE IS SHOWN BESIDE THE NAME, because everything
                        downstream keys off the type and a row labelled with an
                        invented name says nothing about which line it joins,
                        which cost method reads it, or whose standards it uses.
                        Omitted when the asset is already called by its type. */}
                    <td style={{ ...CELL, fontWeight: 700 }} colSpan={2}>
                      {asset ? assetDisplayName(asset) : 'Unassigned'}
                      {asset && assetTypeSuffix(asset) && (
                        <span
                          style={{ fontWeight: 400, color: 'var(--color-meta)', marginLeft: 6 }}
                          data-testid={`subunits-group-${asset.id}-type`}
                        >
                          {assetTypeSuffix(asset)}
                        </span>
                      )}
                      <span style={{ fontWeight: 400, color: 'var(--color-meta)', marginLeft: 8 }}>
                        {rows.length} sub-unit{rows.length === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td style={CELL_NUM} data-testid={`subunits-group-${asset?.id ?? 'unassigned'}-nsa`}>
                      {nsa > 0 ? formatArea(nsa) : '-'}
                    </td>
                    <td style={CELL_NUM} data-testid={`subunits-group-${asset?.id ?? 'unassigned'}-sum`}>{formatArea(areaSum)}</td>
                    <td style={CELL} colSpan={5}>
                      {status && (
                        <span
                          data-testid={`subunits-group-${asset?.id ?? 'unassigned'}-check`}
                          style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                            background: status === 'ok'
                              ? 'color-mix(in srgb, var(--color-positive, #15803d) 16%, transparent)'
                              : 'color-mix(in srgb, var(--color-warning, #92400e) 18%, transparent)',
                            color: status === 'ok' ? 'var(--color-positive, #15803d)' : 'var(--color-warning, #92400e)',
                          }}
                        >
                          {status === 'ok' ? 'Sub-units sum to NSA' : status === 'under' ? 'Under-allocated' : 'Over-allocated'}
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>
                        {nsa <= 0
                          ? 'This asset has no NSA entered, so there is nothing to check the parts against.'
                          : `${formatArea(areaSum)} of ${formatArea(nsa)} sqm allocated (${((areaSum / nsa) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%).`}
                      </span>
                    </td>
                  </tr>
                  {rows.map((u) => {
                    const isUnits = (asset?.subUnitMetric ?? u.metric) === 'units';
                    const unitArea = Math.max(0, u.unitArea ?? 0);
                    const area = isUnits ? u.metricValue * unitArea : u.metricValue;
                    // A COUNT NOBODY CAN DERIVE IS NOT ZERO. With no unit size
                    // there is nothing to divide the area by, so the cell says
                    // so. Printing 0 asserted "this row has no units", which is
                    // a different claim and a false one.
                    const count: number | undefined = isUnits
                      ? u.metricValue
                      : (unitArea > 0 ? Math.round(u.metricValue / unitArea) : undefined);
                    const sharePct = nsa > 0 ? (area / nsa) * 100 : undefined;
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }} data-testid={`subunits-row-${u.id}`}>
                        <td style={CELL}>
                          <input
                            style={TABLE_INPUT}
                            value={u.name}
                            placeholder="unnamed"
                            data-testid={`subunits-row-${u.id}-name`}
                            onChange={(e) => onUpdate(u.id, { name: e.target.value })}
                          />
                        </td>
                        <td style={CELL}>
                          <select
                            style={TABLE_INPUT}
                            value={u.category}
                            data-testid={`subunits-row-${u.id}-category`}
                            onChange={(e) => onUpdate(u.id, { category: e.target.value as SubUnitCategory })}
                          >
                            {SUB_UNIT_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                          </select>
                        </td>
                        {/* SHARE AND AREA ARE ONE PAIR: type either, the other
                            follows. The share is only an INPUT in area mode,
                            because in count mode the count is the input and a
                            share typed there would have two ways to resolve. */}
                        <td style={CELL}>
                          {isUnits || nsa <= 0 ? (
                            <span style={{ ...CELL_NUM, display: 'block' }} data-testid={`subunits-row-${u.id}-share`}
                              title={nsa <= 0
                                ? 'This asset has no NSA entered, so a share of it cannot be computed.'
                                : 'This asset counts units, so the count is what you type and the share follows from it.'}>
                              {sharePct === undefined ? '-' : `${sharePct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                            </span>
                          ) : (
                            <SubUnitNumber
                              value={sharePct}
                              testId={`subunits-row-${u.id}-share`}
                              title="This sub-unit's share of the asset's NSA. Typing here sets the area."
                              onCommit={(v) => onUpdate(u.id, { metricValue: v === undefined ? 0 : (nsa * v) / 100 })}
                            />
                          )}
                        </td>
                        <td style={CELL}>
                          {isUnits ? (
                            <span style={{ ...CELL_NUM, display: 'block' }} data-testid={`subunits-row-${u.id}-area`}
                              title="Count x Average Unit Size. This asset counts units, so the area follows.">
                              {formatArea(area)}
                            </span>
                          ) : (
                            <SubUnitNumber
                              value={u.metricValue}
                              testId={`subunits-row-${u.id}-area`}
                              title="Sqm this sub-unit occupies. Typing here sets the share."
                              onCommit={(v) => onUpdate(u.id, { metricValue: v ?? 0 })}
                            />
                          )}
                        </td>
                        <td style={CELL}>
                          <SubUnitNumber
                            value={u.unitArea}
                            testId={`subunits-row-${u.id}-unit-size`}
                            title="Sqm of ONE unit or key here. The count below divides the area by it."
                            onCommit={(v) => onUpdate(u.id, { unitArea: v })}
                          />
                        </td>
                        <td style={CELL}>
                          {isUnits ? (
                            <SubUnitNumber
                              value={u.metricValue}
                              testId={`subunits-row-${u.id}-count`}
                              title="Whole units or keys. This asset counts units, so this is what you type."
                              onCommit={(v) => onUpdate(u.id, { metricValue: v === undefined ? 0 : Math.round(v) })}
                            />
                          ) : (
                            <span style={{ ...CELL_NUM, display: 'block' }} data-testid={`subunits-row-${u.id}-count`}>
                              {count === undefined
                                ? <span title="No unit size, so there is nothing to divide the area by. This is not a count of zero.">-</span>
                                : count.toLocaleString()}
                            </span>
                          )}
                        </td>
                        {/* A RATE IS NOT A PROJECT TOTAL. It is a price per sqm
                            or per unit, so it never takes the project's number
                            scale: at 'thousands' a rate of 18,500 rendered as
                            "19". The card always showed rates at full scale; so
                            does this. */}
                        <td style={CELL_NUM} data-testid={`subunits-row-${u.id}-rate`}>
                          {formatAccounting(u.unitPrice, 'full', project.displayDecimals ?? 2)}
                        </td>
                        <td style={{ ...CELL, fontSize: 10, color: 'var(--color-meta)' }} data-testid={`subunits-row-${u.id}-rate-basis`}>
                          {rateUnitLabel(u.category, isUnits ? 'units' : 'area') || 'no rate'}
                        </td>
                        <td style={CELL}>
                          <button
                            type="button"
                            onClick={() => onRemove(u.id)}
                            data-testid={`subunits-row-${u.id}-remove`}
                            style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '1px 6px', cursor: 'pointer', fontSize: 10 }}
                          >
                            x
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
        Share, area, unit size and count are one identity: type any two that make sense for the
        asset and the rest follow. The check on each asset compares the parts against that
        asset&apos;s own entered NSA, not against the derived area chain.
      </div>
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
  assetTypeRegistry: { entries: AssetTypeStandard[]; available: boolean };
  onUpdate: (patch: Partial<Asset>) => void;
  onRemove: () => void;
}

function AssetCard({
  asset, allAssets, allPhases, parcels, subUnits, project,
  landAllocationMode, assetTypeRegistry, onUpdate, onRemove,
}: AssetCardProps): React.JSX.Element {
  const { addSubUnit, updateSubUnit, removeSubUnit, dismissStrategyReview } = useModule1Store(
    useShallow((s) => ({
      addSubUnit: s.addSubUnit,
      updateSubUnit: s.updateSubUnit,
      removeSubUnit: s.removeSubUnit,
      dismissStrategyReview: s.dismissStrategyReview,
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
  // 2026-08-17: both weighted scopes, resolved here so each option in the
  // dropdown can show the rate it would produce. A label that names a scope
  // without naming its number is what let "(Weighted Average)" sit there
  // reading zero on a phase that holds no parcels.
  const phaseWeightedRate = computeLandAggregate(phaseParcels).weightedRate;
  const allWeightedRate = computeLandAggregate(parcels).weightedRate;
  const phaseNameById = useMemo(
    () => new Map(allPhases.map((p) => [p.id, p.name])),
    [allPhases],
  );
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

  // (addSplit / removeSplit / updateSplit are gone with the editor they drove.
  // Nothing in the app can create a multi-parcel split any more; the engine
  // still reads one so a legacy snapshot computes rather than losing its land.)

  // 2026-08-15: a new sub-unit arrives EMPTY. It used to carry 50 units of
  // 100 sqm at 1,000,000 each, which is 5,000 sqm of BUA and 50m of revenue the
  // user never entered, plus a 65% occupancy and a 35% margin on the operating
  // strategies. Every one of those feeds the model directly, so all of them are
  // zero and only the STRUCTURE (category and metric, both derived from the
  // asset's strategy) is still chosen for the user. Unlike the capex catalog
  // these fields sit on the row the user is already filling in, so a zero here
  // is in front of them rather than buried on another tab.
  const handleAddSubUnit = (): void => {
    const category = asset.strategy === 'Lease' ? 'Leasable' : asset.strategy === 'Operate' ? 'Operable' : 'Sellable';
    addSubUnit({
      id: `subunit_${Date.now()}`,
      assetId: asset.id,
      name: 'Sub-unit',
      category,
      metric: asset.strategy === 'Lease' ? 'area' : 'units',
      metricValue: 0,
      unitArea: asset.strategy === 'Lease' ? undefined : 0,
      unitPrice: 0,
      occupancyPct: asset.strategy === 'Sell' ? undefined : 0,
      operatingMargin: asset.strategy === 'Sell' ? undefined : 0,
    });
  };

  // ── Strategy change: preview, confirm, then review ─────────────────────────
  //
  // The preview is a DRY RUN of the pure `applyStrategySwitch` against the LIVE
  // store slice, so what the dialog promises is literally what the store will
  // do. Nothing is written until the user confirms; the store then re-runs the
  // same function for real.
  const [pendingSwitch, setPendingSwitch] = useState<StrategySwitchReport | null>(null);
  const onStrategyPick = (to: AssetStrategy): void => {
    if (to === asset.strategy) return;
    const st = useModule1Store.getState();
    const slice = { assets: st.assets, subUnits: st.subUnits, costLines: st.costLines, costOverrides: st.costOverrides };
    // 2026-08-15: an asset is created as 'Sell', so the user's FIRST pick from
    // this dropdown is technically a change. There is nothing to preview and
    // nothing to review on an asset with no assumptions yet, so write it
    // straight through. Same predicate the store uses for the banner, so the
    // dialog and the banner cannot disagree.
    if (!assetHasStrategyAssumptions(slice, asset.id)) {
      onUpdate({ strategy: to });
      return;
    }
    const { report } = applyStrategySwitch(slice, asset.id, to);
    setPendingSwitch(report);
  };

  // Land planning (2026-09-07): the firm's vocabulary labels join the datalist
  // suggestions, and picking one records WHICH type this is. Nothing is copied
  // onto the asset: the type's values live on the project (mig 244), so the
  // caption below is a live read-out that follows the standards tab.
  const typeOptions = Array.from(new Set([
    ...assetTypeRegistry.entries.map((e) => e.label),
    ...resolveTypeCatalog(project),
  ]));
  const pickAssetType = (entryId: string): void => {
    if (!entryId) {
      // Clearing the selection drops the reference; the free-text type label
      // stays whatever the user has typed, and the project keeps its values.
      onUpdate({ assetTypeId: undefined });
      return;
    }
    const entry = assetTypeRegistry.entries.find((e) => e.id === entryId);
    if (!entry) return;
    onUpdate({ type: entry.label, assetTypeId: entry.id });
  };
  const status = asset.status ?? 'planned';

  // This asset's type values, straight from the project. Read live, never
  // copied, so editing a standard is an input change like any other.
  const typeValues: AssetTypeValues | undefined =
    resolveAssetTypeValues(asset, project.assetTypeValues);

  // THE UNIT SIZE RULE, as a read-out (nothing computes off it yet): the
  // sub-units' own areas when any state one, the asset type average as the
  // fallback. Resolved by the one pure function in assetTypeStandards.ts.
  const assetSubUnitAreas = subUnits
    .filter((u) => u.assetId === asset.id && typeof u.unitArea === 'number' && u.unitArea > 0)
    .map((u) => u.unitArea);
  const resolvedUnitSize = resolveAvgUnitSize(assetSubUnitAreas, typeValues);

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
      {pendingSwitch && (
        <StrategyChangeConfirm
          report={pendingSwitch}
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => { onUpdate({ strategy: pendingSwitch.to }); setPendingSwitch(null); }}
        />
      )}
      {/* Persists across navigation, because the assumptions it points at live
          on other tabs. Only Dismiss clears it. */}
      {asset.strategyReview && (
        <StrategyReviewBanner
          report={asset.strategyReview}
          onDismiss={() => dismissStrategyReview(asset.id)}
        />
      )}
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)', cursor: 'pointer' }} onClick={() => setCollapsed(!collapsed)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 14 }}>{assetDisplayName(asset)}</strong>
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
            {/* Asset name, phase, the free-text type and Delete are COLUMNS
                now, so they are not repeated here: one field, one home. What
                stays is what a row cannot hold. */}
            <div>
              <InputLabel label="Strategy" help="Sell / Operate / Lease / Sell + Manage. Drives Tab 3 cost classification + future revenue logic." inputId={`asset-${asset.id}-strategy`} />
              {/* A strategy change is a model operation, so it is previewed and
                  confirmed rather than written straight through. The preview is
                  a DRY RUN of the same pure applyStrategySwitch the store
                  commits, so it cannot describe something else. */}
              <select
                id={`asset-${asset.id}-strategy`}
                data-testid={`asset-${asset.id}-strategy`}
                value={asset.strategy}
                onChange={(e) => onStrategyPick(e.target.value as AssetStrategy)}
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
              <InputLabel label="Company standard" help="Which of your firm's asset types this asset is. The free-text name is a column in the table; this records the type whose PROJECT values (unit size, parking ratio, build cost, revenue rate) the asset reads." inputId={`asset-${asset.id}-assetTypeId`} />
              {assetTypeRegistry.entries.length > 0 && (
                <select
                  data-testid={`asset-${asset.id}-assetTypeId`}
                  value={asset.assetTypeId ?? ''}
                  onChange={(e) => pickAssetType(e.target.value)}
                  style={{ ...inputStyle, marginTop: 4, fontSize: 'var(--font-micro)' }}
                  title="Pick from your firm's list on the Asset Types and Standards tab. This records WHICH type the asset is; its values (unit size, parking ratio, area per slot, construction cost, revenue rate) live on that tab as project inputs and are read live, so editing one there updates this asset with no re-picking. Choose the blank row to clear."
                >
                  <option value="">Company standard...</option>
                  {assetTypeRegistry.entries.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              )}
              {asset.assetTypeId && (
                <div
                  data-testid={`asset-${asset.id}-standards-values`}
                  style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 2 }}
                  title="This project's values for this asset type, read live from the Asset Types and Standards tab. 'not set' means nobody has decided, which is different from 0. Editing them there updates this line; nothing is copied onto the asset."
                >
                  {describeValues(typeValues, project.parkingAreaPerSlotSqm)}
                </div>
              )}
              {/* WHERE THE UNIT SIZE ACTUALLY COMES FROM. Sub-unit areas are
                  more precise than one average per type, so they win; the
                  asset type average is the fallback for an asset with none.
                  A read-out only: nothing computes off it yet. */}
              {(typeValues || assetSubUnitAreas.length > 0) && (
                <div
                  data-testid={`asset-${asset.id}-unit-size-source`}
                  style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 2 }}
                  title="Sub-units carry their own unit areas and those are more precise, so they are used when present. The asset type average is the fallback for an asset with no sub-unit areas."
                >
                  Unit size {resolvedUnitSize.value !== undefined ? `${fmt(resolvedUnitSize.value)} sqm` : 'not set'}
                  {' '}({describeSource(resolvedUnitSize.source)})
                </div>
              )}
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
              {/* ONE ASSET, ONE PLOT (2026-09-08). The "+ Add Parcel
                  Allocation" button is gone: two plots for one building is
                  modelled by merging the plots or by splitting the asset. */}
            </div>

            {/* The multi-parcel split branch is GONE with the button that
                created it. The engine still reads a legacy split so a
                snapshot carrying one computes rather than losing its land;
                nothing stored ever had one (0 of 9399 asset rows across
                1406 versions, measured before removal). */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)' }}>
                {landAllocationMode === 'sqm' && (
                  <>
                    <div>
                      <InputLabel label="Parcel" help="Source parcel for this asset's land draw. Every parcel in the project can be picked, not just the ones bought in this phase: land is often acquired once and built on across several phases. The two weighted options blend the parcels in this phase, or every parcel in the project; each option shows the rate it resolves to." inputId={`asset-${asset.id}-parcelId`} />
                      <select
                        id={`asset-${asset.id}-parcelId`}
                        data-testid={`asset-${asset.id}-parcelId`}
                        value={allocation.parcelId ?? phaseParcels[0]?.id ?? ''}
                        onChange={(e) => setAllocation({ parcelId: e.target.value || undefined })}
                        style={inputStyle}
                      >
                        {/* EVERY parcel, not just this phase's (2026-08-17). The
                            phase filter made a parcel unpickable on any later
                            phase, and an asset seeded with one anyway resolved
                            to a rate of zero with nothing on screen saying so.
                            Parcels from another phase are labelled as such. */}
                        {parcels.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({fmt(p.rate)} {project.currency}/sqm)
                            {p.phaseId !== asset.phaseId ? ` · ${phaseNameById.get(p.phaseId) ?? 'other phase'}` : ''}
                          </option>
                        ))}
                        <option value={PARCEL_WEIGHTED_AVG}>
                          (Weighted Average, this phase{phaseWeightedRate > 0 ? `: ${fmt(phaseWeightedRate)} ${project.currency}/sqm` : ': no parcels in this phase'})
                        </option>
                        <option value={PARCEL_WEIGHTED_AVG_ALL}>
                          (Weighted Average, all parcels{allWeightedRate > 0 ? `: ${fmt(allWeightedRate)} ${project.currency}/sqm` : ': no parcels yet'})
                        </option>
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
                        <div
                          style={{
                            ...calcOutputStyle,
                            ...(landBreakdown.rateIssue ? { borderColor: 'var(--color-accent-warm)', color: 'var(--color-accent-warm)' } : {}),
                          }}
                          data-testid={`asset-${asset.id}-resolved-rate`}
                          data-rate-issue={landBreakdown.rateIssue ?? ''}
                        >
                          {fmt(landBreakdown.rate)} {project.currency}/sqm
                        </div>
                      </div>
                    )}
                  </>
                )}
                {landAllocationMode === 'percent' && (
                  <div>
                    <InputLabel label="Land Allocation (%)" help="Share of total land value attributed to this asset." inputId={`asset-${asset.id}-landAreaPct`} />
                    <PercentageInput id={`asset-${asset.id}-landAreaPct`} data-testid={`asset-${asset.id}-landAreaPct`} min={0} max={100} value={allocation.pct ?? asset.landAreaPct ?? 0} onChange={(n) => setAllocation({ pct: Math.max(0, Math.min(100, n)) })} style={inputStyle} />
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
                {/* A LAND RATE OF ZERO NOW SAYS WHY (2026-08-17).
                    A zero rate is indistinguishable from a rate not yet typed,
                    and a reference that matched no parcel produced exactly that
                    with nothing on screen. This is the third silent zero of the
                    family, so the engine returns the reason and the card prints
                    it beside the number it explains. */}
                {landBreakdown.rateIssue && (
                  <div
                    data-testid={`asset-${asset.id}-land-rate-issue`}
                    data-rate-issue={landBreakdown.rateIssue}
                    style={{
                      gridColumn: '1 / -1',
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: 'var(--color-on-accent-warm, white)',
                      background: 'var(--color-accent-warm)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                    }}
                  >
                    {landRateIssueText(landBreakdown.rateIssue)}
                  </div>
                )}
              </div>
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

          {/* Land planning step 2 (2026-09-07): the TOP-DOWN derivation,
              beside the bottom-up figures above. Read only, inert, and
              hidden entirely on a companion (which has no land of its own).
              Nothing it computes is written or read by any calculation. */}
          {!asset.isCompanion && (() => {
            const hier = computeAssetAreaHierarchy(asset, subUnits);
            const gfaDisplay = asset.gfaSqm > 0 ? asset.gfaSqm : hier.gfa;
            return (
              <LandChainSection
                assetId={asset.id}
                inputs={asset.landChain}
                onChange={(patch) => onUpdate({ landChain: mergeLandChain(asset.landChain, patch) })}
                landAreaSqm={landBreakdown.landSqm}
                standards={{
                  avgUnitSizeSqm: resolvedUnitSize.value,
                  parkingRatio: typeValues?.parkingRatio,
                  parkingRatioBasis: typeValues?.parkingRatioBasis,
                  parkingAreaPerSlotSqm: project.parkingAreaPerSlotSqm,
                }}
                subUnitUnits={computeAssetUnitCount(asset, subUnits)}
                entered={{
                  nsa: hier.nsa,
                  bua: hier.bua,
                  gfa: gfaDisplay,
                  unitCount: computeAssetUnitCount(asset, subUnits),
                  parkingArea: hier.breakdown.parkingArea,
                }}
                typeName={asset.type || undefined}
              />
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
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '16%' }} />
                        <col style={{ width: '9%' }} />
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
                          <th
                            style={{ padding: '4px 6px', textAlign: 'right' }}
                            data-testid={`asset-${asset.id}-subunit-parking-header`}
                            title="Parking ratio. Inherited from the asset type by default; override it here when this unit type differs."
                          >
                            Parking
                          </th>
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
                            assetTypeValues={resolveAssetTypeValues(asset, project.assetTypeValues)}
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

function SubUnitRow({ subUnit, assetMetric, currency, onUpdate, onRemove, decimals, scale, assetStrategy, assetType, isCompanionSub, assetTypeValues }: SubUnitRowProps & { assetMetric: SubUnitMetric; decimals: import('../../lib/state/module1-types').DisplayDecimals; scale: import('../../lib/state/module1-types').DisplayScale; assetStrategy: AssetStrategy; assetType?: string; isCompanionSub?: boolean; assetTypeValues?: import('../../lib/state/assetTypeStandards').AssetTypeValues }): React.JSX.Element {
  // The parking rule, resolved ONCE for this row: the sub-unit's own override
  // when it has one (including a typed 0), else the asset type's default.
  const parking = resolveParkingRatio(subUnit.parkingRatio, assetTypeValues);
  const inherited = resolveParkingRatio(undefined, assetTypeValues);
  // An area typed while Unit Size is still zero. In Units mode the row stores a
  // COUNT, so an area with no unit size cannot be represented yet; holding it
  // is the difference between "not converted yet" and "thrown away".
  // Declared before the companion early-return so the hook order is fixed.
  const [pendingArea, setPendingArea] = useState<number | null>(null);
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
        {/* Parking: a mirrored companion row carries no override of its own,
            it follows the parent it mirrors. */}
        <td style={{ padding: '4px 6px' }} />
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
  const storedArea = storedIsUnits ? subUnit.metricValue * unitArea : subUnit.metricValue;
  const totalArea = pendingArea !== null && storedArea === 0 ? pendingArea : storedArea;
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
  // ── ONLY TWO OF THE THREE CAN BE INPUTS (2026-08-17) ───────────────────
  //
  // Area, Unit Size and Count are one identity: area = count x unit size. All
  // three were editable and each edit rewrote one of the others, so they read
  // as three independent inputs that fight: typing a Count silently rewrote the
  // Area the user had entered, and typing an Area silently rewrote the Count.
  //
  // AREA AND UNIT SIZE ARE THE INPUTS. Count is derived and read-only, because
  // that is how a scheme is actually specified (a floor plate and a unit type
  // give you the number of units, not the other way round).
  //
  // THE ONE EXCEPTION IS NOT A SECOND MODE, IT IS THE SAME RULE. With no unit
  // size there is nothing to divide by, so nothing can be derived and the count
  // becomes the input: that is the existing-operations case Pass 57 added
  // (a hotel that knows it has 200 keys and does not track BUA). Set a unit
  // size and the count goes back to being derived.
  const countIsDerived = isUnits && unitArea > 0;
  // P8-Fix 2a: in Units mode, the user edits AREA (sqm). We back-calc
  // count = area / unitArea and store that as metricValue when stored
  // shape is 'units'. When stored shape lags (legacy 'area' subunit
  // inside a Units-mode asset), we flip the row to 'units' shape on
  // first edit so back-calc holds.
  const onEditAreaUnits = (nextArea: number): void => {
    const a = Math.max(0, nextArea);
    if (unitArea <= 0) {
      // Pass 57 (2026-05-16): no-op when Unit Size is missing. Previously
      // this zeroed out metricValue (the count), which destroyed user-
      // entered Units / Keys whenever they typed into Area on an
      // existing-operation row without BUA. The user should set Unit
      // Size first OR edit Count directly via the new Count input.
      //
      // 2026-08-17: THE TYPED AREA IS NO LONGER DISCARDED. The no-op above
      // protects a hand-entered count, and it is right to keep it, but it also
      // silently threw away an area the user had just typed: enter BUA first
      // and then unit size, which is the natural order for a hotel, and both
      // the area and the keys ended up at zero with nothing said. The area is
      // held here and converted the moment a unit size arrives.
      setPendingArea(a > 0 ? a : null);
      return;
    }
    // Remembered even when it converts cleanly, so the row can say when the
    // area SNAPPED. A count is a whole number, so an area that does not divide
    // by the unit size cannot be honoured exactly: 13,300 sqm at 83 sqm is
    // 160.2 units, which becomes 160 units and 13,280 sqm. That is the model
    // being consistent, and it used to happen silently, so the user watched a
    // number they had typed change by itself.
    setPendingArea(a > 0 ? a : null);
    // Pass 9e-4 (2026-05-18): keys / unit counts must be integers
    // (a hotel can't have 159.989 keys). Round at every site that
    // derives metricValue from area / unitArea.
    onUpdate({ metric: 'units', metricValue: Math.round(a / unitArea) });
  };
  const onEditUnitSize = (nextUnitArea: number): void => {
    const ua = Math.max(0, nextUnitArea);
    // 2026-08-17: an area typed BEFORE a unit size existed is converted now.
    // This is the other half of the hold in onEditAreaUnits, and it is what
    // makes "enter the BUA, then the unit size" produce the keys.
    if (pendingArea !== null && ua > 0) {
      // The typed area is KEPT, not cleared: this is the moment it converts,
      // and a conversion that does not divide evenly is exactly when the row
      // has to say so. The snap note compares it to the resolved area and
      // stays quiet when they agree.
      onUpdate({ unitArea: ua, metricValue: Math.round(pendingArea / ua), metric: 'units' });
      return;
    }
    // Preserve currently displayed Area: when stored is 'units',
    // newCount = area / new ua = (oldCount * oldUnitArea) / ua.
    if (storedIsUnits && ua > 0 && unitArea > 0) {
      const area = subUnit.metricValue * unitArea;
      onUpdate({ unitArea: ua, metricValue: Math.round(area / ua), metric: 'units' });
    } else if (!storedIsUnits && ua > 0) {
      // Stored is 'area'; convert to 'units' with derived count.
      onUpdate({ unitArea: ua, metricValue: Math.round(subUnit.metricValue / ua), metric: 'units' });
    } else {
      onUpdate({ unitArea: ua, metric: 'units' });
    }
  };
  const onEditAreaWhenArea = (next: number): void => {
    onUpdate({ metric: 'area', metricValue: Math.max(0, next) });
  };
  // Pass 57 (2026-05-16): direct Count editing for Units mode. Existing
  // operations often know the count (e.g. 200 keys) but do not track
  // BUA / Unit Size, so the prior "edit Area, derive Count" path forced
  // a BUA entry that does not exist. metricValue IS the count in Units
  // mode, so writing it directly preserves the storage contract. Area
  // auto-derives when Unit Size is set (count x unitArea); when Unit
  // Size is 0, Area stays 0 and Count still flows to downstream
  // revenue / cost math.
  const onEditCount = (n: number): void => {
    onUpdate({ metric: 'units', metricValue: Math.max(0, Math.round(n)) });
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
        {/* The area SNAPPED to a whole number of units. Said out loud, because
            watching a number you typed change by itself is worse than being
            told why it did. */}
        {countIsDerived && pendingArea !== null && Math.abs(pendingArea - storedArea) > 0.5 && (
          <div
            style={{ fontSize: 9, color: 'var(--color-accent-warm)', fontStyle: 'italic', lineHeight: 1.3 }}
            data-testid={`subunit-${subUnit.id}-area-snapped`}
            title={`A ${countUnit.toLowerCase().replace(/s$/, '')} count is a whole number, so the area resolves to ${fmt(count)} x ${fmt(unitArea)}.`}
          >
            you entered {fmt(pendingArea)}; {fmt(count)} x {fmt(unitArea)} = {fmt(storedArea)}
          </div>
        )}
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
              <div
                style={{
                  fontSize: 9, fontStyle: 'italic',
                  color: pendingArea !== null ? 'var(--color-accent-warm)' : 'var(--color-meta)',
                }}
                data-testid={`subunit-${subUnit.id}-units-no-size-error`}
                title={pendingArea !== null
                  ? `The ${fmt(pendingArea)} sqm you entered is held. Enter the size of one ${countUnit.toLowerCase()} and it converts.`
                  : undefined}
              >
                {pendingArea !== null
                  ? `Enter unit size to get ${countUnit.toLowerCase()}`
                  : 'Optional, Area derives when set'}
              </div>
            )}
          </>
        ) : (
          // ── AREA MODE ALSO GETS A UNIT SIZE (2026-08-17b) ───────────────
          // This cell was a dash, so on an Area-metric asset there was no way
          // to enter a unit size and therefore no way to derive a count at
          // all: the identity area = count x unit size was only enforceable in
          // Units mode. The stored quantity does NOT change (metric stays
          // 'area', metricValue stays the total sqm), so nothing the engine
          // computes moves: `computeSubUnitArea` and `makeSubUnitMaterial`
          // both branch on `metric` and never read `unitArea` in this mode.
          // It is an input that yields a derived count and nothing else.
          <AccountingNumberInput
            value={Number((subUnit.unitArea ?? 0).toFixed(2))}
            onChange={(n) => onUpdate({ unitArea: Math.max(0, n) })}
            scale="full"
            decimals={0}
            min={0}
            style={{ ...inputStyle, fontSize: 11 }}
            data-testid={`subunit-${subUnit.id}-unitArea`}
            title={`Size of one ${countUnit.toLowerCase().replace(/s$/, '')}. The count below derives from it. The rate stays per sqm in Area mode, so this changes no number in the model.`}
          />
        )}
      </td>
      {/* Count: Pass 57 (2026-05-16) directly editable in Units mode so
          existing-operation assets (where BUA / Unit Size is unknown)
          can record their unit count without a forced Area entry. Stays
          a muted dash in Area mode (count is meaningless when storage
          is total sqm). */}
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {isUnits ? (
          <>
            {countIsDerived ? (
              // DERIVED AND READ-ONLY: area / unit size. Rendered as an output
              // cell, not a disabled input, so it reads as a result rather than
              // a field someone forgot to enable.
              <div
                style={{
                  ...calcOutputStyle,
                  fontSize: 11,
                  padding: '4px 6px',
                  textAlign: 'right',
                }}
                data-testid={`subunit-${subUnit.id}-count`}
                data-derived="true"
                title={`${fmt(totalArea)} sqm / ${fmt(unitArea)} sqm per ${countUnit.toLowerCase().replace(/s$/, '')} = ${fmt(count)}. Change the Area or the Unit Size to change it.`}
              >
                {fmt(count)}
              </div>
            ) : (
              <AccountingNumberInput
                value={count}
                onChange={(n) => onEditCount(n)}
                scale="full"
                decimals={0}
                min={0}
                style={{ ...inputStyle, fontSize: 11 }}
                data-testid={`subunit-${subUnit.id}-count`}
                title={`No unit size, so there is nothing to divide the area by. Enter the ${countUnit.toLowerCase()} directly, or set a Unit Size and this becomes derived.`}
              />
            )}
            <div style={{ fontSize: 9, color: 'var(--color-meta)', textAlign: 'right', marginTop: 2, fontStyle: 'italic' }} data-testid={`subunit-${subUnit.id}-count-unit`}>
              {countUnit}{countIsDerived ? ' (derived)' : ''}
            </div>
          </>
        ) : (
          // Area mode: the count is DERIVED from the two inputs beside it and
          // is never editable, because metricValue is the area here. With no
          // unit size there is nothing to divide by, which the cell says.
          <>
            {unitArea > 0 ? (
              <div
                style={{ ...calcOutputStyle, fontSize: 11, padding: '4px 6px', textAlign: 'right' }}
                data-testid={`subunit-${subUnit.id}-count`}
                data-derived="true"
                title={`${fmt(totalArea)} sqm / ${fmt(unitArea)} sqm per ${countUnit.toLowerCase().replace(/s$/, '')} = ${fmt(Math.round(rawCount))}. Derived: change the Area or the Unit Size.`}
              >
                {fmt(Math.round(rawCount))}
              </div>
            ) : (
              <span
                style={{ fontSize: 11, color: 'var(--color-meta)' }}
                data-testid={`subunit-${subUnit.id}-count-hidden`}
                title={`Enter a unit size to derive the ${countUnit.toLowerCase()}.`}
              >
                -
              </span>
            )}
            <div style={{ fontSize: 9, color: 'var(--color-meta)', textAlign: 'right', marginTop: 2, fontStyle: 'italic' }} data-testid={`subunit-${subUnit.id}-count-unit`}>
              {unitArea > 0 ? `${countUnit} (derived)` : countUnit}
            </div>
          </>
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
      {/* PARKING: inherit from the asset type, or override here. Absent means
          inherit; a typed 0 is a real override, the cost-line rule. Both the
          shown value and its source come from the ONE resolver. */}
      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
        {parking.source !== 'sub_unit' ? (
          <button
            type="button"
            onClick={() => onUpdate({ parkingRatio: inherited.value ?? 0 })}
            data-testid={`subunit-${subUnit.id}-parking-override`}
            style={{
              background: 'transparent', border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-sm)', padding: '2px 6px', cursor: 'pointer',
              fontSize: 9, color: 'var(--color-meta)', width: '100%',
            }}
            title={inherited.value !== undefined
              ? `Inheriting ${inherited.value} ${inherited.basis === 'sqm_per_slot' ? 'sqm per slot' : 'slots per unit'} from the asset type. Click to set a different ratio for this row.`
              : 'The asset type sets no parking ratio. Click to set one for this row.'}
          >
            {inherited.value !== undefined ? `Inherit ${inherited.value}` : 'Inherit (not set)'}
          </button>
        ) : (
          <>
            <AccountingNumberInput
              value={parking.value ?? 0}
              onChange={(n) => onUpdate({ parkingRatio: Math.max(0, n) })}
              scale="full"
              decimals={2}
              min={0}
              style={{ ...inputStyle, fontSize: 11 }}
              data-testid={`subunit-${subUnit.id}-parking-ratio`}
            />
            <button
              type="button"
              onClick={() => onUpdate({ parkingRatio: undefined })}
              data-testid={`subunit-${subUnit.id}-parking-inherit`}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 9, color: 'var(--color-meta)', textDecoration: 'underline', padding: '2px 0 0',
              }}
              title="Drop this override and go back to the asset type's ratio."
            >
              use default
            </button>
          </>
        )}
      </td>
      <td style={{ padding: '4px 6px' }}>
        <button type="button" onClick={onRemove} data-testid={`subunit-${subUnit.id}-remove`} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', cursor: 'pointer', fontSize: 'var(--font-micro)' }}>x</button>
      </td>
    </tr>
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
  assets, assetLandSqmByAssetId, assetLandValueByAssetId,
  assetCashValueByAssetId, assetInKindValueByAssetId,
  totalCashValue, totalInKindValue, phases,
}: LandReconciliationBlockProps): React.JSX.Element {
  // WITH THE DEDUCTION RETIRED, developable land IS parcel land. The walk
  // that used to subtract roads and parks now has nothing to subtract, so the
  // rows are gone rather than rendering as a permanent "less 0.0%".
  const totalParcelsNda = landReconciliation.parcelsTotalSqm;

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
        // Developable land IS parcel land now: nothing is deducted from it.
        const nda = totalLand;
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
                    <div>{assetDisplayName(a)} ({phaseName})</div>
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
                Sqm: {fmtSqm(allocatedSqm)} / {fmtSqm(nda)} Total Parcel <span style={{ marginLeft: 6 }}>{chipFor(sqmStatus)}</span>
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
