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

// ── Status enum (mirrors the SQL CHECK constraint) ──────────────────────────
export const PROJECT_STATUSES = ['Draft', 'Active', 'IC Review', 'Approved', 'Archived'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

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
export interface RefmProjectVersionRow {
  id:              string;
  project_id:      string;
  version_number:  number;
  schema_version:  number;
  snapshot:        HydrateSnapshot;
  label:           string | null;
  created_at:      string;
}

// Version-list shape: snapshot omitted to keep the picker query light.
export type RefmProjectVersionListItem = Omit<RefmProjectVersionRow, 'snapshot'>;
