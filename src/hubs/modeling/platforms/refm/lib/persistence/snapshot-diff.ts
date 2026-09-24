/**
 * REFM snapshot diff (Phase M-Versioning, 2026-05-31).
 *
 * Computes a flat list of `ChangeLogEntry` records describing every
 * field that differs between two HydrateSnapshots. The output is
 * stored on `refm_project_versions.change_log` so the version-history
 * UI can render "what changed in this version" without having to
 * re-fetch both snapshots and diff them client-side every time.
 *
 * Design notes:
 *
 *   * Top-level keys: project (single object) + a fixed set of
 *     id-keyed arrays (phases / parcels / assets / subUnits /
 *     costLines / financingTranches / equityContributions) +
 *     costOverrides (compound key: assetId+lineId) +
 *     landAllocationMode (scalar) + migrationsApplied (string[]).
 *
 *   * Arrays of records are matched by `id` so an Add / Update /
 *     Remove emits a single entry rather than dozens of index-shift
 *     mismatches. Order changes within an id-stable array are NOT
 *     reported (the user never sees order changes in the UI).
 *
 *   * Compound-key arrays (costOverrides) are matched by the tuple
 *     of identifying fields.
 *
 *   * Scalar / object leaves are compared via deep equality. When two
 *     leaves differ, the entry's `before` and `after` carry the raw
 *     values for the UI to render. `label` is an optional
 *     human-friendly description; the renderer falls back to the
 *     path if absent.
 *
 *   * The diff is intentionally cheap to compute (O(total fields))
 *     and stable: the same two snapshots always produce the same
 *     change_log. No timestamps, no random ids in the output.
 */

import type { HydrateSnapshot } from '../state/module1-store';
import { labelForChange, namingContext } from './changeLabel';

export interface ChangeLogEntry {
  path: string;             // e.g. "project.name", "phases[id=phase_1].startDate"
  label?: string;           // human-friendly fallback for renderers, optional
  before: unknown;
  after: unknown;
  /**
   * Discriminator so the UI can render adds + removes differently
   * from updates if it wants to. 'update' is the default.
   *
   * 'clear' IS NOT 'remove' (2026-09-22). 'remove' means an ELEMENT is gone:
   * a phase, a parcel, a cost override. 'clear' means a record that still
   * exists lost a VALUE. The two looked identical because this platform stores
   * a blank as an ABSENT KEY ("never null and never 0", the asset type values
   * rule), so emptying a field deletes its key and the differ read that as a
   * deletion. The log then told a reader something had been REMOVED when a
   * number had been cleared, which is a different and more alarming claim.
   */
  kind: 'add' | 'remove' | 'update' | 'clear';
}

// Compare anything sensibly: scalars by ===, objects by JSON
// equality. We avoid lodash to keep this lib zero-dep + small.
/**
 * Stable stringify: object keys in sorted order, arrays left in their own
 * order (an array's order IS its meaning).
 *
 * WHY THIS EXISTS (2026-09-23). `deepEqual` compared `JSON.stringify(a)` with
 * `JSON.stringify(b)`, which follows INSERTION order, so two objects holding
 * the same values with their keys written in a different order compared as
 * DIFFERENT. Postgres `jsonb` then normalises key order on storage, so the row
 * read back had a `before` and an `after` that were byte-identical: a log entry
 * that existed because something changed, saying nothing had.
 *
 * Measured on the live project: 49 rows of exactly that, mostly
 * `project.fundTerms.feeDistribution`. The display fix in item 2 made them
 * legible ("15 items, unchanged") but they should never have been written, and
 * the founder was right that the row is the defect, not the chip.
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return false;
  }
}

/**
 * Nested record arrays that should be diffed PER ELEMENT (so a single element's
 * field round-trips as its own path) instead of as one whole-array leaf. Keyed
 * by the array property name -> the element's identifying field. Mirrored by
 * applyOverrides (findElement resolves "field=value" selectors generically, and
 * enumerateOverridableFields recurses these same arrays), so the override
 * grammar stays value-only and round-trippable. Top-level id-keyed arrays
 * (phases / assets / subUnits / ...) are handled by diffIdArray directly and are
 * NOT listed here.
 */
