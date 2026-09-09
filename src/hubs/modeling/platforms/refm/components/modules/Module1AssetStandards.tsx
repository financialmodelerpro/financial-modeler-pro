'use client';

/**
 * Module1AssetStandards.tsx (REFM Module 1, tab 4, migs 242-244)
 *
 * LAND AND ASSET DATA MANAGEMENT, in two halves that live in two places:
 *
 *   THE NAMES ARE THE FIRM'S. Type, category and order are account-scoped
 *   (`refm_asset_types`), shared across every project the firm opens, edited
 *   by ANY member (vocabulary, not entitlement, the cost catalog rule), and
 *   saved through /api/refm/asset-types with an explicit Save per row.
 *
 *   THE VALUES ARE THE PROJECT'S. Unit size, parking ratio and its basis,
 *   build cost per sqm and a revenue rate with its unit are assumptions of
 *   THIS project, because a firm's schemes genuinely differ. They live in the
 *   snapshot (`project.assetTypeValues`, keyed by the type's entry id, plus
 *   `project.parkingAreaPerSlotSqm`) and are therefore ordinary model inputs:
 *   typing one changes the model immediately, autosave persists it, the change
 *   log records it and a version captures it, exactly like a cost rate. There
 *   is deliberately NO Save button on that half, because nothing else in the
 *   model has one.
 *
 * NOTHING IS STAMPED ONTO AN ASSET. That scheme existed only while the values
 * sat on an account table the engine must never read. An asset now holds a
 * REFERENCE (`assetTypeId`) and reads its values live, so editing a standard
 * cannot leave a model stale and nobody has to re-pick a type.
 *
 * THE PROJECT'S VIEW LOCK GOVERNS THE RIGHT HALF ONLY. A project opens
 * read-only until Edit, which is right for the values: they are model inputs
 * in the snapshot. It is NOT right for the firm's list, which is account data
 * shared by every project and writable by any member; whether you happen to be
 * viewing some project read-only says nothing about your firm's vocabulary. So
 * the firm's controls declare no `data-view-mutates` and its text inputs
 * declare `data-view-editable`, and the two halves lock differently on purpose.
 * This is the one tab where account data and model data share a row, which is
 * why the distinction shows up here and nowhere else.
 *
 * A BLANK AND A TYPED ZERO ARE DIFFERENT ANSWERS: an empty cell means "not
 * decided" (the field is absent from the snapshot) and a 0 is a decision.
 * Blanks render as a placeholder, never as 0.
 *
 * Table pattern follows Module 3 OpEx (navy header, one editable row per
 * record, an add row at the foot, remove at the end of each row).
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  PARKING_RATIO_BASES,
  PARKING_RATIO_BASIS_LABELS,
  normaliseAssetTypeId,
  orphanedValueTypeIds,
  sortAssetTypes,
  typesWithoutStandard,
  type AssetTypeStandard,
  type AssetTypeValues,
  type ParkingRatioBasis,
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

// THE TWO HALVES ARE SAVED DIFFERENTLY, SO THEY LOOK DIFFERENT.
//
// Left of the divider is the firm's list: an account record behind an
// explicit Save. Right of it are this project's values, which autosave into
// the snapshot like every other model input. The Save button used to sit at
// the END of the row, past the project values, which made it look as though
// it saved the whole row. Everything it does now sits beside it.
const FIRM_CELL: React.CSSProperties = { ...TD, background: 'color-mix(in srgb, var(--color-navy) 5%, transparent)' };
const DIVIDER: React.CSSProperties = { borderLeft: '3px solid var(--color-navy)' };
const TD_PROJECT_FIRST: React.CSSProperties = { ...TD, ...DIVIDER };
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

/** Busy keys for the two controls that are not a saved row. */
const ADD_KEY = '__add__';
const ORDER_KEY = '__order__';

/** The account half of a row, which needs an explicit Save. */
interface NameDraft { entryId?: string; label: string; category: string }
const EMPTY_NAME: NameDraft = { label: '', category: '' };
const toNameDraft = (e: AssetTypeStandard): NameDraft => ({
  entryId: e.id, label: e.label, category: e.category ?? '',
});

/** '' -> undefined (blank, not decided); otherwise a finite non-negative
 *  number. Anything else is refused rather than coerced, so a typo can never
 *  silently become a number nobody meant. */
