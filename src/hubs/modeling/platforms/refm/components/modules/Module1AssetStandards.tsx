'use client';

/**
 * Module1AssetStandards.tsx (REFM Module 1, tab 4, migs 242-244; the list moved
 * onto the project 2026-09-10)
 *
 * LAND AND ASSET DATA MANAGEMENT, and BOTH HALVES ARE THIS PROJECT'S.
 *
 *   THE NAMES. Type, category and order live in the snapshot
 *   (`project.assetTypes`). They were account-scoped until 2026-09-10, and the
 *   split cost two things: a firm's projects come from different land owners
 *   and developers, so each names its types as its own scheme requires, and an
 *   edit made inside one project reached every other one, adding rows to their
 *   tables or orphaning their values under a banner blaming a deletion nobody
 *   made. See docs/TRAPS.md 7.35, which this closed.
 *
 *   THE VALUES. Unit size, parking ratio and its basis, coverage, FAR and the
 *   service share are assumptions of THIS project (`project.assetTypeValues`,
 *   keyed by the type's id, plus `project.parkingAreaPerSlotSqm`).
 *
 * SO THERE IS NO SAVE BUTTON ANYWHERE ON THIS TAB. Both halves are ordinary
 * model inputs: typing one changes the model immediately, autosave persists it,
 * the change log records which type moved, and a version captures it, exactly
 * like a cost rate. The names used to need one because they were an account
 * record behind a round trip; they are not any more.
 *
 * THE FIRM'S LIST SURVIVES AS A TEMPLATE, and it is the only thing here that is
 * still a request. It is SEEDED FROM on demand (never at project creation:
 * nobody knows what a project is when it is created) and PUSHED BACK
 * explicitly, one way, by a button. Both ends are scoped to the account that
 * OWNS this project, never the caller's, so a platform admin working inside a
 * client's project seeds and pushes the client's names.
 *
 * NOTHING IS STAMPED ONTO AN ASSET. An asset holds a REFERENCE
 * (`assetTypeId`) and reads its values live, so editing a standard cannot leave
 * a model stale and nobody has to re-pick a type.
 *
 * THE PROJECT'S VIEW LOCK GOVERNS THE WHOLE TAB. It governed only the right
 * half while the left one was account data, which was right then and is wrong
 * now: a name in the snapshot is a model input like the number beside it. So
 * every mutating button declares `data-view-mutates` (buttons are opt-IN) and
 * not one input opts out of the lock.
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
  constructionRowsForView, upsertCostStandardRow, newCustomRow, costStandardBasisLabel, baseOptionsFor, rowBaseIds, rowBasisLabel,
  type CostStandardRow, type CostStandardList,
} from '../../lib/state/costStandards';
import { typePriceColumns } from '../../lib/state/subUnitPriceDefaults';
import type { CostMethod } from '../../lib/state/module1-types';
import { AssetPhasingControl } from './Module1Costs';
import { TabComments } from '../collab/FieldComments';
import {
  ASSET_TYPES_BY_CATEGORY,
  ASSET_TYPE_CATEGORIES,
  ASSET_TYPE_CATALOG,
  ASSET_STRATEGIES,
  type AssetStrategy,
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
// Headers centred both ways (2026-09-15, founder).
const TH: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 600 };
const TD: React.CSSProperties = { padding: '4px 6px' };

// THE TWO HALVES LOOK DIFFERENT BUT SAVE THE SAME WAY (2026-09-15).
//
// Left of the divider is this project's list of types (names, categories and
// order), right of it this project's values for each. Both have lived in the
// snapshot and saved as you type since 2026-09-10; the tint only separates what
// a type IS from the numbers this project gives it. The one explicit save on
// the tab is "Save this list to the firm's template".
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

/** The ONE busy key left: the firm template, which is the only thing on this
 *  tab that is still a round trip. Every edit to the project's own list is a
 *  store write and returns before the next render. */
const TEMPLATE_KEY = '__template__';

/** The add row's draft. The rows themselves need none: they write through.
 *  A blank name is a real state while typing, so it lives here, not in the list. */
interface NameDraft { entryId?: string; label: string; category: string }
const EMPTY_NAME: NameDraft = { label: '', category: '' };

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
/**
 * TWO PRICE COLUMNS, READ BY THE TYPE'S STRATEGY (2026-09-15, founder: "the rate
 * column carries its own unit per row"). A Sell type reads both as sale prices,
 * an Operate type reads the per-unit price as the ADR per key night, a Lease type
 * reads the per-sqm price as the rent per sqm per year; the unit label under each
 * cell says which (`typePriceColumns`, the rule the Table 5 default follows too).
 * A column the strategy does not use shows a dash. Every Table 5 row of the type
 * with no price of its own takes these (lib/state/subUnitPriceDefaults.ts).
 */
const PRICE_COLUMNS: ReadonlyArray<{ key: 'pricePerUnit' | 'pricePerSqm'; label: string; column: 'unit' | 'sqm' }> = [
  { key: 'pricePerUnit', label: 'Price per unit', column: 'unit' },
  { key: 'pricePerSqm', label: 'Price per sqm', column: 'sqm' },
];

