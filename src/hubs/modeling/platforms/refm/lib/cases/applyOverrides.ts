/**
 * Case merge engine (2026-06-03).
 *
 * A scenario case stores a flat map of field OVERRIDES keyed by the SAME path
 * scheme `diffSnapshots` emits (e.g. "project.financing.fundingMethod",
 * "assets[id=hotel1].revenue.sell.pricePerUnit", "costLines[id=L1].value",
 * "costOverrides[a::l].value", "landAllocationMode"). `applyOverrides` is the
 * inverse of `diffSnapshots`: it deep-clones the base model snapshot and sets
 * every override path onto the clone, producing the case's EFFECTIVE model that
 * the pure compute pipeline (computeFinancialsSnapshot -> computeReturnsSnapshot)
 * then runs on.
 *
 * Value changes only: an override targets an EXISTING field on an existing
 * entity. If the path points at a missing array element (entity not in the base
 * roster) the override is silently skipped, never created. `buildOverrides`
 * derives the map from an edited snapshot by reusing `diffSnapshots`, so the
 * path grammar stays in exactly one place.
 */
import type { HydrateSnapshot } from '../state/module1-store';
import type { ProjectCase } from '../state/module1-types';
import { diffSnapshots, PER_ELEMENT_ARRAYS } from '../persistence/snapshot-diff';
import { activePriceKey } from '../state/subUnitPrices';

// Entity identity / reference fields a case must never override (doing so would
// break the very path the override is addressed by, or a cross-entity link).
const IDENTITY_FIELDS = new Set(['id', 'parcelId', 'assetId', 'lineId', 'subUnitId']);

// JSON deep clone: the model snapshot is always JSON-serialisable, and this
// matches the equality semantics used by snapshotsEqual / autosave.
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// Parse one path token into either a plain key or an array selector. Array
// selectors are "key[id=X]" (id-keyed arrays) or "key[a::l]" (compound-keyed
// costOverrides). Tokens never contain dots (entity ids use _ and digits).
const SELECTOR = /^([A-Za-z0-9_]+)\[(.+)\]$/;

type Indexable = Record<string, unknown>;

function findElement(arr: unknown[], selector: string): Indexable | undefined {
  // Compound costOverrides key "assetId::lineId".
  if (selector.includes('::')) {
    const [assetId, lineId] = selector.split('::');
    return arr.find((e) => {
      const r = e as Indexable | null;
      return String(r?.['assetId'] ?? '') === assetId && String(r?.['lineId'] ?? '') === lineId;
    }) as Indexable | undefined;
  }
  // Generic "field=value" selector: id=..., parcelId=..., subUnitId=..., etc.
  const eq = selector.indexOf('=');
  if (eq > 0) {
    const field = selector.slice(0, eq);
    const val = selector.slice(eq + 1);
    return arr.find((e) => String((e as Indexable | null)?.[field] ?? '') === val) as Indexable | undefined;
  }
  const idx = Number(selector);
  return Number.isInteger(idx) ? (arr[idx] as Indexable | undefined) : undefined;
}

/** Set `value` at `path` inside `root`, walking nested objects + id-keyed
 *  arrays. No-op when an intermediate array element does not exist (value-only:
 *  never create a new entity). */
function setByPath(root: Indexable, path: string, value: unknown): void {
  const tokens = path.split('.');
  let cur: Indexable = root;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const last = i === tokens.length - 1;
    const sel = SELECTOR.exec(tok);
    if (sel) {
      const arr = cur[sel[1]];
      if (!Array.isArray(arr)) return;
      const el = findElement(arr, sel[2]);
      if (!el) return; // entity not in the base roster: skip (value-only)
      if (last) { Object.assign(el, clone(value)); return; }
      cur = el;
    } else {
      if (last) { cur[tok] = clone(value); return; }
      const next = cur[tok];
      if (next == null || typeof next !== 'object') cur[tok] = {};
      cur = cur[tok] as Indexable;
    }
  }
}

