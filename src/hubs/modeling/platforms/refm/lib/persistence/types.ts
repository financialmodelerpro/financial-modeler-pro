/**
 * REFM persistence types (Phase M1.6).
 *
 * Hand-rolled mirror of the Supabase schema in
 * `supabase/migrations/149_refm_projects.sql`. The project does not run
 * the Supabase CLI today, so types are not auto-generated; this file is
 * the authoritative TS view of the two REFM tables and is wired into the
 * server / browser Supabase clients via SupabaseClient<RefmDatabase>.
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
// refm_project_versions.schema_version DEFAULT in migration 149. v4 was
// established in M1.5/12 (multi-phase + Master Holding + sub-units).
export const SCHEMA_VERSION = 4 as const;

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

export interface RefmProjectInsert {
  id?:                 string;
  user_id:             string;
  name:                string;
  location?:           string | null;
  status?:             ProjectStatus;
  asset_mix?:          string[];
  schema_version?:     number;
  current_version_id?: string | null;
  created_at?:         string;
  updated_at?:         string;
}

export interface RefmProjectUpdate {
  name?:               string;
  location?:           string | null;
  status?:             ProjectStatus;
  asset_mix?:          string[];
  schema_version?:     number;
  current_version_id?: string | null;
  updated_at?:         string;
}

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

export interface RefmProjectVersionInsert {
  id?:              string;
  project_id:       string;
  version_number:   number;
  schema_version?:  number;
  snapshot:         HydrateSnapshot;
  label?:           string | null;
  created_at?:      string;
}

// ── Database type for SupabaseClient<RefmDatabase> ──────────────────────────
// Matches the structure Supabase JS expects. Only the two new tables are
// declared here; the rest of the project uses untyped queries against
// the global `serverClient` / `getServerClient()`.
export interface RefmDatabase {
  public: {
    Tables: {
      refm_projects: {
        Row:    RefmProjectRow;
        Insert: RefmProjectInsert;
        Update: RefmProjectUpdate;
      };
      refm_project_versions: {
        Row:    RefmProjectVersionRow;
        Insert: RefmProjectVersionInsert;
        Update: Partial<RefmProjectVersionInsert>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