export const PER_ELEMENT_ARRAYS: Record<string, string> = {
  // Per-parcel land funding split: parcelFunding[parcelId=P].debtPct / equityPct.
  parcelFunding: 'parcelId',
  // The project's asset type list (2026-09-10). Without this the change log
  // says only "assetTypes changed" when somebody renames one type of nine,
  // which is the whole value of moving the list into the snapshot lost at the
  // last step.
  assetTypes: 'id',
  // The cost standards lists (2026-09-14): "Villas Landscape rate changed", not "rows changed".
  costStandardRows: 'id',
};

/**
 * Diff a single object's leaves and recurse into nested objects.
 * `path` is the parent path (e.g. "project" or "phases[id=phase_1]").
 * Arrays of records keyed by id are handled by `diffIdArray` instead.
 */
function diffObject(
  basePath: string,
  before: Record<string, unknown> | null | undefined,
  after:  Record<string, unknown> | null | undefined,
  out: ChangeLogEntry[],
): void {
  const b = before ?? {};
  const a = after  ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    const beforeVal = b[k];
    const afterVal  = a[k];
    if (deepEqual(beforeVal, afterVal)) continue;

    // Nested plain objects: recurse so the leaf path is precise.
    const beforeIsObj = beforeVal && typeof beforeVal === 'object' && !Array.isArray(beforeVal);
    const afterIsObj  = afterVal  && typeof afterVal  === 'object' && !Array.isArray(afterVal);
    if (beforeIsObj && afterIsObj) {
      diffObject(`${basePath}.${k}`, beforeVal as Record<string, unknown>, afterVal as Record<string, unknown>, out);
      continue;
    }

    // Selected record arrays diff per element (e.g. parcelFunding by parcelId)
    // so a single element's field round-trips as its own path.
    const keyField = PER_ELEMENT_ARRAYS[k];
    if (keyField && Array.isArray(beforeVal) && Array.isArray(afterVal)) {
      diffIdArray(`${basePath}.${k}`, beforeVal as Record<string, unknown>[], afterVal as Record<string, unknown>[], out, keyField);
      continue;
    }

    // Arrays + scalars are reported as one entry. We do NOT walk into
    // arrays of scalars (e.g. preSalesVelocity number[]) per-element;
    // the user is interested in "this field changed" not "index 4
    // went from 10 to 12 AND index 5 went from 8 to 7".
    out.push({
      path: `${basePath}.${k}`,
      before: beforeVal,
      after:  afterVal,
      // The RECORD still exists here (diffObject is walking its fields), so a
      // key going absent is a value CLEARED, never an element removed. Element
      // removal is emitted by diffIdArray, which keeps 'remove'.
      kind:   beforeVal === undefined ? 'add' : afterVal === undefined ? 'clear' : 'update',
    });
  }
}

/**
 * Diff two arrays of records keyed by `id`. Adds / removes emit one
 * entry per element; updates recurse into the element via
 * `diffObject`. Order changes within stable ids are ignored.
 */
function diffIdArray(
  basePath: string,
  before: ReadonlyArray<Record<string, unknown>>,
  after:  ReadonlyArray<Record<string, unknown>>,
  out: ChangeLogEntry[],
  keyField = 'id',
): void {
  // keyVal is coerced to a string so non-string ids (none today) still key.
  const keyOf = (rec: Record<string, unknown>): string | undefined => {
    const v = rec[keyField];
    return typeof v === 'string' ? v : v == null ? undefined : String(v);
  };
  const byIdBefore = new Map<string, Record<string, unknown>>();
  for (const rec of before) { const id = keyOf(rec); if (id !== undefined) byIdBefore.set(id, rec); }
  const byIdAfter = new Map<string, Record<string, unknown>>();
  for (const rec of after) { const id = keyOf(rec); if (id !== undefined) byIdAfter.set(id, rec); }

  // Adds + updates: walk `after`, look up corresponding `before`.
  for (const [id, afterRec] of byIdAfter) {
    const beforeRec = byIdBefore.get(id);
    const childPath = `${basePath}[${keyField}=${id}]`;
    if (!beforeRec) {
      out.push({
        path:  childPath,
        before: undefined,
        after:  afterRec,
        kind:   'add',
      });
      continue;
    }
    diffObject(childPath, beforeRec, afterRec, out);
  }

  // Removes: walk `before`, anything not in `after` is gone.
  for (const [id, beforeRec] of byIdBefore) {
    if (byIdAfter.has(id)) continue;
    out.push({
      path:  `${basePath}[${keyField}=${id}]`,
      before: beforeRec,
      after:  undefined,
      kind:   'remove',
    });
  }
}