/** Read the value at `path` from a snapshot (mirror of setByPath). Returns
 *  undefined when the path or an intermediate entity is missing. Used by the
 *  Case Manager to show the base value next to the override. */
export function getByPath(root: HydrateSnapshot, path: string): unknown {
  const tokens = path.split('.');
  let cur: unknown = root;
  for (const tok of tokens) {
    if (cur == null || typeof cur !== 'object') return undefined;
    const sel = SELECTOR.exec(tok);
    if (sel) {
      const arr = (cur as Indexable)[sel[1]];
      if (!Array.isArray(arr)) return undefined;
      cur = findElement(arr, sel[2]);
    } else {
      cur = (cur as Indexable)[tok];
    }
  }
  return cur;
}

/** Deep-clone `base` and apply every override path. Returns the case's
 *  effective model snapshot. */
export function applyOverrides(base: HydrateSnapshot, overrides: Record<string, unknown> | undefined): HydrateSnapshot {
  const out = clone(base);
  if (!overrides) return out;
  for (const [path, value] of Object.entries(overrides)) {
    setByPath(out as unknown as Indexable, path, value);
  }
  /**
   * A PRICE OVERRIDE STATES THE PRICE ITS BASIS READS (2026-09-15). A row keeps
   * two stated prices and `unitPrice` is only whichever the basis makes active,
   * so the load and save settle puts `unitPrice` back to the stated price. An
   * override on `unitPrice` alone (the Module 6 lever) is therefore written to
   * the active basis too, unless the case names that price itself, the same
   * rule the settle applies to a row with no stated price. AND A PRICE A CASE
   * STATES IS A STATED PRICE: a row priced from its type carries
   * `priceStated: false`, which the settle re-prices from the type, so every
   * price override marks the row stated unless the case names the marker.
   */
  const head = 'subUnits[id=';
  for (const path of Object.keys(overrides)) {
    if (!path.startsWith(head)) continue;
    const field = ['unitPrice', 'pricePerSqm', 'pricePerUnit'].find((f) => path.endsWith(`].${f}`));
    if (!field) continue;
    const id = path.slice(head.length, -(field.length + 2));
    const u = (out.subUnits ?? []).find((x) => x.id === id);
    if (!u) continue;
    const row = u as unknown as Record<string, unknown>;
    if (!(`${head}${id}].priceStated` in overrides)) row.priceStated = true;
    if (field !== 'unitPrice') continue;
    const key = activePriceKey(u, (out.assets ?? []).find((a) => a.id === u.assetId));
    if (`${head}${id}].${key}` in overrides) continue;
    const value = overrides[path];
    if (typeof value === 'number') row[key] = value;
  }
  /**
   * AND A WINDOW A CASE STATES IS A STATED WINDOW (2026-09-15, step 8). A line
   * carrying `windowFollowsConstruction` has its start and end re-derived from
   * the phase by the settle, so a scenario's window override was overwritten the
   * moment the case model was settled (22 window levers on the pipeline fixture
   * went dead when every case model began to settle, and on reopening a project
   * with that scenario active they already had). The override therefore marks the
   * line's window as the user's, unless the case names the flag itself.
   */
  for (const path of Object.keys(overrides)) {
    if (!path.startsWith('costLines[id=') || !(path.endsWith('].startPeriod') || path.endsWith('].endPeriod'))) continue;
    const id = path.slice('costLines[id='.length, path.lastIndexOf(']'));
    if (`costLines[id=${id}].windowFollowsConstruction` in overrides) continue;
    const line = (out.costLines ?? []).find((l) => l.id === id) as unknown as Record<string, unknown> | undefined;
    if (line && line.windowFollowsConstruction === true) line.windowFollowsConstruction = false;
  }
  return out;
}

/** Derive the override map for a scenario case from its edited snapshot vs the
 *  base, reusing diffSnapshots so the path grammar lives in one place. Adds /
 *  updates store the new value; removes store undefined. */