function ValueCell({
  value, onCommit, testId, disabled, title, decimals,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  testId: string;
  disabled?: boolean;
  title?: string;
  /** Fixed decimals when not being typed in: two for every percentage (2026-09-15). */
  decimals?: number;
}): React.JSX.Element {
  // DRAFT OR STORE, with no effect to keep them in step.
  //
  // `draft === null` means "follow the store", so an external change (a
  // version load, an undo, another surface) shows immediately. While the user
  // is typing, the draft wins, which is what lets a half-typed "1." and an
  // empty cell both survive. Blur drops the draft, so anything that never
  // parsed snaps back to the last value that did.
  const [draft, setDraft] = useState<string | null>(null);
  const stored = value !== undefined ? (decimals !== undefined ? value.toFixed(decimals) : String(value)) : '';
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
  const { project, assets, phases, costLines, updateAsset, setProject, setAssetTypeValue, setAssetTypes, setCostStandardRows } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      assets: s.assets,
      phases: s.phases,
      costLines: s.costLines,
      setCostStandardRows: s.setCostStandardRows,
      updateAsset: s.updateAsset,
      setProject: s.setProject,
      setAssetTypeValue: s.setAssetTypeValue,
      setAssetTypes: s.setAssetTypes,
    })),
  );

  // THE LIST IS THE PROJECT'S NOW (2026-09-10), so it comes from the store,
  // not from a fetch. There is no loading state and no `available` for it: it
  // is in the snapshot the screen already has.
  const entries = useMemo(() => sortAssetTypes(project.assetTypes ?? []), [project.assetTypes]);
  // EVERY RATE ON THIS TAB IS BASE-YEAR MONEY (2026-09-16, step 10b): the project
  // start year, which the escalation rate beside the lists carries forward.
  const baseYear = useMemo(() => new Date(project.startDate).getUTCFullYear(), [project.startDate]);
  const [addDraft, setAddDraft] = useState<NameDraft>(EMPTY_NAME);
  // BUSY IS KEYED, not global, and only the TEMPLATE calls are ever busy now:
  // every edit to the list itself is a store write and returns immediately.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const rowBusy = (key: string): boolean => busyKey === key;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // THE FIRM'S TEMPLATE, fetched once and used for exactly two things: the
  // count on the seed button and the seed itself. Scoped to the account that
  // OWNS this project, never the caller's (docs/TRAPS.md 7.35): a platform
  // admin seeding inside a client's project seeds the client's names.
  const [template, setTemplate] = useState<{ entries: AssetTypeStandard[]; available: boolean }>({
    entries: [], available: true,
  });
  const loadTemplate = useCallback(async (): Promise<void> => {
    try {
      const url = projectId
        ? `/api/refm/asset-types?projectId=${encodeURIComponent(projectId)}`
        : '/api/refm/asset-types';
      const res = await fetch(url);
      if (!res.ok) { setTemplate((p) => ({ ...p, available: false })); return; }
      const body = await res.json() as { entries?: AssetTypeStandard[]; available?: boolean };
      setTemplate({
        entries: Array.isArray(body.entries) ? sortAssetTypes(body.entries) : [],
        available: body.available !== false,
      });
    } catch {
      setTemplate((p) => ({ ...p, available: false }));
    }
  }, [projectId]);
  useEffect(() => { void loadTemplate(); }, [loadTemplate]);

  const values = project.assetTypeValues ?? {};
  // THE COST STANDARDS (2026-09-14, founder: the reference model's two lists).
  const storedRows = useMemo(() => project.costStandardRows ?? [], [project.costStandardRows]);
  const constructionRows = useMemo(() => constructionRowsForView(storedRows, entries), [storedRows, entries]);
  const softRows = useMemo(() => storedRows.filter((r) => r.list === 'soft'), [storedRows]);
  const [phaseOpen, setPhaseOpen] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<CostStandardList, { label: string; method: CostMethod }>>({
    construction: { label: '', method: 'rate_x_main_asset_gfa' },
    soft: { label: '', method: 'percent_of_selected' },
  });
  const currency = project.currency ?? '';
  /** Any edit on a row LINKS it: from then on it creates its line in every phase it applies to. */
  const writeRow = (row: CostStandardRow, patch: Partial<CostStandardRow>): void => {
    const { stored: _stored, ...clean } = row as CostStandardRow & { stored?: boolean };
    const next: Record<string, unknown> = { ...clean, ...patch, linked: true };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    setCostStandardRows(upsertCostStandardRow(storedRows, next as unknown as CostStandardRow));
  };
  const writePhaseRate = (row: CostStandardRow, phaseId: string, n: number | undefined): void => {
    const byPhase = { ...(row.byPhase ?? {}) };
    if (n === undefined) delete byPhase[phaseId]; else byPhase[phaseId] = n;
    writeRow(row, { byPhase: Object.keys(byPhase).length > 0 ? byPhase : undefined });
  };
  const toggleType = (row: CostStandardRow, typeId: string): void => {
    const cur = new Set(row.appliesToTypeIds ?? []);
    if (cur.has(typeId)) cur.delete(typeId); else cur.add(typeId);
    writeRow(row, { appliesToTypeIds: cur.size > 0 ? [...cur] : undefined });
  };
  const addRow = (list: CostStandardList): void => {
    const d = draft[list];
    if (!d.label.trim()) return;
    const [method, charges] = String(d.method).split(':');
    setCostStandardRows([...storedRows, newCustomRow(list, d.label, method as CostMethod, charges === 'hard_and_soft' ? 'hard_and_soft' : undefined)]);
    setDraft((p) => ({ ...p, [list]: { ...p[list], label: '' } }));
  };

  // The three quick-add sources, all through the ONE covered-already rule.
  const platformCatalog = assetTypeCatalogForProjectType(project.projectType);
  const projectTypesInUse = useMemo(
    () => Array.from(new Set(assets.map((a) => (a.type ?? '').trim()).filter((t) => t !== ''))),
    [assets],
  );
  const catalogToAdd = typesWithoutStandard(platformCatalog, entries);
  const projectToAdd = typesWithoutStandard(projectTypesInUse, entries);
  const wholeCatalogToAdd = typesWithoutStandard(ASSET_TYPE_CATALOG, entries);
  const templateToAdd = useMemo(
    () => template.entries.filter((t) => !entries.some((e) => e.id === t.id)),
    [template.entries, entries],
  );
  // Values this project holds for a type that is not in ITS OWN list. The cause
  // is honest now: somebody removed the name from THIS project, in this project.
  // It used to say "the firm's list", which was a false explanation on any
  // project whose values had been keyed by somebody else's vocabulary.
  const orphans = orphanedValueTypeIds(project.assetTypeValues, entries);

  const flash = (msg: string): void => { setNotice(msg); setTimeout(() => setNotice(null), 3000); };

  // ── Editing the list: ordinary store writes, like every other model input ──
  //
  // NO SAVE BUTTON, and that is the point of the move: the names sit in the
  // snapshot beside the values, so they autosave, version, diff and change-log
  // the same way. A Save button here would be the only one in the model.
  const writeTypes = (next: readonly AssetTypeStandard[]): void => {
    setError(null);
    setAssetTypes(next);
  };

  const renameType = (id: string, patch: Partial<Pick<AssetTypeStandard, 'label' | 'category'>>): void =>
    writeTypes(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const removeType = (id: string, label: string): void => {
    writeTypes(entries.filter((e) => e.id !== id));
    // THE VALUES ARE KEPT, exactly as they were when this deleted an account
    // row: removing a name must not delete numbers as a side effect. They show
    // below as belonging to a type this project no longer lists.
    flash(`Removed ${label}. This project keeps the values it had for it.`);
  };

  const addType = (): void => {
    const label = addDraft.label.trim();
    if (!label) { setError('Every asset type needs a name.'); return; }
    const id = normaliseAssetTypeId(label);
    if (!id) { setError('That name has no letters or digits to build an id from.'); return; }
    if (entries.some((e) => e.id === id)) { setError(`${label} is already in this project's list.`); return; }
    writeTypes([...entries, { id, label, ...(addDraft.category.trim() ? { category: addDraft.category.trim() } : {}) }]);
    setAddDraft(EMPTY_NAME);
    flash(`Added ${label}.`);
  };

  /** Move one row. A REORDER IS THE USER ARRANGING THE LIST, so every row gets
   *  an explicit position: unlike the hydrate backfill, which leaves them all
   *  absent because nobody has arranged anything yet. */
  const move = (index: number, delta: number): void => {
    const next = entries.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    writeTypes(next.map((e, i) => ({ ...e, sortOrder: i })));
  };

  /** Add labels that are not in the list yet, keeping what is there. */
  const addLabels = (labels: readonly string[], what: string): void => {
    const add: AssetTypeStandard[] = [];
    for (const label of labels) {
      const id = normaliseAssetTypeId(label);
      if (!id || entries.some((e) => e.id === id) || add.some((e) => e.id === id)) continue;
      const cat = assetTypeCategory(label);
      add.push({ id, label, ...(cat ? { category: cat } : {}) });
    }
    if (add.length === 0) return;
    writeTypes([...entries, ...add]);
    flash(`Added ${add.length} asset type${add.length === 1 ? '' : 's'} from ${what}. Fill in this project's values on each row.`);
  };

  /** Seed from the FIRM'S TEMPLATE. Ids and categories come across verbatim, so
   *  a value this project already holds under one of them stays attached. */
  const seedFromTemplate = (): void => {
    if (templateToAdd.length === 0) return;
    writeTypes([...entries, ...templateToAdd.map((t) => ({ id: t.id, label: t.label, ...(t.category ? { category: t.category } : {}) }))]);
    flash(`Seeded ${templateToAdd.length} asset type${templateToAdd.length === 1 ? '' : 's'} from the firm's template.`);
  };

  /**
   * PUSH THIS PROJECT'S LIST BACK TO THE FIRM'S TEMPLATE.
   *
   * ONE WAY, and explicit every time. There is no sync, no watching and no
   * automatic write-back: a project's list is its own, and the only way it
   * reaches the template is somebody deciding it should. The template is
   * ADDED TO rather than replaced, because a template is a starting point for
   * every future project and this project is not the authority on all of them.
   */
  const pushToTemplate = async (): Promise<void> => {
    if (!projectId || entries.length === 0) return;
    setError(null);
    setBusyKey(TEMPLATE_KEY);
    try {
      const res = await fetch(`/api/refm/asset-types?projectId=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: entries.map((e, i) => ({
            entryId: e.id,
            label: e.label,
            category: e.category ?? '',
            sortOrder: i,
          })),
        }),
      });
      const body = await res.json() as { entries?: AssetTypeStandard[]; error?: string };
      if (!res.ok || !body.entries) throw new Error(body.error ?? 'Could not update the firm template.');
      flash(`Saved ${body.entries.length} asset type${body.entries.length === 1 ? '' : 's'} to the firm template. Other projects are untouched.`);
      await loadTemplate();
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

  const noProject = !projectId;

  /** The five value cells for one type id. Disabled with no project open,
   *  because a value without a project has nowhere to live. */
  const valueCells = (id: string, v: AssetTypeValues | undefined): React.JSX.Element => (
    <>
      {/* WHAT YOU DO WITH A BUILDING OF THIS TYPE. The CATEGORY on the left says
          what kind of building it is; this says what you do with it, and they
          are separate questions. A blank inherits nothing and leaves the add
          path on its own default, which is what every project has today. */}
      <td style={TD_PROJECT_FIRST}>
        <select
          style={TEXT_INPUT}
          value={v?.strategy ?? ''}
          disabled={noProject}
          data-testid={`std-row-${id}-strategy`}
          title="The strategy a NEW asset of this type takes. A plot always overrides it, and nothing retro-applies: changing a strategy on an existing asset parks its sub-units, opex and companion, so it is a model operation and not a standard."
          onChange={(e) => setAssetTypeValue(id, { strategy: (e.target.value || undefined) as AssetStrategy | undefined })}
        >
          <option value="">not set</option>
          {ASSET_STRATEGIES.map((st) => (<option key={st} value={st}>{st}</option>))}
        </select>
      </td>
      <td style={TD}>
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
          title="The default for assets of this type. A sub-unit can override it. On the sqm-per-slot basis this is what a retail type's ground-floor parking divides by."
          // THE BASIS IS STORED WITH THE RATIO (2026-09-10). The dropdown
          // beside this cell DISPLAYED a default it never wrote, so a type
          // could hold a ratio with no basis at all, and the chain then read it
          // as slots per unit: the screen and the model agreed, but only by
          // coincidence, and a ratio meant as sqm per slot multiplied a unit
          // count instead of dividing an area, silently. A ratio now always
          // arrives with the basis the user was shown when they typed it.
          onCommit={(n) => setAssetTypeValue(id, {
            parkingRatio: n,
            ...(n !== undefined && v?.parkingRatioBasis === undefined
              ? { parkingRatioBasis: 'slots_per_unit' as ParkingRatioBasis }
              : {}),
          })}
        />
      </td>
      <td style={TD}>
        <select
          style={TEXT_INPUT}
          // Only ever a display default now for a row that states NO ratio, so
          // it decides nothing: hydrate stamps the basis onto every stored type
          // that has one, and the ratio cell writes it for every new one.
          value={v?.parkingRatioBasis ?? 'slots_per_unit'}
          disabled={noProject}
          data-testid={`std-row-${id}-basis`}
          onChange={(e) => setAssetTypeValue(id, { parkingRatioBasis: e.target.value as ParkingRatioBasis })}
        >
          {PARKING_RATIO_BASES.map((b) => (<option key={b} value={b}>{PARKING_RATIO_BASIS_LABELS[b]}</option>))}
        </select>
      </td>
      {/* THE MASSING A TYPE USUALLY BUILDS TO (2026-09-10). Five plots of one
          type usually share these three, so they default here and a plot
          overrides where it differs. The RETAIL SHARE is deliberately absent:
          it is ground-floor retail on THIS plot, it decides which companion
          exists and how much land is carved, and it is the most plot-specific
          figure in the chain. */}
      <td style={TD}>
        <ValueCell
          value={v?.utilisationPct} disabled={noProject} decimals={2}
          testId={`std-row-${id}-utilisation`}
          title="Share of the plot this type usually develops. A plot that differs types its own; a plot left blank inherits this. Filled back from the assets tab when every plot of the type states the same figure."
          onCommit={(n) => setAssetTypeValue(id, { utilisationPct: n })}
        />
      </td>
      <td style={TD}>
        <ValueCell
          value={v?.coveragePct} disabled={noProject} decimals={2}
          testId={`std-row-${id}-coverage`}
          title="Ground coverage percent this type usually builds to. A plot that differs types its own; a typed 0 on the plot is a real override, not a blank."
          onCommit={(n) => setAssetTypeValue(id, { coveragePct: n })}
        />
      </td>
      <td style={TD}>
        <ValueCell
          value={v?.farRatio} disabled={noProject}
          testId={`std-row-${id}-far`}
          title="Floor area ratio this type usually builds to. OFFERED, NOT ASSUMED: FAR is a planning constraint of a piece of ground, and a plot inheriting this shows the figure greyed on its own row so nobody mistakes an inherited FAR for an unstated one."
          onCommit={(n) => setAssetTypeValue(id, { farRatio: n })}
        />
      </td>
      <td style={TD}>
        <ValueCell
          value={v?.servicePct} disabled={noProject} decimals={2}
          testId={`std-row-${id}-service`}
          title="Service and back-of-house percent this type usually takes off its main asset GFA. A plot that differs types its own."
          onCommit={(n) => setAssetTypeValue(id, { servicePct: n })}
        />
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
      <TabComments tabKey="asset-standards" />
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
          // 11px, as every other explanatory block on these tabs (2026-09-14,
          // founder: the paragraph read larger than the rest of the platform).
          fontSize: 11, lineHeight: 1.45,
        }}
        data-testid="asset-standards-callout"
      >
        {/* SAY THAT AN EDIT HERE NOW MOVES THE MODEL (2026-09-10). It did not
            until today: every value on this tab was an input nothing read.
            Coverage, FAR and the service share feed the area chain, the chain
            drives a share-stated sub-unit's area, and that area is what Capex
            charges and revenue prices. A user who thinks they are editing a
            reference table is entitled to be told otherwise. */}
        <div
          style={{
            background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)',
            border: '1px solid var(--color-warning, #92400e)',
            borderRadius: 'var(--radius-sm)', padding: '4px 8px', marginBottom: 'var(--sp-2)',
            fontSize: 'var(--font-small)',
          }}
          data-testid="asset-standards-moves-model"
        >
          <strong>An edit here now moves the model.</strong> Coverage, FAR and Service feed the
          area chain on every plot that has not typed its own, and a plot&apos;s derived areas are
          what construction charges on and what revenue prices. Changing one changes every
          inheriting plot at once, and the change is versioned and logged like any other input.
        </div>
        <strong>What goes here:</strong> this project&apos;s asset types on the left of the divider,
        and <strong>this project&apos;s values</strong> for each of them on the right.{' '}
        <strong>Both halves save as you type</strong>, version and appear in the change log like any
        other input, and an asset of that type reads them live. The one explicit save on this tab is{' '}
        <strong>Save this list to the firm&apos;s template</strong>, which copies the names to your
        firm&apos;s template for future projects. A <strong>blank</strong> means the value is not set; a{' '}
        <strong>0</strong> is a real zero. Unit size here is the <strong>fallback</strong>: an
        asset whose sub-units carry their own unit areas uses those. The parking ratio is the{' '}
        <strong>default</strong>, and a sub-unit can override it.
      </div>

      {noProject && (
        <div
          style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}
          data-testid="asset-standards-no-project"
        >
          Open a project. The list below and the values beside it both belong to a project now,
          so there is nothing on this tab to edit without one.
        </div>
      )}

      {!template.available && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-negative)', marginBottom: 'var(--sp-2)' }} data-testid="asset-standards-unavailable">
          The firm&apos;s template could not be reached, so seeding from it is unavailable. This
          project&apos;s own list and values are in the model and are unaffected.
        </div>
      )}

      {/* THE PROJECT'S ONE PARKING STANDARD.
          THE RETAIL FIGURE LEFT THIS ROW ON 2026-09-10, having arrived from the
          plot rows the day before. It is not a project assumption at all: it is
          a retail type's parking ratio, stated in sqm per slot, and the table
          below already has a cell for exactly that. A field here would be a
          second home for one number, which is what the move off the plot rows
          was correcting; the reference divides by the retail row of its own
          parking-ratio table, not by a figure kept somewhere else. Set it on
          the retail type below, on the sqm-per-slot basis.
          The area a slot OCCUPIES stays, because that genuinely is one project
          assumption: basement and surface parking differ, and no type owns it. */}
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
        <div
          style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}
          data-testid="std-retail-parking-note"
        >
          Ground-floor retail parking divides retail GFA by the retail type&apos;s own parking
          ratio below, set on the sqm-per-slot basis.
        </div>
      </div>

      {/* WHERE A TYPE COMES FROM, and where this list can be sent. The strip
          holds the three ways to fill the project's list without retyping, and,
          at its far end, the ONE control that leaves the project. */}
      {(wholeCatalogToAdd.length > 0 || catalogToAdd.length > 0 || projectToAdd.length > 0
        || templateToAdd.length > 0 || entries.length > 0) && (
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
            {templateToAdd.length > 0 && (
              <button type="button" style={{ ...SMALL_BTN, background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}
                data-view-mutates="true"
                onClick={() => seedFromTemplate()} data-testid="asset-type-seed-from-template"
                title="Copies the firm's template into THIS project's list, ids and categories included. It is a copy: editing it here changes nothing anywhere else, and the template is not watched for later changes.">
                Seed from the firm&apos;s template ({templateToAdd.length})
              </button>
            )}
            {wholeCatalogToAdd.length > 0 && (
              <button type="button" style={{ ...SMALL_BTN, background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}
                data-view-mutates="true"
                onClick={() => addLabels(wholeCatalogToAdd, 'the standard list')} data-testid="asset-type-seed-standard-list"
                title="Adds the standard reference types this project does not already have, each with its category. They are a starting set: rename, edit, reorder or remove any of them afterwards, and none of it reaches another project.">
                Add the standard list ({wholeCatalogToAdd.length})
              </button>
            )}
            {catalogToAdd.length > 0 && (
              <select
                value=""
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
            {projectId !== null && entries.length > 0 && (
              <button type="button" style={{ ...SMALL_BTN, marginLeft: 'auto' }}
                disabled={rowBusy(TEMPLATE_KEY)}
                data-view-mutates="true" onClick={() => { void pushToTemplate(); }} data-testid="asset-type-push-to-template"
                title="Adds this project's types to the firm's template, so the next project can start from them. ONE WAY and explicit: it never runs by itself, it does not remove anything from the template, and it changes no other project's list.">
                {rowBusy(TEMPLATE_KEY) ? 'Saving...' : "Save this list to the firm's template"}
              </button>
            )}
          </div>
          {projectToAdd.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} data-testid="asset-type-project-missing">
              <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
                On an asset in this project, not yet in its list:
              </span>
              {projectToAdd.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => prefillLabel(t)}
                  data-testid={`asset-type-missing-${normaliseAssetTypeId(t)}`}
                  style={{ ...SMALL_BTN, borderColor: 'var(--color-primary)', color: 'var(--color-primary)', fontSize: 'var(--font-micro)' }}
                  title={`"${t}" is on an asset in this project but is not in the project's type list. Click to fill it into the add row.`}
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
              <th style={{ ...TH, minWidth: 340 }} colSpan={3} data-testid="std-group-firm">
                This project&apos;s asset types
                <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.85 }}>Saves as you type, and reaches no other project</div>
              </th>
              <th style={{ ...TH, ...DIVIDER, minWidth: 320 }} colSpan={8} data-testid="std-group-project">
                This project&apos;s values
                <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.85 }}>Saves as you type. Utilisation, coverage, FAR and service fill back from the assets tab when every plot of the type states the same figure</div>
              </th>
            </tr>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ ...TH, minWidth: 160 }}>Asset type</th>
              <th style={{ ...TH, minWidth: 110 }}>Category</th>
              <th style={{ ...TH, minWidth: 70 }}>Order and remove</th>
              {/* STRATEGY LEADS THE PROJECT HALF, because it is the one value
                  here that decides what the others are FOR: a Sell type prices
                  a unit, an Operate type prices a key. It governs NEW assets
                  only, which the caption says. */}
              <th style={{ ...TH, ...DIVIDER, minWidth: 150 }}>Strategy for new assets</th>
              <th style={{ ...TH, minWidth: 90 }}>Avg unit size (sqm)</th>
              <th style={{ ...TH, minWidth: 80 }}>Parking ratio</th>
              <th style={{ ...TH, minWidth: 140 }}>Ratio basis</th>
              <th style={{ ...TH, minWidth: 90 }}>Utilisation %</th>
              <th style={{ ...TH, minWidth: 90 }}>Coverage %</th>
              <th style={{ ...TH, minWidth: 80 }}>FAR</th>
              <th style={{ ...TH, minWidth: 90 }}>Service %</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                {/* THE LIST HALF. It used to need a Save button, because it was
                    an account record behind a round trip. It is part of the
                    model now, so it writes through like everything else and the
                    button is gone. */}
                <td style={FIRM_CELL}>
                  <input style={TEXT_INPUT} value={e.label} data-testid={`std-row-${e.id}-label`}
                    placeholder="e.g. High End Apartments"
                    title="The name this project calls the type. Renaming keeps the id, so this project's values for it stay attached, and no other project sees the change."
                    onChange={(ev) => renameType(e.id, { label: ev.target.value })} />
                </td>
                <td style={FIRM_CELL}>
                  <input style={TEXT_INPUT} value={e.category ?? ''} list="asset-standard-categories"
                    data-testid={`std-row-${e.id}-category`}
                    placeholder="e.g. Residential"
                    onChange={(ev) => renameType(e.id, { category: ev.target.value })} />
                </td>
                <td style={{ ...FIRM_CELL, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ ...SMALL_BTN, padding: '2px 6px' }}
                    data-view-mutates="true"
                    disabled={i === 0} onClick={() => move(i, -1)}
                    data-testid={`std-row-${e.id}-up`} title="Move up. The order is this project's.">
                    ^
                  </button>{' '}
                  <button type="button" style={{ ...SMALL_BTN, padding: '2px 6px' }}
                    data-view-mutates="true"
                    disabled={i === entries.length - 1} onClick={() => move(i, 1)}
                    data-testid={`std-row-${e.id}-down`} title="Move down. The order is this project's.">
                    v
                  </button>{' '}
                  <button type="button"
                    style={{ ...SMALL_BTN, color: 'var(--color-negative)', borderColor: 'var(--color-negative)' }}
                    data-view-mutates="true"
                    onClick={() => removeType(e.id, e.label)}
                    data-testid={`std-row-${e.id}-delete`}
                    title="Removes the type from THIS project's list. Any values this project holds for it are kept and shown below; no other project is touched.">
                    Remove
                  </button>
                </td>
                {/* ── this project's values ── */}
                {valueCells(e.id, values[e.id])}
              </tr>
            ))}
            {/* The add row takes a NAME only: a type has to exist before this
                project can hold values for it. */}
            <tr style={{ background: 'var(--color-grey-pale)' }}>
              <td style={FIRM_CELL}>
                <input style={TEXT_INPUT} value={addDraft.label} data-testid="std-add-label"
                  placeholder="e.g. High End Apartments" onChange={(e) => setAddDraft((p) => ({ ...p, label: e.target.value }))} />
              </td>
              <td style={FIRM_CELL}>
                <input style={TEXT_INPUT} value={addDraft.category} list="asset-standard-categories"
                  data-testid="std-add-category"
                  placeholder="e.g. Residential" onChange={(e) => setAddDraft((p) => ({ ...p, category: e.target.value }))} />
              </td>
              <td style={{ ...FIRM_CELL, whiteSpace: 'nowrap' }}>
                <button type="button" className="btn-primary"
                  data-view-mutates="true"
                  disabled={!addDraft.label.trim() || !normaliseAssetTypeId(addDraft.label)}
                  style={{ padding: '4px 12px', fontSize: 'var(--font-small)' }}
                  onClick={() => addType()} data-testid="std-add-save">
                  Add
                </button>
              </td>
              <td style={{ ...TD_PROJECT_FIRST, color: 'var(--color-meta)', fontSize: 10 }} colSpan={7}>
                Add the type first; its values are entered on its own row.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* THE COST STANDARDS (2026-09-14, founder): two short lists in the
          reference model's shape. Defaults only: a rate typed on a Capex phase
          line wins, a phase rate here wins over the row's own, and a row scoped
          to asset types (the villa landscape rate) wins over a row for all. */}
      <div style={{ marginTop: 'var(--sp-3)' }} data-testid="asset-cost-standards">
        {/* ONE PROJECT ESCALATION RATE (2026-09-16, step 10b, founder). Every rate on
            this tab and in Capex is {baseYear} money; this is what carries it forward. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-navy)' }}>Construction cost escalation</span>
          <input
            type="number"
            step="0.1"
            value={project.costEscalationPct ?? ''}
            placeholder="0"
            data-testid="std-cost-escalation"
            onChange={(e) => setProject({ costEscalationPct: e.target.value === '' ? undefined : Number(e.target.value) })}
            style={{ ...FAST_INPUT, width: 90, textAlign: 'right' }}
            title={`Annual escalation on every cost RATE, applied from ${baseYear} to the years each line spends. A lump sum, the land value lines and anything charged on land or revenue do not escalate; a soft percentage charges on the escalated base.`}
          />
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>% a year, from {baseYear}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, lineHeight: 1.45 }}>
          Cost defaults for this project, in {baseYear} money. Each asset takes the default for its type where its Capex phase line has no rate of
          its own; a rate typed on the phase line in Capex wins. A phase rate here wins over the row&apos;s rate in that phase.
          Every rate below escalates at the project rate into the years its line spends, so a later phase costs more at the same rate.
          A row you add creates the matching line in Capex. A type&apos;s price per unit and per sqm (a sale price, an ADR or a rent,
          as the unit label under each says) are the price every Table 5 row of that type takes on the Assets tab until a price is typed there.
        </div>
        {([
          ['construction', 'Construction cost, sale price and ADR', constructionRows, 'std-construction-table'],
          ['soft', 'Soft costs', softRows.map((r) => ({ ...r, stored: true })), 'std-soft-table'],
        ] as const).map(([list, title, listRows, testId]) => (
          <div key={list} style={{ marginBottom: 'var(--sp-3)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-navy)', marginBottom: 4 }}>{title}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ fontSize: 11, borderCollapse: 'collapse', minWidth: 520 }} data-testid={testId}>
                <thead>
                  <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                    <th style={{ ...TH, minWidth: 200 }}>Item</th>
                    <th style={{ ...TH, minWidth: 170 }}>{list === 'construction' ? 'Applies to' : 'Basis'}</th>
                    <th style={{ ...TH, minWidth: 110 }} data-testid="std-rate-head">Rate ({baseYear} money)</th>
                    {phases.length > 1 && <th style={{ ...TH, minWidth: 90 }}>By phase</th>}
                    {list === 'construction' && PRICE_COLUMNS.map((c) => (
                      <th key={c.key} style={{ ...TH, minWidth: 100 }} data-testid={`std-price-head-${c.key}`}>{c.label}</th>
                    ))}
                    <th style={{ ...TH, minWidth: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {listRows.map((row) => {
                    const typeMissing = row.assetTypeId !== undefined && !entries.some((e) => e.id === row.assetTypeId);
                    const open = phaseOpen[row.id] === true;
                    return (
                      <React.Fragment key={row.id}>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', opacity: typeMissing ? 0.6 : 1 }} data-testid={`std-cost-row-${row.id}`}>
                          <td style={FIRM_CELL}>
                            {row.label}
                            {typeMissing && <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>No asset type of this name in the project</div>}
                          </td>
                          <td style={TD}>
                            {list === 'soft' && row.method === 'percent_of_selected' ? (
                              (() => {
                                const options = baseOptionsFor(row, storedRows, costLines);
                                const chosen = new Set(rowBaseIds(row, storedRows, costLines));
                                const toggleBase = (id: string): void => {
                                  const next = new Set(chosen);
                                  if (next.has(id)) next.delete(id); else next.add(id);
                                  writeRow(row, { baseIds: options.filter((o) => next.has(o.id)).map((o) => o.id), chargesOn: undefined });
                                };
                                return (
                                  <>
                                    <details data-testid={`std-cost-${row.id}-base`}
                                      title="The lines this percentage is charged on, chosen once for every phase: each phase charges its own lines of these kinds that sit above this one. A phase that genuinely differs can pick its own lines in Capex.">
                                      <summary style={{ cursor: 'pointer', color: 'var(--color-navy)' }} data-testid={`std-cost-${row.id}-base-summary`}>
                                        Select lines ({chosen.size} selected)
                                      </summary>
                                      {options.map((o) => (
                                        <label key={o.id} style={{ display: 'block', fontSize: 10 }}>
                                          <input type="checkbox" disabled={noProject} checked={chosen.has(o.id)}
                                            data-testid={`std-cost-${row.id}-base-${o.id}`}
                                            onChange={() => toggleBase(o.id)} /> {o.label}
                                        </label>
                                      ))}
                                    </details>
                                    <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }} data-testid={`std-cost-${row.id}-base-label`}>
                                      {rowBasisLabel(row, storedRows, costLines)}
                                    </div>
                                  </>
                                );
                              })()
                            ) : list === 'soft' || row.assetTypeId !== undefined ? (
                              <span style={{ color: 'var(--color-meta)' }}>
                                {row.assetTypeId !== undefined ? 'Assets of this type' : (row.method === 'percent_of_selected' ? rowBasisLabel(row, storedRows, costLines) : costStandardBasisLabel(row.method, currency, row.catalogId))}
                              </span>
                            ) : (
                              <details data-testid={`std-cost-${row.id}-types`}>
                                <summary style={{ cursor: 'pointer', color: 'var(--color-navy)' }}>
                                  {(row.appliesToTypeIds ?? []).length > 0
                                    ? (row.appliesToTypeIds ?? []).map((id) => entries.find((e) => e.id === id)?.label ?? id).join(', ')
                                    : 'All assets'}
                                </summary>
                                {entries.map((e) => (
                                  <label key={e.id} style={{ display: 'block', fontSize: 10 }}>
                                    <input type="checkbox" disabled={noProject}
                                      checked={(row.appliesToTypeIds ?? []).includes(e.id)}
                                      onChange={() => toggleType(row, e.id)} /> {e.label}
                                  </label>
                                ))}
                              </details>
                            )}
                          </td>
                          <td style={TD}>
                            <ValueCell value={row.rate} disabled={noProject} decimals={list === 'soft' ? 2 : undefined}
                              testId={`std-cost-${row.id}-rate`}
                              title={`${row.label}: ${(row.method === 'percent_of_selected' ? rowBasisLabel(row, storedRows, costLines) : costStandardBasisLabel(row.method, currency, row.catalogId))}. Blank applies nothing.`}
                              onCommit={(n) => writeRow(row, { rate: n })} />
                          </td>
                          {phases.length > 1 && (
                            <td style={TD}>
                              <button type="button" style={SMALL_BTN} data-testid={`std-cost-${row.id}-phases`}
                                onClick={() => setPhaseOpen((p) => ({ ...p, [row.id]: !open }))}>
                                {open ? 'Hide' : Object.keys(row.byPhase ?? {}).length > 0 ? `${Object.keys(row.byPhase ?? {}).length} set` : 'Set'}
                              </button>
                            </td>
                          )}
                          {list === 'construction' && PRICE_COLUMNS.map((c) => {
                            const typeId = row.assetTypeId;
                            if (typeId === undefined) return <td key={c.key} style={TD} />;
                            const tv = values[typeId];
                            const unitLabel = typePriceColumns(tv?.strategy)[c.column];
                            if (unitLabel === null) {
                              return (
                                <td key={c.key} style={{ ...TD, textAlign: 'center', color: 'var(--color-meta)' }}
                                  data-testid={`std-price-${typeId}-${c.key}-unused`}
                                  title={`A ${tv?.strategy} type does not use a ${c.column === 'unit' ? 'per unit' : 'per sqm'} price.`}>
                                  -
                                </td>
                              );
                            }
                            return (
                              <td key={c.key} style={TD}>
                                <ValueCell value={tv?.[c.key]} disabled={noProject || typeMissing}
                                  testId={`std-price-${typeId}-${c.key}`}
                                  title={`${row.label}: ${unitLabel}${currency ? ` (${currency})` : ''}. The default for every Table 5 row of this type on the Assets tab until a price is typed there. Blank prices nothing.`}
                                  onCommit={(n) => setAssetTypeValue(typeId, { [c.key]: n } as Partial<AssetTypeValues>)} />
                                <div style={{ fontSize: 9, color: 'var(--color-meta)', textAlign: 'right' }} data-testid={`std-price-${typeId}-${c.key}-unit`}>
                                  {unitLabel}
                                </div>
                              </td>
                            );
                          })}
                          <td style={TD}>
                            {row.custom && (
                              <button type="button" data-view-mutates="true"
                                style={{ ...SMALL_BTN, color: 'var(--color-negative)', borderColor: 'var(--color-negative)' }}
                                data-testid={`std-cost-${row.id}-remove`}
                                title="Removes the row. The Capex lines it created stay, with their own rates."
                                onClick={() => setCostStandardRows(storedRows.filter((r) => r.id !== row.id))}>
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                        {open && phases.map((ph) => (
                          <tr key={`${row.id}-${ph.id}`} style={{ background: 'var(--color-grey-pale)' }} data-testid={`std-cost-${row.id}-phase-${ph.id}`}>
                            <td style={{ ...TD, paddingLeft: 24, color: 'var(--color-meta)' }} colSpan={2}>{ph.name}</td>
                            <td style={TD}>
                              <ValueCell value={row.byPhase?.[ph.id]} disabled={noProject} decimals={list === 'soft' ? 2 : undefined}
                                testId={`std-cost-${row.id}-phase-${ph.id}-rate`}
                                title={`${row.label} in ${ph.name} only. Blank takes the row's rate.`}
                                onCommit={(n) => writePhaseRate(row, ph.id, n)} />
                            </td>
                            <td style={TD} colSpan={2 + (list === 'construction' ? PRICE_COLUMNS.length : 0)} />
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                  <tr style={{ background: 'var(--color-grey-pale)' }}>
                    <td style={FIRM_CELL}>
                      <input style={TEXT_INPUT} value={draft[list].label} disabled={noProject}
                        placeholder={list === 'construction' ? 'e.g. Facade' : 'e.g. Legal fees'}
                        data-testid={`std-cost-add-${list}-label`}
                        onChange={(e) => setDraft((p) => ({ ...p, [list]: { ...p[list], label: e.target.value } }))} />
                    </td>
                    <td style={TD}>
                      <select style={TEXT_INPUT} value={draft[list].method} disabled={noProject}
                        data-testid={`std-cost-add-${list}-method`}
                        onChange={(e) => setDraft((p) => ({ ...p, [list]: { ...p[list], method: e.target.value as CostMethod } }))}>
                        {(list === 'construction'
                          ? ['rate_x_main_asset_gfa', 'rate_x_parking_area', 'rate_x_landscape_area', 'rate_per_land', 'rate_x_retail_gfa', 'fixed']
                          : ['percent_of_selected', 'percent_of_cash_land', 'percent_of_revenue_sale']
                        ).map((m) => (<option key={m} value={m}>{costStandardBasisLabel(m, currency)}</option>))}
                      </select>
                    </td>
                    <td style={TD} colSpan={(phases.length > 1 ? 3 : 2) + (list === 'construction' ? PRICE_COLUMNS.length : 0)}>
                      <button type="button" className="btn-primary" data-view-mutates="true"
                        disabled={noProject || !draft[list].label.trim()}
                        style={{ padding: '4px 12px', fontSize: 11 }}
                        data-testid={`std-cost-add-${list}`}
                        onClick={() => addRow(list)}>
                        Add row
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {entries.length > 0 && (
        <div style={{ marginTop: 'var(--sp-3)' }} data-testid="asset-phase-phasing">
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-navy)', marginBottom: 4 }}>Construction phasing curve per phase</div>
          <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, lineHeight: 1.45 }}>
            One curve per phase, which every capex line of every asset in the phase follows by default. The Capex tab shows the same
            curve, and a line can still take its own phasing there.
          </div>
          {phases.map((ph) => {
            const phaseAssets = assets.filter((x) => x.phaseId === ph.id && x.visible !== false);
            if (phaseAssets.length === 0) return null;
            return (
              <div key={ph.id} data-testid={`std-phasing-${ph.id}`} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>
                  {ph.name}: {ph.constructionPeriods ?? 1} construction periods, {phaseAssets.length} {phaseAssets.length === 1 ? 'asset' : 'assets'}
                </div>
                <AssetPhasingControl
                  asset={phaseAssets[0]}
                  constructionPeriods={ph.constructionPeriods ?? 1}
                  scale={'full' as never}
                  onChange={(capexPhasing) => phaseAssets.forEach((x) => updateAsset(x.id, { capexPhasing }))}
                />
              </div>
            );
          })}
        </div>
      )}

      {entries.length === 0 && (
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 'var(--sp-1)' }} data-testid="asset-standards-empty">
          No asset types yet. Seed from the firm&apos;s template or the standard list above, or type
          your own in the add row.
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
