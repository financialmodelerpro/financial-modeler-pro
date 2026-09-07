'use client';

/**
 * Module1AssetStandards.tsx (REFM Module 1, tab 4, migs 242 + 243)
 *
 * LAND AND ASSET DATA MANAGEMENT: the firm's asset type list and the company
 * standards each type carries. Moved out of a dialog on 2026-09-07 because a
 * reference table people maintain is not a dialog's job, and it follows the
 * OpEx table pattern (navy header row, one editable row per record, an add
 * row at the foot, a remove control at the end of each row).
 *
 * ACCOUNT SCOPED, so this is the same list on every project the firm opens,
 * and ANY member may edit it (vocabulary, not entitlement, the cost catalog
 * rule). The ten reference types are a STARTING SET offered by a button, not
 * a fixed list: every row can be renamed, re-categorised, reordered, removed
 * and added to.
 *
 * NOTHING HERE IS READ BY THE CALCULATION ENGINE. Selecting a type on an
 * asset STAMPS the resolved values onto that asset, and the engine reads the
 * asset, so a firm editing this table can never change a saved model. Capex
 * and revenue keep taking their rates exactly where they do today.
 *
 * A BLANK AND A TYPED ZERO ARE DIFFERENT ANSWERS: every numeric cell is a
 * text field whose empty state means "not decided" (stored NULL) and whose
 * "0" is a real zero. Blanks render as a placeholder, never as 0.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  PARKING_RATIO_BASES,
  PARKING_RATIO_BASIS_LABELS,
  REVENUE_RATE_UNITS,
  REVENUE_RATE_UNIT_LABELS,
  normaliseAssetTypeId,
  sortAssetTypes,
  typesWithoutStandard,
  type AssetTypeStandard,
  type ParkingRatioBasis,
  type RevenueRateUnit,
} from '../../lib/state/assetTypeStandards';
import {
  ASSET_TYPES_BY_CATEGORY,
  ASSET_TYPE_CATEGORIES,
  ASSET_TYPE_CATALOG,
  assetTypeCatalogForProjectType,
  assetTypeCategory,
} from '../../lib/state/module1-types';

// ─── styling primitives (mirror Module 3 OpEx) ────────────────────────────
const FAST_INPUT: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px 6px',
  fontSize: 11,
  textAlign: 'right',
  fontFamily: 'inherit',
  width: '100%',
};
const TEXT_INPUT: React.CSSProperties = { ...FAST_INPUT, textAlign: 'left' };
const TH: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600 };
const TD: React.CSSProperties = { padding: '4px 6px' };
const SMALL_BTN: React.CSSProperties = {
  fontSize: 10,
  padding: '3px 8px',
  background: 'var(--color-surface)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-navy)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontWeight: 600,
};

interface Draft {
  entryId?: string;
  label: string;
  category: string;
  avgUnitSize: string;
  parkingRatio: string;
  parkingRatioBasis: ParkingRatioBasis;
  constructionCost: string;
  revenueRate: string;
  revenueRateUnit: RevenueRateUnit;
}

const EMPTY_DRAFT: Draft = {
  label: '', category: '', avgUnitSize: '', parkingRatio: '',
  parkingRatioBasis: 'slots_per_unit', constructionCost: '', revenueRate: '',
  revenueRateUnit: 'per_sqm',
};

const toDraft = (e: AssetTypeStandard): Draft => ({
  entryId: e.id,
  label: e.label,
  category: e.category ?? '',
  avgUnitSize: e.avgUnitSizeSqm !== undefined ? String(e.avgUnitSizeSqm) : '',
  parkingRatio: e.parkingRatio !== undefined ? String(e.parkingRatio) : '',
  parkingRatioBasis: e.parkingRatioBasis,
  constructionCost: e.constructionCostPerSqm !== undefined ? String(e.constructionCostPerSqm) : '',
  revenueRate: e.revenueRate !== undefined ? String(e.revenueRate) : '',
  revenueRateUnit: e.revenueRateUnit ?? 'per_sqm',
});

/** '' -> null (blank, not decided); otherwise a finite non-negative number. */
function parseStandard(s: string): { ok: true; value: number | null } | { ok: false } {
  const t = s.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

const bodyFor = (d: Draft, unit: number | null, ratio: number | null, cost: number | null, rate: number | null): Record<string, unknown> => ({
  ...(d.entryId ? { entryId: d.entryId } : {}),
  label: d.label.trim(),
  category: d.category.trim(),
  avgUnitSize: unit,
  parkingRatio: ratio,
  parkingRatioBasis: d.parkingRatioBasis,
  constructionCostPerSqm: cost,
  revenueRate: rate,
  ...(rate !== null ? { revenueRateUnit: d.revenueRateUnit } : {}),
});

export default function Module1AssetStandards(): React.JSX.Element {
  const { project, assets } = useModule1Store(
    useShallow((s) => ({ project: s.project, assets: s.assets })),
  );

  const [entries, setEntries] = useState<AssetTypeStandard[]>([]);
  const [parkingAreaPerSlot, setParkingAreaPerSlot] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [slotDraft, setSlotDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/refm/asset-types');
      if (!res.ok) { setAvailable(false); return; }
      const body = await res.json() as {
        entries?: AssetTypeStandard[]; parkingAreaPerSlot?: number | null; available?: boolean;
      };
      const list = Array.isArray(body.entries) ? sortAssetTypes(body.entries) : [];
      setEntries(list);
      setDrafts(list.map(toDraft));
      const slot = typeof body.parkingAreaPerSlot === 'number' ? body.parkingAreaPerSlot : null;
      setParkingAreaPerSlot(slot);
      setSlotDraft(slot !== null ? String(slot) : '');
      setAvailable(body.available !== false);
    } catch {
      setAvailable(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // The two quick-add sources, both through the ONE covered-already rule.
  const platformCatalog = assetTypeCatalogForProjectType(project.projectType);
  const projectTypesInUse = useMemo(
    () => Array.from(new Set(assets.map((a) => (a.type ?? '').trim()).filter((t) => t !== ''))),
    [assets],
  );
  const catalogToAdd = typesWithoutStandard(platformCatalog, entries);
  const projectToAdd = typesWithoutStandard(projectTypesInUse, entries);
  const wholeCatalogToAdd = typesWithoutStandard(ASSET_TYPE_CATALOG, entries);

  const flash = (msg: string): void => { setNotice(msg); setTimeout(() => setNotice(null), 3000); };

  const saveEntry = async (d: Draft): Promise<void> => {
    setError(null);
    const label = d.label.trim();
    if (!label) { setError('Every asset type needs a name.'); return; }
    const unit = parseStandard(d.avgUnitSize);
    const ratio = parseStandard(d.parkingRatio);
    const cost = parseStandard(d.constructionCost);
    const rate = parseStandard(d.revenueRate);
    if (!unit.ok) { setError(`"${label}": average unit size must be blank, zero or a positive number.`); return; }
    if (!ratio.ok) { setError(`"${label}": parking ratio must be blank, zero or a positive number.`); return; }
    if (!cost.ok) { setError(`"${label}": construction cost must be blank, zero or a positive number.`); return; }
    if (!rate.ok) { setError(`"${label}": revenue rate must be blank, zero or a positive number.`); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/refm/asset-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyFor(d, unit.value, ratio.value, cost.value, rate.value)),
      });
      const body = await res.json() as { entry?: AssetTypeStandard; error?: string };
      if (!res.ok || !body.entry) throw new Error(body.error ?? 'Could not save the entry.');
      if (!d.entryId) setAddDraft(EMPTY_DRAFT);
      flash(d.entryId ? `Saved ${label}.` : `Added ${label}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entryId: string, label: string): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/refm/asset-types?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Could not delete the entry.');
      flash(`Removed ${label}. Assets already stamped from it keep their values.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSlotArea = async (): Promise<void> => {
    setError(null);
    const parsed = parseStandard(slotDraft);
    if (!parsed.ok) { setError('Parking area per slot must be blank, zero or a positive number.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/refm/asset-types', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parkingAreaPerSlot: parsed.value }),
      });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Could not save.');
      flash('Saved the parking area per slot.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Move one row up or down and write the WHOLE list's order densely. */
  const move = async (index: number, delta: number): Promise<void> => {
    const next = entries.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    setEntries(next);
    setDrafts(next.map(toDraft));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/refm/asset-types', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((e) => e.id) }),
      });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Could not save the new order.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setBusy(false);
    }
  };

  /** Seed every reference type not already covered, each with its category. */
  const seedStandardList = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/refm/asset-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: wholeCatalogToAdd.map((label, i) => ({
            label,
            category: assetTypeCategory(label) ?? '',
            sortOrder: entries.length + i,
          })),
        }),
      });
      const body = await res.json() as { entries?: AssetTypeStandard[]; error?: string };
      if (!res.ok || !body.entries) throw new Error(body.error ?? 'Could not add the standard list.');
      flash(`Added ${body.entries.length} asset types. Fill in your firm's standards on each row.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const prefillLabel = (label: string): void => {
    const cat = assetTypeCategory(label);
    setAddDraft((prev) => ({ ...prev, label, ...(cat ? { category: cat } : {}) }));
    setError(null);
  };

  const patchDraft = (i: number, patch: Partial<Draft>): void =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const rowCells = (d: Draft, set: (patch: Partial<Draft>) => void, idPrefix: string): React.JSX.Element => (
    <>
      <td style={TD}>
        <input style={TEXT_INPUT} value={d.label} data-testid={`${idPrefix}-label`}
          placeholder="e.g. High End Apartments" onChange={(e) => set({ label: e.target.value })} />
      </td>
      <td style={TD}>
        <input style={TEXT_INPUT} value={d.category} list="asset-standard-categories" data-testid={`${idPrefix}-category`}
          placeholder="e.g. Residential" onChange={(e) => set({ category: e.target.value })} />
      </td>
      <td style={TD}>
        <input style={FAST_INPUT} value={d.avgUnitSize} inputMode="decimal" data-testid={`${idPrefix}-unit-size`}
          placeholder="not set" onChange={(e) => set({ avgUnitSize: e.target.value })} />
      </td>
      <td style={TD}>
        <input style={FAST_INPUT} value={d.parkingRatio} inputMode="decimal" data-testid={`${idPrefix}-parking-ratio`}
          placeholder="not set" onChange={(e) => set({ parkingRatio: e.target.value })} />
      </td>
      <td style={TD}>
        <select style={TEXT_INPUT} value={d.parkingRatioBasis} data-testid={`${idPrefix}-basis`}
          onChange={(e) => set({ parkingRatioBasis: e.target.value as ParkingRatioBasis })}>
          {PARKING_RATIO_BASES.map((b) => (<option key={b} value={b}>{PARKING_RATIO_BASIS_LABELS[b]}</option>))}
        </select>
      </td>
      <td style={TD}>
        <input style={FAST_INPUT} value={d.constructionCost} inputMode="decimal" data-testid={`${idPrefix}-build-cost`}
          placeholder="not set" onChange={(e) => set({ constructionCost: e.target.value })} />
      </td>
      <td style={TD}>
        <input style={FAST_INPUT} value={d.revenueRate} inputMode="decimal" data-testid={`${idPrefix}-revenue-rate`}
          placeholder="not set" onChange={(e) => set({ revenueRate: e.target.value })} />
      </td>
      <td style={TD}>
        <select style={TEXT_INPUT} value={d.revenueRateUnit} data-testid={`${idPrefix}-revenue-unit`}
          onChange={(e) => set({ revenueRateUnit: e.target.value as RevenueRateUnit })}>
          {REVENUE_RATE_UNITS.map((u) => (<option key={u} value={u}>{REVENUE_RATE_UNIT_LABELS[u]}</option>))}
        </select>
      </td>
    </>
  );

  return (
    <div data-testid="tab-asset-standards">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-3)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <h2 style={{ fontSize: 'var(--font-h2)', margin: 0 }}>4. Asset Types &amp; Standards</h2>
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic' }}>
          Shared across your firm&apos;s projects. Rates in {project.currency}.
        </div>
      </div>

      <div
        style={{
          background: 'var(--color-primary-pale)', border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius)', padding: 'var(--sp-2)', marginBottom: 'var(--sp-3)',
          fontSize: 'var(--font-small)',
        }}
        data-testid="asset-standards-callout"
      >
        <strong>What goes here:</strong> your firm&apos;s asset types and the standards each one
        carries. Picking a type on an asset in the next tab <strong>copies these values onto that
        asset</strong> at that moment, so editing this table changes what future picks copy and
        never changes a saved model. A <strong>blank</strong> means the standard is not set; a
        <strong> 0</strong> is a real zero. Unit size here is the <strong>fallback</strong>: an
        asset whose sub-units carry their own unit areas uses those instead. The parking ratio is
        the <strong>default</strong>, and a sub-unit can override it.
      </div>

      {!available && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-negative)', marginBottom: 'var(--sp-2)' }} data-testid="asset-standards-unavailable">
          The registry could not be reached, so the list below may be incomplete and saving may fail.
        </div>
      )}

      {/* Account-wide scalar. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <label htmlFor="std-parking-area-per-slot" style={{ fontSize: 'var(--font-small)', fontWeight: 600 }}>
          Parking area per slot (sqm), one figure for the whole firm:
        </label>
        <input
          id="std-parking-area-per-slot"
          data-testid="std-parking-area-per-slot"
          style={{ ...FAST_INPUT, width: 120 }}
          inputMode="decimal"
          value={slotDraft}
          placeholder="not set"
          onChange={(e) => setSlotDraft(e.target.value)}
        />
        <button type="button" className="btn-primary" data-view-mutates="true" disabled={busy}
          style={{ padding: '4px 12px', fontSize: 'var(--font-small)' }}
          onClick={() => { void saveSlotArea(); }} data-testid="std-parking-area-per-slot-save">
          Save
        </button>
      </div>

      {/* Quick-add sources. */}
      {(wholeCatalogToAdd.length > 0 || catalogToAdd.length > 0 || projectToAdd.length > 0) && (
        <div
          style={{
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
            padding: 'var(--sp-1) var(--sp-2)', marginBottom: 'var(--sp-2)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
          data-testid="asset-type-quick-add"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-small)', fontWeight: 600 }}>Add a type without retyping it:</span>
            {wholeCatalogToAdd.length > 0 && (
              <button type="button" style={{ ...SMALL_BTN, background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}
                data-view-mutates="true" disabled={busy}
                onClick={() => { void seedStandardList(); }} data-testid="asset-type-seed-standard-list"
                title="Adds the standard reference types you do not already have, each with its category. They are a starting set: rename, edit, reorder or remove any of them afterwards.">
                Add the standard list ({wholeCatalogToAdd.length})
              </button>
            )}
            {catalogToAdd.length > 0 && (
              <select
                value=""
                data-testid="asset-type-catalog-picker"
                style={{ ...TEXT_INPUT, width: 260 }}
                onChange={(e) => { if (e.target.value) prefillLabel(e.target.value); }}
                title="The standard catalog for this project's type. Picking one fills the name into the add row below; enter your standards, then Add."
              >
                <option value="">One at a time ({catalogToAdd.length})...</option>
                {catalogToAdd.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
            )}
            <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
              or free-text any other name in the add row below.
            </span>
          </div>
          {projectToAdd.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} data-testid="asset-type-project-missing">
              <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
                Used in this project, no standard yet:
              </span>
              {projectToAdd.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => prefillLabel(t)}
                  data-testid={`asset-type-missing-${normaliseAssetTypeId(t)}`}
                  style={{ ...SMALL_BTN, borderColor: 'var(--color-primary)', color: 'var(--color-primary)', fontSize: 'var(--font-micro)' }}
                  title={`"${t}" is on an asset in this project but has no company standard. Click to fill it into the add row, then enter its standards.`}
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <datalist id="asset-standard-categories">
        {ASSET_TYPE_CATEGORIES.map((c) => (<option key={c} value={c} />))}
      </datalist>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }} data-testid="asset-standards-table">
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ ...TH, minWidth: 170 }}>Asset type</th>
              <th style={{ ...TH, minWidth: 120 }}>Category</th>
              <th style={{ ...TH, minWidth: 90, textAlign: 'right' }} title="Fallback only: an asset whose sub-units carry their own unit areas uses those instead.">Avg unit size (sqm)</th>
              <th style={{ ...TH, minWidth: 80, textAlign: 'right' }} title="The default. A sub-unit can override it.">Parking ratio</th>
              <th style={{ ...TH, minWidth: 140 }}>Ratio basis</th>
              <th style={{ ...TH, minWidth: 100, textAlign: 'right' }} title="Build rate per sqm. Carried onto the asset; capex still takes its rates on the Capex tab.">Construction cost / sqm</th>
              <th style={{ ...TH, minWidth: 90, textAlign: 'right' }} title="Carried onto the asset; revenue still takes its rates in Module 2.">Revenue rate</th>
              <th style={{ ...TH, minWidth: 150 }}>Rate unit</th>
              <th style={{ ...TH, minWidth: 90, textAlign: 'center' }}>Order</th>
              <th style={{ ...TH, minWidth: 90, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => (
              <tr key={d.entryId ?? i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                {rowCells(d, (patch) => patchDraft(i, patch), `std-row-${d.entryId}`)}
                <td style={{ ...TD, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ ...SMALL_BTN, padding: '2px 6px' }} data-view-mutates="true"
                    disabled={busy || i === 0} onClick={() => { void move(i, -1); }}
                    data-testid={`std-row-${d.entryId}-up`} title="Move up">
                    ^
                  </button>{' '}
                  <button type="button" style={{ ...SMALL_BTN, padding: '2px 6px' }} data-view-mutates="true"
                    disabled={busy || i === drafts.length - 1} onClick={() => { void move(i, 1); }}
                    data-testid={`std-row-${d.entryId}-down`} title="Move down">
                    v
                  </button>
                </td>
                <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" style={SMALL_BTN} data-view-mutates="true" disabled={busy}
                    onClick={() => { void saveEntry(d); }} data-testid={`std-row-${d.entryId}-save`}>
                    Save
                  </button>{' '}
                  <button type="button"
                    style={{ ...SMALL_BTN, color: 'var(--color-negative)', borderColor: 'var(--color-negative)' }}
                    data-view-mutates="true" disabled={busy}
                    onClick={() => { void deleteEntry(d.entryId!, d.label); }}
                    data-testid={`std-row-${d.entryId}-delete`}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            <tr style={{ background: 'var(--color-grey-pale)' }}>
              {rowCells(addDraft, (patch) => setAddDraft((prev) => ({ ...prev, ...patch })), 'std-add')}
              <td style={TD}></td>
              <td style={{ ...TD, textAlign: 'right' }}>
                <button type="button" className="btn-primary" data-view-mutates="true"
                  disabled={busy || !addDraft.label.trim() || !normaliseAssetTypeId(addDraft.label)}
                  style={{ padding: '4px 12px', fontSize: 'var(--font-small)' }}
                  onClick={() => { void saveEntry(addDraft); }} data-testid="std-add-save">
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {drafts.length === 0 && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 'var(--sp-1)' }} data-testid="asset-standards-empty">
          No asset types yet. Start from the standard list above, or type your own in the add row.
          There are no built-in numbers: unit sizes, parking ratios and rates are company decisions,
          not platform defaults.
        </div>
      )}

      {notice && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-positive, #15803d)', marginTop: 'var(--sp-1)' }} data-testid="asset-standards-notice">
          {notice}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-negative)', marginTop: 'var(--sp-1)' }} data-testid="asset-standards-error">
          {error}
        </div>
      )}

      <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginTop: 'var(--sp-2)' }}>
        Reference categories: {ASSET_TYPE_CATEGORIES.map((c) => `${c} (${ASSET_TYPES_BY_CATEGORY[c].length})`).join(', ')}.
        Every row here is yours to rename, re-categorise, reorder or remove.
      </div>
    </div>
  );
}