export function buildOverrides(base: HydrateSnapshot, edited: HydrateSnapshot): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of diffSnapshots(base, edited)) {
    if (entry.path === '<root>') continue; // not a field path
    out[entry.path] = entry.after;
  }
  return out;
}

// ── Overridable-field enumeration (for the explicit override editor) ─────────
// Mirrors the diffSnapshots traversal EXACTLY so the field picker only ever
// offers paths that round-trip: recurse plain objects to their scalar leaves,
// match id-keyed arrays + compound costOverrides by their selector, and treat
// any array value as a single (whole-array) leaf. Only scalar leaves
// (number / string / boolean) are returned, because those are the ones the
// picker can set from a single input cell; `id` is excluded so a case can never
// rewrite the key its own override path is built on.

export interface OverridableField {
  /** diffSnapshots-grammar path, e.g. "subUnits[id=u1].unitPrice". */
  path: string;
  /** Entity group, e.g. "Project", "Asset: Hotel", "Sub-unit: Apartments". */
  group: string;
  /** The leaf field within the entity, e.g. "revenue.sell.indexation.rate". */
  field: string;
  /** Current (base or active-case) value of the field. */
  value: number | string | boolean;
  type: 'number' | 'string' | 'boolean';
}

function collectScalarLeaves(basePath: string, fieldBase: string, obj: Indexable, group: string, out: OverridableField[]): void {
  for (const [k, v] of Object.entries(obj)) {
    if (IDENTITY_FIELDS.has(k)) continue; // never let a case rewrite an id / reference
    const path = `${basePath}.${k}`;
    const field = fieldBase ? `${fieldBase}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      // Per-element arrays (e.g. parcelFunding by parcelId) expose each element's
      // scalar fields as discrete paths; other arrays round-trip only as a whole
      // value, so they are not pickable.
      const keyField = PER_ELEMENT_ARRAYS[k];
      if (keyField) {
        for (const el of v as unknown[]) {
          if (!el || typeof el !== 'object') continue;
          const keyVal = (el as Indexable)[keyField];
          if (keyVal == null) continue;
          const sel = `${k}[${keyField}=${String(keyVal)}]`;
          collectScalarLeaves(`${basePath}.${sel}`, fieldBase ? `${fieldBase}.${sel}` : sel, el as Indexable, group, out);
        }
      }
      continue;
    }
    if (typeof v === 'object') { collectScalarLeaves(path, field, v as Indexable, group, out); continue; }
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') {
      out.push({ path, group, field, value: v as number | string | boolean, type: t });
    }
  }
}

function entityLabel(rec: Indexable, fallback: string): string {
  const name = rec['name'];
  if (typeof name === 'string' && name.trim()) return name;
  const id = rec['id'];
  return typeof id === 'string' ? id : fallback;
}

/** Every scalar field on the model that can be overridden per case (i.e. that
 *  round-trips through the diffSnapshots grammar). The picker reads this so it
 *  can never offer a field that would silently fail to apply. */
export function enumerateOverridableFields(model: HydrateSnapshot): OverridableField[] {
  const m = model as unknown as Indexable;
  const out: OverridableField[] = [];
  if (m.project && typeof m.project === 'object') collectScalarLeaves('project', '', m.project as Indexable, 'Project', out);
  const lam = m.landAllocationMode;
  const lt = typeof lam;
  if (lt === 'string' || lt === 'number' || lt === 'boolean') {
    out.push({ path: 'landAllocationMode', group: 'Project', field: 'landAllocationMode', value: lam as string | number | boolean, type: lt });
  }
  const idArrays: Array<[string, string]> = [
    ['phases', 'Phase'], ['parcels', 'Parcel'], ['assets', 'Asset'], ['subUnits', 'Sub-unit'],
    ['costLines', 'Cost line'], ['financingTranches', 'Facility'], ['equityContributions', 'Equity'],
  ];
  for (const [key, kind] of idArrays) {
    const arr = m[key];
    if (!Array.isArray(arr)) continue;
    for (const rec of arr as Indexable[]) {
      const id = rec['id'];
      if (typeof id !== 'string') continue;
      collectScalarLeaves(`${key}[id=${id}]`, '', rec, `${kind}: ${entityLabel(rec, id)}`, out);
    }
  }
  // THE SCENARIO LEVERS (2026-09-15, step 8): sales pace and occupancy are one
  // number on the asset's revenue block, absent on the base, so each is offered
  // at its neutral value (a pace factor of 1, a shift of 0 points) until set.
  // Only on an asset that owns a revenue row: one with none sells and lets
  // nothing, so a lever on it would move nothing (a live Sell asset whose stored
  // pace row points at another asset's sub-unit is exactly that).
  const assetsArr = m['assets'];
  const ownsRevenueRow = new Set(((m['subUnits'] ?? []) as Indexable[])
    .filter((u) => u && u['category'] !== 'Support')
    .map((u) => String(u['assetId'] ?? '')));
  if (Array.isArray(assetsArr)) {
    for (const rec of assetsArr as Indexable[]) {
      const id = rec['id'];
      const rev = rec['revenue'] as Indexable | undefined;
      if (typeof id !== 'string' || !rev || typeof rev !== 'object' || rec['visible'] === false || !ownsRevenueRow.has(id)) continue;
      const group = `Asset: ${entityLabel(rec, id)}`;
      const offer = (blk: string, leaf: string, neutral: number): void => {
        const b = rev[blk] as Indexable | undefined;
        if (!b || typeof b !== 'object' || b[leaf] !== undefined) return;
        out.push({ path: `assets[id=${id}].revenue.${blk}.${leaf}`, group, field: `revenue.${blk}.${leaf}`, value: neutral, type: 'number' });
      };
      if (rec['strategy'] === 'Sell' || rec['strategy'] === 'Sell + Manage') offer('sell', 'paceFactor', 1);
      if (rec['strategy'] === 'Operate') offer('operate', 'occupancyShiftPts', 0);
      if (rec['strategy'] === 'Lease') offer('lease', 'occupancyShiftPts', 0);
    }
  }
  const cos = m['costOverrides'];
  if (Array.isArray(cos)) {
    for (const rec of cos as Indexable[]) {
      const k = `${String(rec['assetId'] ?? '')}::${String(rec['lineId'] ?? '')}`;
      collectScalarLeaves(`costOverrides[${k}]`, '', rec, `Cost override: ${k}`, out);
    }
  }
  return out;
}

// ── Seeding + helpers ───────────────────────────────────────────────────────

/** The default case set: Management (base) + Downside + Upside (scenarios). */
export function seedCases(): ProjectCase[] {
  return [
    { id: 'case_management', name: 'Management Case', role: 'base', overrides: {} },
    { id: 'case_downside', name: 'Downside', role: 'scenario', overrides: {} },
    { id: 'case_upside', name: 'Upside', role: 'scenario', overrides: {} },
  ];
}

/** The base ("Management") case id, falling back to the first case. */
export function baseCaseId(cases: ProjectCase[]): string {
  return (cases.find((c) => c.role === 'base') ?? cases[0])?.id ?? 'case_management';
}

/** Normalise a cases array: guarantee exactly one base case and non-empty list.
 *  Used on hydrate so legacy snapshots (no cases) auto-seed and malformed
 *  arrays self-heal. */
export function normaliseCases(cases: ProjectCase[] | undefined): ProjectCase[] {
  if (!cases || cases.length === 0) return seedCases();
  const bases = cases.filter((c) => c.role === 'base');
  if (bases.length === 1) return cases;
  if (bases.length === 0) {
    // Promote the first case to base.
    return cases.map((c, i) => (i === 0 ? { ...c, role: 'base' as const, overrides: {} } : c));
  }
  // More than one base: keep the first, demote the rest to scenarios.
  let seen = false;
  return cases.map((c) => {
    if (c.role !== 'base') return c;
    if (!seen) { seen = true; return c; }
    return { ...c, role: 'scenario' as const };
  });
}