/**
 * Diff costOverrides, which are keyed by (assetId, lineId) rather
 * than `id`. Same shape as diffIdArray but compound key.
 */
function diffCostOverrides(
  before: ReadonlyArray<Record<string, unknown>>,
  after:  ReadonlyArray<Record<string, unknown>>,
  out: ChangeLogEntry[],
): void {
  const key = (rec: Record<string, unknown>): string =>
    `${String(rec['assetId'] ?? '')}::${String(rec['lineId'] ?? '')}`;

  const byKeyBefore = new Map<string, Record<string, unknown>>();
  for (const rec of before) byKeyBefore.set(key(rec), rec);
  const byKeyAfter = new Map<string, Record<string, unknown>>();
  for (const rec of after)  byKeyAfter.set(key(rec), rec);

  for (const [k, afterRec] of byKeyAfter) {
    const beforeRec = byKeyBefore.get(k);
    const childPath = `costOverrides[${k}]`;
    if (!beforeRec) {
      out.push({
        path:  childPath,
        before: undefined,
        after:  afterRec,
        kind:   'add',
      });
      continue;
    }
    diffObject(childPath, beforeRec, afterRec, out);
  }
  for (const [k, beforeRec] of byKeyBefore) {
    if (byKeyAfter.has(k)) continue;
    out.push({
      path:  `costOverrides[${k}]`,
      before: beforeRec,
      after:  undefined,
      kind:   'remove',
    });
  }
}

/**
 * Top-level entry point. Returns [] when the two snapshots are equal
 * (or both null). Tolerates either side being null / undefined for
 * the "first ever version, no base" case.
 */
/**
 * Cases follow-up C (2026-06-04): diff the scenario `cases` registry so
 * scenario-only edits (which never touch the base model fields) still produce a
 * change_log. Each case is matched by id; we report case add / remove / rename
 * and every per-case override path add / remove / update. The Management (base)
 * case carries no overrides, so it never contributes here.
 */
type CaseRec = { id?: unknown; name?: unknown; role?: unknown; overrides?: Record<string, unknown> };
function diffCases(
  before: CaseRec[] | null | undefined,
  after:  CaseRec[] | null | undefined,
  out: ChangeLogEntry[],
): void {
  const beforeCases = before ?? [];
  const afterCases  = after ?? [];
  const idOf = (c: CaseRec): string => (typeof c.id === 'string' ? c.id : '');
  const nameOf = (c: CaseRec): string => (typeof c.name === 'string' && c.name.trim() ? c.name : idOf(c) || 'case');
  const isBase = (c: CaseRec): boolean => c.role === 'base';
  const bMap = new Map(beforeCases.map((c) => [idOf(c), c]));
  const aMap = new Map(afterCases.map((c) => [idOf(c), c]));

  for (const c of afterCases) {
    if (isBase(c) || bMap.has(idOf(c))) continue;
    out.push({ path: `cases[${idOf(c)}]`, before: null, after: nameOf(c), kind: 'add' });
  }
  for (const c of beforeCases) {
    if (isBase(c) || aMap.has(idOf(c))) continue;
    out.push({ path: `cases[${idOf(c)}]`, before: nameOf(c), after: null, kind: 'remove' });
  }
  for (const a of afterCases) {
    const b = bMap.get(idOf(a));
    if (!b) continue;
    if (nameOf(b) !== nameOf(a)) {
      out.push({ path: `cases[${idOf(a)}].name`, before: nameOf(b), after: nameOf(a), kind: 'update' });
    }
    const bo = b.overrides ?? {};
    const ao = a.overrides ?? {};
    for (const k of new Set([...Object.keys(bo), ...Object.keys(ao)])) {
      const bv = bo[k];
      const av = ao[k];
      if (deepEqual(bv, av)) continue;
      // Same rule for a case override: the CASE still exists, so dropping one
      // of its overrides clears that value rather than removing anything.
      const kind: ChangeLogEntry['kind'] = bv === undefined ? 'add' : av === undefined ? 'clear' : 'update';
      out.push({ path: `cases[${idOf(a)}].${k}`, before: bv ?? null, after: av ?? null, kind });
    }
  }
}