function parseValue(s: string): { ok: true; value: number | undefined } | { ok: false } {
  const t = s.trim();
  if (t === '') return { ok: true, value: undefined };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

/**
 * One numeric PROJECT value.
 *
 * Local text state so a half-typed entry and an empty cell both survive, and
 * every accepted keystroke commits straight to the store, because these are
 * model inputs and the model has no Save buttons.
 */
function ValueCell({
  value, onCommit, testId, disabled, title,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  testId: string;
  disabled?: boolean;
  title?: string;
}): React.JSX.Element {
  // DRAFT OR STORE, with no effect to keep them in step.
  //
  // `draft === null` means "follow the store", so an external change (a
  // version load, an undo, another surface) shows immediately. While the user
  // is typing, the draft wins, which is what lets a half-typed "1." and an
  // empty cell both survive. Blur drops the draft, so anything that never
  // parsed snaps back to the last value that did.
  const [draft, setDraft] = useState<string | null>(null);
  const stored = value !== undefined ? String(value) : '';
  const text = draft ?? stored;
  const bad = draft !== null && !parseValue(draft).ok;
  return (
    <input
      style={{ ...FAST_INPUT, ...(bad ? { borderColor: 'var(--color-negative)' } : {}) }}
      value={text}
      inputMode="decimal"
      placeholder="not set"
      disabled={disabled}
      title={title}
      data-testid={testId}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const parsed = parseValue(next);
        if (parsed.ok) onCommit(parsed.value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export default function Module1AssetStandards({ projectId }: { projectId: string | null }): React.JSX.Element {
  const { project, assets, setProject, setAssetTypeValue } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      assets: s.assets,
      setProject: s.setProject,
      setAssetTypeValue: s.setAssetTypeValue,
    })),
  );

  const [entries, setEntries] = useState<AssetTypeStandard[]>([]);
  const [available, setAvailable] = useState(true);
  const [nameDrafts, setNameDrafts] = useState<NameDraft[]>([]);
  const [addDraft, setAddDraft] = useState<NameDraft>(EMPTY_NAME);
  // BUSY IS KEYED, not global. One boolean meant that saving row 3 greyed out
  // row 7's buttons for the round trip, and a hung request disabled the whole
  // tab. The key is the entry id for a row, ADD_KEY for the add row, and
  // ORDER_KEY for a reorder, which really is list-wide because it rewrites
  // every row's position and two of them at once would race.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const rowBusy = (key: string): boolean => busyKey === key;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const values = project.assetTypeValues ?? {};

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/refm/asset-types');
      if (!res.ok) { setAvailable(false); return; }
      const body = await res.json() as { entries?: AssetTypeStandard[]; available?: boolean };
      const list = Array.isArray(body.entries) ? sortAssetTypes(body.entries) : [];
      setEntries(list);
      setNameDrafts(list.map(toNameDraft));
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
  // Values this project holds for types the firm has since removed. Kept, not
  // deleted: an account-level edit must not silently drop project numbers.
  const orphans = orphanedValueTypeIds(project.assetTypeValues, entries);

  const flash = (msg: string): void => { setNotice(msg); setTimeout(() => setNotice(null), 3000); };

  const saveName = async (d: NameDraft): Promise<void> => {
    setError(null);
    const label = d.label.trim();
    if (!label) { setError('Every asset type needs a name.'); return; }
    const key = d.entryId ?? ADD_KEY;
    setBusyKey(key);
    try {
      const res = await fetch('/api/refm/asset-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(d.entryId ? { entryId: d.entryId } : {}),
          label,
          category: d.category.trim(),
        }),
      });
      const body = await res.json() as { entry?: AssetTypeStandard; error?: string };
      if (!res.ok || !body.entry) throw new Error(body.error ?? 'Could not save the entry.');
      if (!d.entryId) setAddDraft(EMPTY_NAME);
      flash(d.entryId ? `Saved ${label}.` : `Added ${label}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const deleteEntry = async (entryId: string, label: string): Promise<void> => {
    setError(null);
    setBusyKey(entryId);
    try {
      const res = await fetch(`/api/refm/asset-types?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Could not delete the entry.');
      flash(`Removed ${label} from your firm's list. This project keeps the values it had for it.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  /** Move one row and write the whole order in ONE batched request. */
  const move = async (index: number, delta: number): Promise<void> => {
    const next = entries.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    setEntries(next);
    setNameDrafts(next.map(toNameDraft));
    setBusyKey(ORDER_KEY);
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
      setBusyKey(null);
    }
  };

  /** Seed every reference type not already in the firm's list, with its category. */
  const seedStandardList = async (): Promise<void> => {
    setError(null);
    setBusyKey(ADD_KEY);
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
      flash(`Added ${body.entries.length} asset types. Fill in this project's values on each row.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const prefillLabel = (label: string): void => {
    const cat = assetTypeCategory(label);
    setAddDraft((prev) => ({ ...prev, label, ...(cat ? { category: cat } : {}) }));
    setError(null);
  };

  const patchName = (i: number, patch: Partial<NameDraft>): void =>
    setNameDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const noProject = !projectId;

  /** The five value cells for one type id. Disabled with no project open,
   *  because a value without a project has nowhere to live. */
  const valueCells = (id: string, v: AssetTypeValues | undefined): React.JSX.Element => (
    <>
      <td style={TD_PROJECT_FIRST}>
        <ValueCell
          value={v?.avgUnitSizeSqm} disabled={noProject}
          testId={`std-row-${id}-unit-size`}
          title="Fallback only: an asset whose sub-units carry their own unit areas uses those instead."
          onCommit={(n) => setAssetTypeValue(id, { avgUnitSizeSqm: n })}
        />
      </td>
      <td style={TD}>
        <ValueCell
          value={v?.parkingRatio} disabled={noProject}
          testId={`std-row-${id}-parking-ratio`}
          title="The default for assets of this type. A sub-unit can override it."
          onCommit={(n) => setAssetTypeValue(id, { parkingRatio: n })}
        />
      </td>
      <td style={TD}>
        <select
          style={TEXT_INPUT}
          value={v?.parkingRatioBasis ?? 'slots_per_unit'}
          disabled={noProject}
          data-testid={`std-row-${id}-basis`}
          onChange={(e) => setAssetTypeValue(id, { parkingRatioBasis: e.target.value as ParkingRatioBasis })}
        >
          {PARKING_RATIO_BASES.map((b) => (<option key={b} value={b}>{PARKING_RATIO_BASIS_LABELS[b]}</option>))}
        </select>
      </td>
      {/* CONSTRUCTION COST, REVENUE RATE AND ITS UNIT ARE NOT SHOWN
          (2026-09-08). Nothing reads them yet, and a rate on screen invites
          the question of where it applies, which today is nowhere. They are
          HIDDEN, NOT DROPPED: the fields stay on `AssetTypeValues`, the store
          action still merges them, the route still validates them, and any
          value already entered is preserved untouched and will reappear with
          these columns when Capex and revenue are wired to read from here.
          Removed from the markup rather than gated behind a false condition,
          which would still read as present to anything grepping this file. */}
    </>
  );

  return (
    <div data-testid="tab-asset-standards">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-3)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <h2 style={{ fontSize: 'var(--font-h2)', margin: 0 }}>4. Asset Types &amp; Standards</h2>
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic' }}>
          Names shared across your firm. Values belong to this project. Rates in {project.currency}.
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
        <strong>What goes here:</strong> your firm&apos;s asset types on the left of the divider,
        and <strong>this project&apos;s values</strong> for each of them on the right.{' '}
        <strong>The two halves save differently.</strong> The names, categories and order are one
        shared list every project your firm opens will see, so a change there waits for{' '}
        <strong>Save</strong>. The values are assumptions of this project, so they save themselves
        as you type, version and appear in the change log like any other input, and an asset of
        that type reads them live. A <strong>blank</strong> means the value is not set; a{' '}
        <strong>0</strong> is a real zero. Unit size here is the <strong>fallback</strong>: an
        asset whose sub-units carry their own unit areas uses those. The parking ratio is the{' '}
        <strong>default</strong>, and a sub-unit can override it.
      </div>

      {noProject && (
        <div
          style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}
          data-testid="asset-standards-no-project"
        >
          Open a project to enter values. The type list below is your firm&apos;s and can be edited
          without one.
        </div>
      )}

      {!available && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-negative)', marginBottom: 'var(--sp-2)' }} data-testid="asset-standards-unavailable">
          Your firm&apos;s type list could not be reached, so the names below may be incomplete and
          saving them may fail. Any values you have already entered are part of this project and
          are unaffected.
        </div>
      )}

      {/* THE PROJECT'S PARKING STANDARDS, both of them.
          The retail figure joined its sibling here on 2026-09-09. It was a
          column on every plot row, which is five rows holding one number and
          five chances to disagree about it: the reference divides every plot's
          retail parking by ONE company figure, and the stored history agreed
          before the move (three assets across 1,406 versions, all holding 40).
          They are the same kind of quantity, so they sit together. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <label htmlFor="std-parking-area-per-slot" style={{ fontSize: 'var(--font-small)', fontWeight: 600 }}>
            Parking area per slot (sqm) for this project:
          </label>
          <div style={{ width: 120 }}>
            <ValueCell
              value={project.parkingAreaPerSlotSqm}
              disabled={noProject}
              testId="std-parking-area-per-slot"
              title="Sqm one parking bay occupies. A project assumption: basement and surface parking differ."
              onCommit={(n) => setProject({ parkingAreaPerSlotSqm: n })}
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <label htmlFor="std-retail-area-per-slot" style={{ fontSize: 'var(--font-small)', fontWeight: 600 }}>
            Retail GFA per slot (sqm) for this project:
          </label>
          <div style={{ width: 120 }}>
            <ValueCell
              value={project.retailAreaPerSlotSqm}
              disabled={noProject}
              testId="std-retail-area-per-slot"
              title="Sqm of retail GFA that requires one parking slot. Retail parking divides by THIS, never by an asset's own parking ratio, because a shop's parking is sized off floor area and an apartment's off units. Leave it blank and Retail Parking Slots, Retail Parking Area and Total Parking Area cannot be derived on any plot."
              onCommit={(n) => setProject({ retailAreaPerSlotSqm: n })}
            />
          </div>
        </div>
      </div>

      {/* Quick-add sources for the firm's list. */}
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
                disabled={rowBusy(ADD_KEY)}
                onClick={() => { void seedStandardList(); }} data-testid="asset-type-seed-standard-list"
                title="Adds the standard reference types you do not already have, each with its category. They are a starting set: rename, edit, reorder or remove any of them afterwards.">
                Add the standard list ({wholeCatalogToAdd.length})
              </button>
            )}
            {catalogToAdd.length > 0 && (
              <select
                value=""
                data-view-editable="true"
                data-testid="asset-type-catalog-picker"
                style={{ ...TEXT_INPUT, width: 260 }}
                onChange={(e) => { if (e.target.value) prefillLabel(e.target.value); }}
                title="The standard catalog for this project's type. Picking one fills the name into the add row below."
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
                Used in this project, not in your firm&apos;s list:
              </span>
              {projectToAdd.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => prefillLabel(t)}
                  data-testid={`asset-type-missing-${normaliseAssetTypeId(t)}`}
                  style={{ ...SMALL_BTN, borderColor: 'var(--color-primary)', color: 'var(--color-primary)', fontSize: 'var(--font-micro)' }}
                  title={`"${t}" is on an asset in this project but is not one of your firm's types. Click to fill it into the add row.`}
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
              <th style={{ ...TH, minWidth: 340 }} colSpan={4} data-testid="std-group-firm">
                Your firm&apos;s list, shared across every project
                <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.85 }}>Press Save to apply a change</div>
              </th>
              <th style={{ ...TH, ...DIVIDER, minWidth: 320 }} colSpan={3} data-testid="std-group-project">
                This project&apos;s values
                <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.85 }}>Saves as you type, like every other input</div>
              </th>
            </tr>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ ...TH, minWidth: 160 }}>Asset type</th>
              <th style={{ ...TH, minWidth: 110 }}>Category</th>
              <th style={{ ...TH, minWidth: 70, textAlign: 'center' }}>Order</th>
              <th style={{ ...TH, minWidth: 130, textAlign: 'left' }}></th>
              <th style={{ ...TH, ...DIVIDER, minWidth: 90, textAlign: 'right' }}>Avg unit size (sqm)</th>
              <th style={{ ...TH, minWidth: 80, textAlign: 'right' }}>Parking ratio</th>
              <th style={{ ...TH, minWidth: 140 }}>Ratio basis</th>
            </tr>
          </thead>
          <tbody>
            {nameDrafts.map((d, i) => (
              <tr key={d.entryId ?? i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                {/* ── the firm's half: everything here needs Save ── */}
                <td style={FIRM_CELL}>
                  <input style={TEXT_INPUT} value={d.label} data-view-editable="true" data-testid={`std-row-${d.entryId}-label`}
                    placeholder="e.g. High End Apartments" onChange={(e) => patchName(i, { label: e.target.value })} />
                </td>
                <td style={FIRM_CELL}>
                  <input style={TEXT_INPUT} value={d.category} list="asset-standard-categories"
                    data-view-editable="true" data-testid={`std-row-${d.entryId}-category`}
                    placeholder="e.g. Residential" onChange={(e) => patchName(i, { category: e.target.value })} />
                </td>
                <td style={{ ...FIRM_CELL, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ ...SMALL_BTN, padding: '2px 6px' }}
                    disabled={rowBusy(ORDER_KEY) || i === 0} onClick={() => { void move(i, -1); }}
                    data-testid={`std-row-${d.entryId}-up`} title="Move up. Order is part of your firm's list and is saved immediately.">
                    ^
                  </button>{' '}
                  <button type="button" style={{ ...SMALL_BTN, padding: '2px 6px' }}
                    disabled={rowBusy(ORDER_KEY) || i === nameDrafts.length - 1} onClick={() => { void move(i, 1); }}
                    data-testid={`std-row-${d.entryId}-down`} title="Move down. Order is part of your firm's list and is saved immediately.">
                    v
                  </button>
                </td>
                <td style={{ ...FIRM_CELL, whiteSpace: 'nowrap' }}>
                  <button type="button" style={SMALL_BTN} disabled={rowBusy(d.entryId ?? ADD_KEY)}
                    onClick={() => { void saveName(d); }} data-testid={`std-row-${d.entryId}-save`}
                    title="Saves the NAME and CATEGORY to your firm's list, which every project sees. It does not save this project's values on the right: those save themselves as you type.">
                    Save
                  </button>{' '}
                  <button type="button"
                    style={{ ...SMALL_BTN, color: 'var(--color-negative)', borderColor: 'var(--color-negative)' }}
                    disabled={rowBusy(d.entryId!)}
                    onClick={() => { void deleteEntry(d.entryId!, d.label); }}
                    data-testid={`std-row-${d.entryId}-delete`}
                    title="Removes the type from your firm's list. This project keeps any values it holds for it.">
                    Remove
                  </button>
                </td>
                {/* ── this project's half: saves itself ── */}
                {valueCells(d.entryId as string, values[d.entryId as string])}
              </tr>
            ))}
            {/* The add row takes a NAME only: a type has to exist before this
                project can hold values for it. */}
            <tr style={{ background: 'var(--color-grey-pale)' }}>
              <td style={FIRM_CELL}>
                <input style={TEXT_INPUT} value={addDraft.label} data-view-editable="true" data-testid="std-add-label"
                  placeholder="e.g. High End Apartments" onChange={(e) => setAddDraft((p) => ({ ...p, label: e.target.value }))} />
              </td>
              <td style={FIRM_CELL}>
                <input style={TEXT_INPUT} value={addDraft.category} list="asset-standard-categories"
                  data-view-editable="true" data-testid="std-add-category"
                  placeholder="e.g. Residential" onChange={(e) => setAddDraft((p) => ({ ...p, category: e.target.value }))} />
              </td>
              <td style={FIRM_CELL}></td>
              <td style={FIRM_CELL}>
                <button type="button" className="btn-primary"
                  disabled={rowBusy(ADD_KEY) || !addDraft.label.trim() || !normaliseAssetTypeId(addDraft.label)}
                  style={{ padding: '4px 12px', fontSize: 'var(--font-small)' }}
                  onClick={() => { void saveName(addDraft); }} data-testid="std-add-save">
                  Add
                </button>
              </td>
              <td style={{ ...TD_PROJECT_FIRST, color: 'var(--color-meta)', fontSize: 10 }} colSpan={3}>
                Add the type first; its values are entered on its own row.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {nameDrafts.length === 0 && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 'var(--sp-1)' }} data-testid="asset-standards-empty">
          No asset types yet. Start from the standard list above, or type your own in the add row.
          There are no built-in numbers: unit sizes, parking ratios and rates are decisions, not
          platform defaults.
        </div>
      )}

      {orphans.length > 0 && (
        <div
          style={{
            marginTop: 'var(--sp-2)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)', padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--font-small)',
          }}
          data-testid="asset-standards-orphans"
        >
          <strong>Values for types no longer in your firm&apos;s list:</strong>{' '}
          {orphans.join(', ')}. They are kept because removing a name from the firm&apos;s list must
          not delete this project&apos;s numbers. Add the type back to edit them here.
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
