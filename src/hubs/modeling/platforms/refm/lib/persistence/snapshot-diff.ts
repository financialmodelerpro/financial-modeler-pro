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

export interface ChangeLogEntry {
  path: string;             // e.g. "project.name", "phases[id=phase_1].startDate"
  label?: string;           // human-friendly fallback for renderers, optional
  before: unknown;
  after: unknown;
  /**
   * Discriminator so the UI can render adds + removes differently
   * from updates if it wants to. 'update' is the default.
   */
  kind: 'add' | 'remove' | 'update';
}

// Compare anything sensibly: scalars by ===, objects by JSON
// equality. We avoid lodash to keep this lib zero-dep + small.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Get a stable display label for an array element keyed by id. Phases
// + assets + sub-units etc. all carry a human-readable `name`; if
// present that becomes the label, otherwise we fall back to the id.
function elementLabel(rec: Record<string, unknown>): string {
  const name = rec['name'];
  if (typeof name === 'string' && name.trim()) return name;
  const id = rec['id'];
  if (typeof id === 'string') return id;
  return '?';
}

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

    // Arrays + scalars are reported as one entry. We do NOT walk into
    // arrays of scalars (e.g. preSalesVelocity number[]) per-element;
    // the user is interested in "this field changed" not "index 4
    // went from 10 to 12 AND index 5 went from 8 to 7".
    out.push({
      path: `${basePath}.${k}`,
      before: beforeVal,
      after:  afterVal,
      kind:   beforeVal === undefined ? 'add' : afterVal === undefined ? 'remove' : 'update',
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
): void {
  const byIdBefore = new Map<string, Record<string, unknown>>();
  for (const rec of before) {
    const id = rec['id'];
    if (typeof id === 'string') byIdBefore.set(id, rec);
  }
  const byIdAfter = new Map<string, Record<string, unknown>>();
  for (const rec of after) {
    const id = rec['id'];
    if (typeof id === 'string') byIdAfter.set(id, rec);
  }

  // Adds + updates: walk `after`, look up corresponding `before`.
  for (const [id, afterRec] of byIdAfter) {
    const beforeRec = byIdBefore.get(id);
    const childPath = `${basePath}[id=${id}]`;
    if (!beforeRec) {
      out.push({
        path:  childPath,
        label: `Added ${elementLabel(afterRec)}`,
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
      path:  `${basePath}[id=${id}]`,
      label: `Removed ${elementLabel(beforeRec)}`,
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
        label: `Added cost override (${k})`,
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
      label: `Removed cost override (${k})`,
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
      label: 'Initial version',
      before: null,
      after:  null,
      kind:   'add',
    });
    return out;
  }
  if (before && !after) {
    out.push({
      path:  '<root>',
      label: 'Empty snapshot',
      before: null,
      after:  null,
      kind:   'remove',
    });
    return out;
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

  return out;
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
