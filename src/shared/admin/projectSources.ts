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
  versionsTable: string | null;
  versionsFk: string | null;
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
    versionsTable: 'refm_project_versions',
    versionsFk: 'project_id',
  },
  // ERM / BVM: add one entry per platform when their project tables exist.
];

export function getProjectSource(key: string): ProjectSource | null {
  return PROJECT_SOURCES.find((s) => s.key === key) ?? null;
}
