-- ═══════════════════════════════════════════════════════════════════════════════
-- 152: REFM version change log + base-version pointer (2026-05-31)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Replaces the M1.6 "every edit creates a new version" auto-save model with
-- a session-based one:
--
--   * On project open, the most recent version row is loaded read-only.
--   * The user's first edit attempt opens a "Name this version" modal.
--   * Naming creates ONE new version row, pinned to the prior version
--     via base_version_id. All edits during that session PATCH the same
--     row in place; the diff log auto-recomputes against the base.
--
-- Two columns added to refm_project_versions:
--
--   base_version_id  uuid REFERENCES refm_project_versions(id)
--                    The version this version branched from. NULL for
--                    the very first version a project ever had.
--                    ON DELETE SET NULL so deleting a base does not
--                    cascade and wipe its descendants.
--
--   change_log       jsonb NOT NULL DEFAULT '[]'::jsonb
--                    Pre-computed diff between base.snapshot and this
--                    row's snapshot. Each element is a ChangeLogEntry:
--                      { path: string, label?: string,
--                        before: unknown, after: unknown }
--                    Stored pre-computed (not derived at read time) so
--                    the version-history UI does not have to load both
--                    snapshots to render the log, and so historical
--                    diffs survive even if the base version is later
--                    deleted.
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE refm_project_versions
  ADD COLUMN IF NOT EXISTS base_version_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'refm_project_versions'
      AND constraint_name = 'refm_project_versions_base_version_fkey'
  ) THEN
    ALTER TABLE refm_project_versions
      ADD CONSTRAINT refm_project_versions_base_version_fkey
      FOREIGN KEY (base_version_id)
      REFERENCES refm_project_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE refm_project_versions
  ADD COLUMN IF NOT EXISTS change_log jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN refm_project_versions.base_version_id IS
  'The version this version branched from (NULL = no base, i.e. first ever version). Used to recompute change_log on PATCH.';

COMMENT ON COLUMN refm_project_versions.change_log IS
  'Pre-computed diff between base_version_id.snapshot and this row.snapshot. Array of { path, label?, before, after } entries. See src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff.ts.';
