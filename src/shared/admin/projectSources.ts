/**
 * projectSources.ts
 *
 * THE registry of per-platform project tables for the admin Projects Browser.
 * Each platform stores its projects in its own table (REFM today; ERM and BVM
 * will bring their own), and the browser must show them side by side or
 * filtered, not be rebuilt per platform. So the browser's API and UI iterate
 * THIS list and know no table name of their own: adding a platform is one
 * entry here, zero route or component changes.
 *
 * Requirements for an entry (documented so a future table qualifies):
 *   - ownerColumn must be a REAL foreign key to users(id), because the list
 *     embeds users(email, name) through it;
 *   - archivedColumn is the platform's own soft-archive boolean (null = the
 *     platform has no archive concept; the browser then offers no archive
 *     action for it);
 *   - versionsTable/versionsFk drive the version count (null = no versions).
 *
 * Pure data, client-safe: no supabase import, no IO. The API route owns the
 * queries; this file owns WHAT exists.
 *
 * The LEGACY `projects` table is deliberately NOT an entry: it predates the
 * migration log, holds zero rows on prod, and is DEPRECATED (mig 220). It is
 * kept in the database untouched, but nothing lists or writes it any more.
 *
 * No em dashes in this file.
 */

export interface ProjectSource {
  /** Stable key used in API filters and mutation payloads. */
  key: string;
  label: string;
  /** Short badge text (e.g. REFM). */
  shortLabel: string;
  table: string;
  ownerColumn: string;
  nameColumn: string;
  archivedColumn: string | null;
  /** Soft-delete timestamp column (mig 224 for REFM). Null = the platform has
   *  no soft delete, so the browser offers no restore and the purge skips it. */
  deletedColumn: string | null;
  versionsTable: string | null;
  versionsFk: string | null;

  // ── Card ordering (mig 229 for REFM). A platform opts in by naming its
  //    three columns; the vocabulary, the group order and the comparator are
  //    NOT restated per platform, they live once in `projectStatus.ts`. All
  //    three null means the platform has no card ordering, and the card then
  //    falls back to recency exactly as it did before.

  /** Lifecycle status column, validated against PROJECT_STATUSES. Label only:
   *  see the standing rule at the top of `projectStatus.ts`, which is that no
   *  status value may free a project slot or make a project view-only. */
  statusColumn: string | null;
  /** The urgent flag, one boolean. Sorts within a status group, never across. */
  priorityColumn: string | null;
  /** Manual position within the status group. Nullable in the database:
   *  NULL means never dragged. */
  sortOrderColumn: string | null;

  // ── Collaboration membership (mig 231 for REFM). A platform opts in by
  //    naming its membership table and columns; the ROLES, the permission
  //    matrix and the read-only rule are NOT restated per platform. They live
  //    once in `src/core/collab/projectRoles.ts`.
  //
  //    Null means the platform has no membership concept, and its projects are
  //    reachable by their owner alone. That is the pre-231 behaviour and it
  //    stays correct: a platform without this is not broken, it is single-user.

  /** Membership table, e.g. `refm_project_members`. */
  membersTable: string | null;
  /** Column joining a membership row to its project. */
  membersProjectColumn: string | null;
  /** Column naming the member. A real FK to users(id). */
  membersUserColumn: string | null;
  /** Column holding the role, validated against PROJECT_ROLES. */
  membersRoleColumn: string | null;
}

/** THE retention window for a soft-deleted project, in days. One definition:
 *  the purge, the admin browser's "days left", the user's confirm dialog and
 *  the verifier all read this. */
export const RETENTION_DAYS = 30;

/** Whole days left before a soft-deleted project is hard deleted. 0 means it
 *  is due on the next purge run; never negative. Pure, so the client, the
 *  server and the verifier share one answer. */
export function daysRemaining(deletedAtIso: string | null | undefined, nowMs: number = Date.now()): number {
  if (!deletedAtIso) return RETENTION_DAYS;
  const deletedMs = Date.parse(deletedAtIso);
  if (Number.isNaN(deletedMs)) return RETENTION_DAYS;
  const dueMs = deletedMs + RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((dueMs - nowMs) / 86_400_000));
}

/** Whether a soft-deleted project is past its retention window (the purge
 *  predicate). Shared with the verifier so the boundary is stated once. */
export function isPurgeDue(deletedAtIso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!deletedAtIso) return false;
  const deletedMs = Date.parse(deletedAtIso);
  if (Number.isNaN(deletedMs)) return false;
  return nowMs - deletedMs >= RETENTION_DAYS * 86_400_000;
}

export const PROJECT_SOURCES: ProjectSource[] = [
  {
    key: 'refm',
    label: 'Real Estate Financial Modeling',
    shortLabel: 'REFM',
    table: 'refm_projects',
    ownerColumn: 'user_id',
    nameColumn: 'name',
    archivedColumn: 'archived',
    deletedColumn: 'deleted_at',
    versionsTable: 'refm_project_versions',
    versionsFk: 'project_id',
    statusColumn: 'status',
    priorityColumn: 'priority',
    sortOrderColumn: 'sort_order',
    membersTable: 'refm_project_members',
    membersProjectColumn: 'project_id',
    membersUserColumn: 'user_id',
    membersRoleColumn: 'role',
  },
  // ERM / BVM: add one entry per platform when their project tables exist.
  // Card ordering comes with the entry: name the three columns and the
  // grouping, the urgent flag and the drag order all work, because the rule
  // is in projectStatus.ts and nothing here restates it.
];

export function getProjectSource(key: string): ProjectSource | null {
  return PROJECT_SOURCES.find((s) => s.key === key) ?? null;
}

/** Whether a platform has card ordering wired. All three columns are required
 *  together: status without a sort order groups but cannot be reordered, and a
 *  sort order without a status has no group to be an order WITHIN. Answering
 *  "partly" would ship a half-working card, so the answer is all or nothing. */
export function hasCardOrdering(s: ProjectSource): boolean {
  return !!s.statusColumn && !!s.priorityColumn && !!s.sortOrderColumn;
}

/** Whether a platform has collaboration membership wired.
 *
 *  All four are required together, and for a sharper reason than card ordering:
 *  a partially wired membership is an ACCESS CONTROL that half works. A table
 *  without a role column cannot say what a member may do; a role column with no
 *  user column cannot say whose role it is. Rather than guess, a platform that
 *  answers "partly" is treated as having no membership at all, so access falls
 *  back to the owner and nothing is accidentally opened up. */
export function hasMembership(s: ProjectSource): boolean {
  return !!s.membersTable && !!s.membersProjectColumn
    && !!s.membersUserColumn && !!s.membersRoleColumn;
}