export function diffSnapshots(
  before: HydrateSnapshot | null | undefined,
  after:  HydrateSnapshot | null | undefined,
): ChangeLogEntry[] {
  const out: ChangeLogEntry[] = [];

  // First-version case: every field is an "add" from null. We render
  // this as a single root entry rather than expanding every nested
  // field, because for a brand-new project the user already saw the
  // wizard inputs and a 200-line diff would be noise.
  if (!before && after) {
    out.push({
      path:  '<root>',
      before: null,
      after:  null,
      kind:   'add',
    });
    return labelled(out, null, after);
  }
  if (before && !after) {
    out.push({
      path:  '<root>',
      before: null,
      after:  null,
      kind:   'remove',
    });
    return labelled(out, before, null);
  }
  if (!before || !after) return out;

  // project (single object) + landAllocationMode (scalar)
  diffObject('project', before.project as unknown as Record<string, unknown>, after.project as unknown as Record<string, unknown>, out);
  if (!deepEqual(before.landAllocationMode, after.landAllocationMode)) {
    out.push({
      path: 'landAllocationMode',
      before: before.landAllocationMode,
      after:  after.landAllocationMode,
      kind:   'update',
    });
  }
  // migrationsApplied is a meta field, not a user-edit. Skip it.

  // id-keyed arrays
  diffIdArray('phases',              before.phases              as unknown as Record<string, unknown>[], after.phases              as unknown as Record<string, unknown>[], out);
  diffIdArray('parcels',             before.parcels             as unknown as Record<string, unknown>[], after.parcels             as unknown as Record<string, unknown>[], out);
  diffIdArray('assets',              before.assets              as unknown as Record<string, unknown>[], after.assets              as unknown as Record<string, unknown>[], out);
  diffIdArray('subUnits',            before.subUnits            as unknown as Record<string, unknown>[], after.subUnits            as unknown as Record<string, unknown>[], out);
  diffIdArray('costLines',           before.costLines           as unknown as Record<string, unknown>[], after.costLines           as unknown as Record<string, unknown>[], out);
  diffIdArray('financingTranches',   before.financingTranches   as unknown as Record<string, unknown>[], after.financingTranches   as unknown as Record<string, unknown>[], out);
  diffIdArray('equityContributions', before.equityContributions as unknown as Record<string, unknown>[], after.equityContributions as unknown as Record<string, unknown>[], out);

  // compound-keyed costOverrides
  diffCostOverrides(
    before.costOverrides as unknown as Record<string, unknown>[],
    after.costOverrides  as unknown as Record<string, unknown>[],
    out,
  );

  // scenario cases registry (per-case override add/remove/update + rename)
  diffCases(before.cases as CaseRec[] | undefined, after.cases as CaseRec[] | undefined, out);

  return labelled(out, before, after);
}

/**
 * EVERY ENTRY IS LABELLED BY ONE RULE, IN ONE PASS (2026-09-24).
 *
 * The sentence used to be built inline at each push site, so the rule lived
 * only here and a log row written before the rule existed could never be read
 * with it. It is now `labelForChange` (changeLabel.ts), a function of the
 * PATH and a naming context, which the Activity panel also calls for any
 * stored row that has no label. Built from BOTH snapshots, `after` first, so
 * an element present on both sides is named as it now reads, and an asset
 * removed in the same save as its plot still finds the plot.
 */
function labelled(
  out: ChangeLogEntry[],
  before: HydrateSnapshot | null | undefined,
  after: HydrateSnapshot | null | undefined,
): ChangeLogEntry[] {
  const ctx = namingContext(after, before);
  for (const e of out) e.label = labelForChange(e, ctx);
  return out;
}

/** Deep equality that ignores object key ORDER (and never array order). The
 *  same comparison the differ uses, exported so a reader of STORED rows can
 *  recognise one that records no change. */
export function sameValue(a: unknown, b: unknown): boolean {
  return deepEqual(a, b);
}

/**
 * Snapshot equality, mirrors the no-op detection runAutoSave uses.
 * Exposed so the sync module can decide whether to fire the
 * first-edit modal: a no-op store mutation (e.g. setActivePhaseId)
 * should NOT trigger it.
 */
export function snapshotsEqual(
  a: HydrateSnapshot | null | undefined,
  b: HydrateSnapshot | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
