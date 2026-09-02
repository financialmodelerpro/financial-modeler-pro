/**
 * REFM persistence types (Phase M1.6).
 *
 * Hand-rolled mirror of the Supabase schema in
 * `supabase/migrations/149_refm_projects.sql`. The project does not run
 * the Supabase CLI today, so types are not auto-generated; this file is
 * the authoritative TS view of the two REFM tables.
 *
 * The shared `serverClient` in `src/core/db/supabase.ts` is intentionally
 * untyped to match the rest of the project's query style. Callers cast
 * results back to these row types at the call site (server.ts has thin
 * helpers that do this so each route doesn't repeat the boilerplate).
 *
 * When the schema changes:
 *   1. Add the migration in supabase/migrations/.
 *   2. Update the Row / Insert / Update types here to match.
 *   3. Bump SCHEMA_VERSION below if the snapshot shape itself changed
 *      (the `schema_version` column tracks the snapshot's shape, not
 *      the DDL of these tables).
 */

import type { HydrateSnapshot } from '../state/module1-store';

// ── Snapshot shape version ──────────────────────────────────────────────────
// Mirrored to refm_projects.schema_version DEFAULT and to
// refm_project_versions.schema_version DEFAULT.
// v7 (M2.0d) renames AssetStrategy 'Hybrid' to 'Sell + Manage', adds
// Asset.managementAgreement + Asset.usefulLifeYears, replaces the v6
// 12-line cost catalog with the 9-line standard (Land cash/in-kind +
// Construction BUA + Construction Parking + Infrastructure + Landscaping
// + Pre-operating + Professional Fee + Commission + Contingency), and
// adds CostMethod 'rate_per_parking_bay'. Pre-v7 snapshots (v5 + v6) are
// NOT migrated; module1-migrate.isPreV7Snapshot returns an explicit
// "Schema migrated to v7. Please recreate this project." error.
export const SCHEMA_VERSION = 7 as const;

// ── Status enum ─────────────────────────────────────────────────────────────
//
// RE-EXPORTED, NOT DECLARED. The vocabulary, the card group order and the
// comparator live in `src/shared/admin/projectStatus.ts` so every platform
// shares one definition; REFM keeps these names only so existing importers do
// not have to move.
//
// 2026-09-01 (mig 229): the five-value APPROVAL workflow ('Draft', 'Active',
// 'IC Review', 'Approved', 'Archived') became the seven-value LIFECYCLE, which
// overlaps it on 'Draft' alone. Every production row was 'Draft', so nothing
// was rewritten. 'Archived' is NOT reintroduced: archiving is the `archived`
// boolean (mig 161) and soft delete is `deleted_at` (mig 224). Status is a
// LABEL and gates nothing; the standing rule is at the top of projectStatus.ts.
//
// NOT TO BE CONFUSED WITH `ProjectStatus` in `lib/state/module1-types.ts`,
// which is 'draft' | 'active' | 'archived' and describes the IN-MODEL project
// inside a snapshot. Same name, different concept, different file, and they
// must not be unified: this one is a row on refm_projects, that one is a field
// the engine reads.
export {
  PROJECT_STATUSES,
  DEFAULT_PROJECT_STATUS,
  isProjectStatus,
  type ProjectStatus,
} from '@/src/shared/admin/projectStatus';
import type { ProjectStatus } from '@/src/shared/admin/projectStatus';

// ── refm_projects row shape ─────────────────────────────────────────────────
export interface RefmProjectRow {
  id:                  string;
  user_id:             string;
  name:                string;
  location:            string | null;
  status:              ProjectStatus;
  asset_mix:           string[];
  schema_version:      number;
  current_version_id:  string | null;
  created_at:          string;
  updated_at:          string;
  // Migration 161 (2026-06-22): entitlement project-cap archive flag. THE one
  // archive state: the duplicate 'Archived' status value was removed 2026-08-30.
  // Reads decorate it to false when the column is absent (pre-migration), so it
  // is always present.
  archived:            boolean;
  // Migration 229 (2026-09-01): card ordering. Like `archived`, both are
  // decorated by the reader when the columns are absent, so they are always
  // present on a row that reached the client.
  //   priority   the URGENT flag, one flag not a scale; false pre-migration.
  //   sort_order manual position WITHIN the status group. NULL means never
  //              dragged and falls back to recency, so it stays nullable
  //              rather than being decorated to 0 (a real position).
  priority:            boolean;
  sort_order:          number | null;
}

// Picker-list shape (subset of RefmProjectRow excluding user_id, which
// the API filters on but doesn't need to send back to the owning user).
// `version_count` is computed by the server (a second query against
// refm_project_versions, joined in JS) so the picker can render
// "📌 N versions" without fetching every snapshot.
export type RefmProjectListItem = Omit<RefmProjectRow, 'user_id'> & {
  version_count: number;
};

// ── refm_project_versions row shape ─────────────────────────────────────────
// `snapshot` is the full HydrateSnapshot from module1-store. Stored as
// jsonb on the server, but typed as the live HydrateSnapshot here so
// reads land already-shaped (the migrator at lib/state/module1-migrate
// still runs on hydrate to upgrade older shapes).
//
// Migration 152 (2026-05-31) adds two columns for the session-based
// versioning model:
//   base_version_id  the version this one branched from (null = first)
//   change_log       pre-computed diff against base_version_id; see
//                    src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff.ts
//                    for the entry shape.
export interface RefmProjectVersionRow {
  id:              string;
  project_id:      string;
  version_number:  number;
  schema_version:  number;
  snapshot:        HydrateSnapshot;
  label:           string | null;
  base_version_id: string | null;
  change_log:      ChangeLogEntryDTO[];
  created_at:      string;
  // Migration 153 (2026-06-01): auto-naming + required comment. Nullable so
  // pre-153 rows (and the server's BASE fallback) read as null.
  version_label:   string | null;   // major.minor, e.g. "1.5"
  task_name:       string | null;   // user task label embedded in the name
  comment:         string | null;   // required note describing the change
  // Migration 230 (2026-09-01): WHO SAVED THIS VERSION. Null means the author
  // is unknown, which is true three ways and means the same thing each time:
  // the row predates the column, the server fell back to its BASE select, or
   // the author deleted their account (the FK is ON DELETE SET NULL). It is
  // NEVER the project owner: that is who owns the project today, a different
  // claim, and filling it in would manufacture an audit trail.
  created_by:      string | null;
}

// Mirrors src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff.ts
// `ChangeLogEntry`. Re-declared here so server-side files don't have
// to import from the diff lib (which has no server-side dependency).
export interface ChangeLogEntryDTO {
  path:    string;
  label?:  string;
  before:  unknown;
  after:   unknown;
  kind:    'add' | 'remove' | 'update';
}

// Version-list shape: snapshot omitted to keep the picker query light.
// change_log is included so the history UI can render diffs without a
// second round-trip; it's typically small (a few hundred bytes).
export type RefmProjectVersionListItem = Omit<RefmProjectVersionRow, 'snapshot'>;
