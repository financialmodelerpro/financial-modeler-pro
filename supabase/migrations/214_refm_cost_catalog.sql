-- ============================================================
-- 214: refm_cost_catalog, so a cost line's identity is a SELECTION and the
--      list a user builds up survives across their projects
--
-- WHY THIS TABLE EXISTS. A cost line has two parts: a catalog entry underneath
-- carrying the method, stage and phasing source, and a display name the user
-- renames freely. Before this, behaviour lived in the line's id while the label
-- was free text, so a live project carried a row labelled "Permits and
-- approvals" that was the seeded Commission line: it looked like permits, it
-- charged like commission, it followed sales collections, and no surface said
-- so. The catalog closes that gap, and it is only useful if the entries a user
-- adds are still there on the next project.
--
-- ── WHAT IS AND IS NOT STORED HERE ─────────────────────────────────────────
--
-- The BUILT-IN entries live in code (`lib/state/costCatalog.ts`), not in rows.
-- That is deliberate: a project always has the standard list with no database
-- round trip, no empty state, and no seeding step that can half-run. This table
-- holds ONLY what a user added, layered on top.
--
-- It also holds no behaviour that the model depends on. Selecting an entry
-- STAMPS its method / stage / phasing source onto the cost line, and the engine
-- reads the line. So an unreachable catalog (a failed fetch, a deploy landing
-- before this migration, a deleted entry) can never change a number: at worst a
-- caption falls back to "custom". Nothing here is on a calculation path.
--
-- ── SHARED PER USER, NOT PER PROJECT AND NOT GLOBAL ────────────────────────
--
-- Per project would rebuild the list every time, which is the thing being
-- fixed. Global across all users would leak one tenant's private vocabulary
-- into another account. Per user is the scope that matches the intent: the list
-- builds up over time for the person building it.
--
-- ── ID SHAPE ───────────────────────────────────────────────────────────────
--
-- `entry_id` is constrained to [a-z0-9-] because a cost line minted from an
-- entry composes its id as `${entry_id}__${phaseId}`, and `deriveLineBaseId`
-- splits on that double underscore. An id carrying an underscore pair would
-- silently resolve to the wrong base id, which is exactly the class of defect
-- this feature exists to remove. The CHECK enforces it at the database rather
-- than trusting every caller.
--
-- Unique per (user, entry_id): re-adding an entry that exists is an update, not
-- a duplicate row, so the picker can never show the same entry twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS refm_cost_catalog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id     TEXT NOT NULL CHECK (entry_id ~ '^[a-z0-9-]{1,48}$'),
  label        TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  -- Mirrors CostMethod / CostStage / CapexPhasingSource / AllocationBasis /
  -- CostScope in module1-types.ts. Stored as TEXT rather than enums: the union
  -- types change with the model (marketing became a stage in 2026-08-16), and a
  -- database enum would turn a code change into a migration. The API route
  -- validates against the live unions before insert.
  method       TEXT NOT NULL,
  stage        TEXT NOT NULL,
  phasing_source TEXT NOT NULL DEFAULT 'inherit',
  allocation_basis TEXT NOT NULL DEFAULT 'per_asset',
  scope        TEXT NOT NULL DEFAULT 'indirect',
  hint         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT refm_cost_catalog_user_entry_unique UNIQUE (user_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_refm_cost_catalog_user
  ON refm_cost_catalog (user_id, label);

-- RLS on, with no policy for anon: this project authenticates with NextAuth and
-- every server read goes through SERVICE_ROLE, which bypasses RLS, while the
-- API route enforces `user_id = session.user.id` on every query. An anon-key
-- client therefore denies all, which is the same posture as refm_projects.
ALTER TABLE refm_cost_catalog ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE refm_cost_catalog IS
  'User-added REFM cost catalog entries, shared across that user''s projects. Built-in entries live in code (lib/state/costCatalog.ts), not here. Nothing in this table is read by the calculation engine: an entry stamps method/stage/phasing source onto a cost line at selection time and the engine reads the line.';
