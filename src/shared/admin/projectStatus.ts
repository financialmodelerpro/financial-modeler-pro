/**
 * projectStatus.ts
 *
 * THE project lifecycle status vocabulary, the card group order, and the card
 * comparator. ONE definition, shared by every platform: REFM today, ERM and
 * BVM when their project tables join `PROJECT_SOURCES`. A platform inherits
 * all of this by declaring its columns in the registry; it never restates the
 * order or re-implements the sort.
 *
 * Pure and client-safe: no supabase import, no IO, no React. The API route
 * owns the queries and the card owns the pixels; this file owns the RULE, so
 * the server, the client and the verifier cannot disagree about it.
 *
 * ── STATUS IS A LABEL, AND MUST STAY ONE ──────────────────────────────────
 *
 * Nothing branches on a status value. It gates no module, frees no project
 * slot, blocks no write, changes no export and enters no calculation. That is
 * deliberate, not an oversight to be tidied up later:
 *
 *   - ARCHIVING is the `archived` boolean (migration 161). It frees a slot
 *     under the project cap and makes the project view-only.
 *   - DELETION is `deleted_at` (migration 224). It hides the project and
 *     starts a 30-day retention clock.
 *
 * Migration 149's enum also carried an 'Archived' value, so one word meant
 * two things, and that duplication was removed on 2026-08-30. `Closed` and
 * `Dropped` are the obvious candidates to acquire behaviour ("surely a closed
 * project should free a slot?") and they MUST NOT: that would rebuild the
 * exact conflation, with a third and fourth word meaning the same thing.
 * If a project should free a slot, the user archives it.
 *
 * No em dashes in this file.
 */

/** The seven lifecycle statuses, in LIFECYCLE order (how a project moves). */
export const PROJECT_STATUSES = [
  'Draft',
  'Funded',
  'Construction',
  'Operation',
  'Completed',
  'Closed',
  'Dropped',
] as const;

export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'Draft';

/**
 * THE CARD GROUP ORDER, which is deliberately NOT the lifecycle order.
 *
 * Cards group by status, and priority sorts WITHIN a group rather than across
 * one. That is the whole reason this order differs from the lifecycle: if
 * Draft led, a user with twenty drafts and two live sites would see the
 * drafts first, and the urgent flag could not lift a live site past them,
 * because it never crosses a group boundary. So the groups run:
 *
 *   live work  ->  pipeline  ->  not started  ->  finished  ->  abandoned
 *
 * The trade is that the order is not self-evident, which is why the card grid
 * renders a visible heading per group rather than an unexplained sequence.
 */
export const STATUS_GROUP_ORDER: readonly ProjectStatus[] = [
  'Construction',
  'Operation',
  'Funded',
  'Draft',
  'Completed',
  'Closed',
  'Dropped',
];

/** Rank of a status in the card group order. An unknown or absent value sorts
 *  with Draft rather than to the end: a row written by an older client, or one
 *  whose status column has not been migrated, is a normal project and should
 *  not be exiled below the finished ones. */
export function statusRank(status: string | null | undefined): number {
  const i = STATUS_GROUP_ORDER.indexOf(status as ProjectStatus);
  return i >= 0 ? i : STATUS_GROUP_ORDER.indexOf(DEFAULT_PROJECT_STATUS);
}

/** Whether a value is one of the seven. Used to validate a write; an invalid
 *  status is rejected rather than coerced, so a typo in a client never
 *  silently becomes 'Draft' on the server. */
export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === 'string' && (PROJECT_STATUSES as readonly string[]).includes(v);
}

/** The minimum a card needs to be ordered. Deliberately structural rather
 *  than a platform's row type, so ERM and BVM satisfy it without importing
 *  anything REFM. */
export interface OrderableProjectCard {
  id: string;
  status?: string | null;
  priority?: boolean | null;
  /** Manual position within the status group. NULL / undefined = never
   *  dragged; those fall back to recency. */
  sortOrder?: number | null;
  /** ISO timestamp, the pre-existing ordering key and still the tie-break. */
  lastModified?: string | null;
}

/**
 * THE card comparator: status group, then priority within the group, then
 * manual order within the group, then recency.
 *
 * Recency is the LAST tie-break, not the first, and that is the point of the
 * whole change: ordering by last-modified alone meant any write reordered the
 * page, so restoring a deleted project moved it to the front.
 *
 * An un-dragged card (sortOrder null) sorts AFTER every dragged one in its
 * group. Treating null as 0 would silently place it at the top, which is the
 * absent-value-becomes-a-real-one trap, and it would also make the first drag
 * appear to do nothing.
 *
 * Total and stable: every branch is decided, and the final tie-break is the
 * id, so two cards with identical keys never swap between renders.
 */
export function compareProjectCards(a: OrderableProjectCard, b: OrderableProjectCard): number {
  const g = statusRank(a.status) - statusRank(b.status);
  if (g !== 0) return g;

  const pa = a.priority === true ? 0 : 1;
  const pb = b.priority === true ? 0 : 1;
  if (pa !== pb) return pa - pb;

  const sa = typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder) ? a.sortOrder : null;
  const sb = typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder) ? b.sortOrder : null;
  if (sa !== null && sb !== null && sa !== sb) return sa - sb;
  if (sa !== null && sb === null) return -1;
  if (sa === null && sb !== null) return 1;

  const ta = Date.parse(a.lastModified ?? '');
  const tb = Date.parse(b.lastModified ?? '');
  const va = Number.isNaN(ta) ? 0 : ta;
  const vb = Number.isNaN(tb) ? 0 : tb;
  if (va !== vb) return vb - va; // most recent first

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Cards grouped for rendering, in group order, each group internally sorted.
 *  Groups with no cards are omitted, so an empty status never renders a
 *  heading over nothing. */
export function groupProjectCards<T extends OrderableProjectCard>(
  cards: readonly T[],
): Array<{ status: ProjectStatus; cards: T[] }> {
  const buckets = new Map<ProjectStatus, T[]>();
  for (const c of cards) {
    const key = STATUS_GROUP_ORDER[statusRank(c.status)];
    const list = buckets.get(key);
    if (list) list.push(c); else buckets.set(key, [c]);
  }
  const out: Array<{ status: ProjectStatus; cards: T[] }> = [];
  for (const status of STATUS_GROUP_ORDER) {
    const list = buckets.get(status);
    if (list && list.length) out.push({ status, cards: list.slice().sort(compareProjectCards) });
  }
  return out;
}

/**
 * The manual order after moving `movedId` to `toIndex` WITHIN one group.
 *
 * Returns a dense 0..n-1 assignment for the whole group, because a sparse or
 * gap-based scheme drifts: repeated drags between two neighbours exhaust the
 * gap and need a silent renumber, and a renumber that the client and server
 * disagree about reorders someone's page. A group is a handful of cards, so
 * rewriting all of them is cheap and always correct.
 *
 * Reordering is WITHIN A GROUP ONLY. A card does not change status by being
 * dragged: status is set from the dropdown, deliberately, so a mis-drop can
 * never silently reclassify a project.
 */
export function reorderWithinGroup(
  groupIdsInOrder: readonly string[],
  movedId: string,
  toIndex: number,
): Array<{ id: string; sortOrder: number }> {
  const from = groupIdsInOrder.indexOf(movedId);
  if (from < 0) return groupIdsInOrder.map((id, i) => ({ id, sortOrder: i }));
  const next = groupIdsInOrder.slice();
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, movedId);
  return next.map((id, i) => ({ id, sortOrder: i }));
}
