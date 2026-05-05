-- ═══════════════════════════════════════════════════════════════════════════════
-- M2.0: REFM Module 1 hard-cut rebuild to MAAD-Spec v5
-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase M2.0 (2026-05-06).
--
-- Module 1 schema is rewritten end-to-end: Master Holding / Sub-Project /
-- Plot / Zone / FAR / Cascade / Parking Allocator are gone. The v5
-- HydrateSnapshot shape is now flat:
--
--   project + phases[] + parcels[] + assets[] + subUnits[] +
--   costLines[] + costOverrides[] + financingTranches[] +
--   equityContributions[] + landAllocationMode
--
-- Pre-v5 snapshots (v2 / v3 / v4) are NOT migrated; module1-migrate.ts
-- returns "Schema migrated to v5. Please recreate this project." for
-- any non-v5 shape.
--
-- This migration:
--   1. Bumps refm_projects.schema_version DEFAULT from 4 to 5.
--   2. Bumps refm_project_versions.schema_version DEFAULT from 4 to 5.
--   3. Marks every existing v4 (or earlier) project row as
--      `status = 'Archived'` so the UI surfaces them as legacy data.
--      The version rows are preserved untouched (no destructive
--      DELETEs); users can manually copy values into a freshly-created
--      v5 project via the new wizard.
--   4. Adds a comment to each table calling out the v5 shape contract.
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Bump default schema_version ─────────────────────────────────────────
ALTER TABLE refm_projects ALTER COLUMN schema_version SET DEFAULT 5;
ALTER TABLE refm_project_versions ALTER COLUMN schema_version SET DEFAULT 5;

-- ── 2. Mark pre-v5 projects as archived ────────────────────────────────────
-- Conservative: skip projects already on schema_version 5 (idempotent re-run)
-- and skip projects already in the 'Archived' status (preserves user intent
-- if they archived a v4 project on purpose pre-migration).
UPDATE refm_projects
   SET status = 'Archived',
       updated_at = now()
 WHERE schema_version < 5
   AND status <> 'Archived';

-- ── 3. Table comments documenting the v5 contract ──────────────────────────
COMMENT ON TABLE refm_projects IS
  'REFM Module 1 project rows. schema_version: 5 = MAAD-Spec (M2.0). '
  'Pre-5 projects are auto-archived; their version snapshots remain '
  'in refm_project_versions but cannot be loaded into the v5 store '
  '(module1-migrate returns an explicit error).';

COMMENT ON TABLE refm_project_versions IS
  'REFM Module 1 version history. snapshot jsonb shape depends on '
  'schema_version: 5 = MAAD-Spec v5 (project + phases + parcels + '
  'assets + subUnits + costLines + costOverrides + financingTranches + '
  'equityContributions + landAllocationMode). Pre-5 snapshots are '
  'preserved as historical artefacts but rejected on load.';

COMMENT ON COLUMN refm_projects.schema_version IS
  'Tracks the MAAD-Spec snapshot shape. v5 is the current; v2/v3/v4 are '
  'frozen historical shapes (see CLAUDE.md M2.0 closure).';

COMMENT ON COLUMN refm_project_versions.schema_version IS
  'Tracks the snapshot shape this version was written in. v5 = MAAD-Spec; '
  'v4 and earlier rows are read-only historical artefacts.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- M2.0 migration complete. Run sequence:
--   1. Apply this SQL (Ahmad runs manually).
--   2. Deploy the M2.0 code (npm run build + git push).
--   3. Verify legacy projects show as Archived in the picker.
--   4. Verify new projects created via the wizard land on schema_version 5.
-- ═══════════════════════════════════════════════════════════════════════════════
