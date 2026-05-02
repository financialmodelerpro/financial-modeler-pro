-- ═══════════════════════════════════════════════════════════════════════════════
-- 149: REFM Module 1 Supabase persistence (Phase M1.6)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Replaces the localStorage-only `refm_v2` blob with two server-side tables
-- so the user can sign in from any device and pick up where they left off.
-- localStorage stays in the browser as an offline-resume cache (see
-- src/hubs/modeling/platforms/refm/lib/persistence/cache.ts) but the
-- server is the source of truth.
--
--   refm_projects          one row per project, owned by exactly one user
--   refm_project_versions  snapshot history, monotonic version_number per
--                          project, full v4 HydrateSnapshot in jsonb
--
-- Each project carries a `current_version_id` pointer to the version that
-- the UI shows when the project loads. Save = insert a new version row +
-- bump current_version_id. The versions table never gets UPDATEd, only
-- INSERTed; older versions stay around for the existing
-- save-version / load-version flow that the user already has in
-- VersionModal.tsx.
--
-- RLS posture (defense in depth):
--   - RLS enabled on both tables.
--   - Row-level policies use auth.uid() so that IF Supabase auth is ever
--     wired up, anon-key clients can only read their own rows.
--   - Today the project uses NextAuth (not Supabase auth), so auth.uid()
--     evaluates to NULL on every anon-key request and the policies
--     deny-by-default. Server-side queries run through the SERVICE_ROLE
--     key which bypasses RLS entirely, and the API routes under
--     app/api/refm/projects/* enforce `user_id = session.user.id` on
--     every query before that bypass kicks in.
--   - Net: anon-key clients get nothing; the only path to these tables
--     is through server routes that have already auth-gated the request.
--
-- Versioning:
--   - schema_version DEFAULT 4 captures the current v4 HydrateSnapshot
--     shape introduced in M1.5/12 (multi-phase + Master Holding + sub-
--     units). Future breaking shape changes bump the default and the
--     migrator at lib/state/module1-migrate.ts upgrades older rows to
--     the current shape on read.
--   - schema_version lives on BOTH tables. The project-level value
--     records "the current shape this project is on"; the version-level
--     value records "the shape this snapshot was written in." A project
--     can carry historical versions written in older schemas; the
--     migrator handles them on hydrate.
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── refm_projects ───────────────────────────────────────────────────────────
-- current_version_id FK is added in a separate ALTER below so the table
-- ordering does not require refm_project_versions to exist first.
CREATE TABLE IF NOT EXISTS refm_projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                text NOT NULL,

  -- Mirrors the legacy StorageProject metadata so ProjectsScreen can
  -- render the project list without fetching every snapshot. Kept on
  -- the project row (not the version row) so picker queries stay light.
  location            text,
  status              text NOT NULL DEFAULT 'Draft'
                      CHECK (status IN ('Draft', 'Active', 'IC Review', 'Approved', 'Archived')),
  asset_mix           jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Schema version of the snapshot shape used by THIS project's most
  -- recent save. Older versions in refm_project_versions can still
  -- carry an older schema_version; the migrator upgrades them on read.
  schema_version      integer NOT NULL DEFAULT 4,

  -- The version row that loads when the user opens this project. FK
  -- added below (refm_project_versions does not exist yet at this
  -- point in the script). Nullable because a brand-new project exists
  -- for a moment between the project insert and the first version
  -- insert.
  current_version_id  uuid,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Hot path: list-my-projects on the ProjectsScreen. Sorted by recency.
CREATE INDEX IF NOT EXISTS idx_refm_projects_user_updated
  ON refm_projects(user_id, updated_at DESC);

COMMENT ON TABLE refm_projects IS
  'REFM Module 1 project metadata. Owned by exactly one user (NextAuth users.id). Snapshot data lives in refm_project_versions; this row is just the picker-level metadata.';

COMMENT ON COLUMN refm_projects.current_version_id IS
  'Pointer to the version row the UI loads on open. Nullable mid-create transaction (server inserts the project then the first version then updates this pointer in one txn). Bumped on every save.';

COMMENT ON COLUMN refm_projects.schema_version IS
  'Snapshot shape version. v4 = M1.5/12 (multi-phase + Master Holding + sub-units). Older versions in refm_project_versions auto-upgrade through lib/state/module1-migrate on read.';

COMMENT ON COLUMN refm_projects.asset_mix IS
  'Cached array of asset names (e.g. ["Residential","Hospitality"]) for the picker tile. Computed from the snapshot at save time so the list query never has to read jsonb snapshots.';


-- ── refm_project_versions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refm_project_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES refm_projects(id) ON DELETE CASCADE,

  -- Monotonic per project. Auto-incremented in the API layer (server
  -- reads the current MAX and writes MAX+1). The unique index below
  -- enforces no duplicates per project even under concurrent saves.
  version_number  integer NOT NULL CHECK (version_number >= 1),

  schema_version  integer NOT NULL DEFAULT 4,

  -- Full v4 HydrateSnapshot, exactly as defined at
  -- src/hubs/modeling/platforms/refm/lib/state/module1-store.ts
  -- (export type HydrateSnapshot). Nothing strips fields; the migrator
  -- on read tolerates extras.
  snapshot        jsonb NOT NULL,

  -- Optional user-facing label (e.g. "Pre-IC review", "v2 with debt
  -- bumped"). Auto-saves leave this NULL; the existing VersionModal
  -- save-as flow sets it.
  label           text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Enforce monotonic per-project version numbers + index the version
-- list and load-current paths.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_refm_versions_project_number
  ON refm_project_versions(project_id, version_number);

CREATE INDEX IF NOT EXISTS idx_refm_versions_project_created
  ON refm_project_versions(project_id, created_at DESC);

COMMENT ON TABLE refm_project_versions IS
  'Snapshot history for an refm_project. Append-only: never UPDATEd. Save = INSERT new row + bump refm_projects.current_version_id. Existing version-history UI in VersionModal.tsx reads from here.';

COMMENT ON COLUMN refm_project_versions.snapshot IS
  'Full HydrateSnapshot per src/hubs/modeling/platforms/refm/lib/state/module1-store.ts. Read-tolerant: lib/state/module1-migrate normalizes any older shape to current on hydrate.';

COMMENT ON COLUMN refm_project_versions.label IS
  'Optional user-facing version label set via VersionModal save-as. NULL for auto-saves.';


-- ── current_version_id FK (added after both tables exist) ──────────────────
-- ON DELETE SET NULL because deleting a single old version row should not
-- destroy the project; the API just re-points current_version_id at the
-- previous version. Cascading delete of the project itself is already
-- handled by refm_project_versions.project_id ON DELETE CASCADE above.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'refm_projects'
      AND constraint_name = 'refm_projects_current_version_fkey'
  ) THEN
    ALTER TABLE refm_projects
      ADD CONSTRAINT refm_projects_current_version_fkey
      FOREIGN KEY (current_version_id)
      REFERENCES refm_project_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;


-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE refm_projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE refm_project_versions  ENABLE ROW LEVEL SECURITY;

-- refm_projects: row owner reads/writes own. Service role bypasses RLS
-- regardless. Anon-key clients with no Supabase auth (today's case)
-- get auth.uid() = NULL, which never matches user_id, so deny-all.
DROP POLICY IF EXISTS "Users read own refm_projects"   ON refm_projects;
CREATE POLICY "Users read own refm_projects"           ON refm_projects FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users write own refm_projects"  ON refm_projects;
CREATE POLICY "Users write own refm_projects"          ON refm_projects FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- refm_project_versions: ownership is transitive through project_id.
-- The EXISTS check joins back to refm_projects on the same auth.uid()
-- predicate, so only versions of the user's own projects are visible.
DROP POLICY IF EXISTS "Users read own refm_versions"   ON refm_project_versions;
CREATE POLICY "Users read own refm_versions"           ON refm_project_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM refm_projects
    WHERE refm_projects.id = refm_project_versions.project_id
      AND refm_projects.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users write own refm_versions"  ON refm_project_versions;
CREATE POLICY "Users write own refm_versions"          ON refm_project_versions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM refm_projects
    WHERE refm_projects.id = refm_project_versions.project_id
      AND refm_projects.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM refm_projects
    WHERE refm_projects.id = refm_project_versions.project_id
      AND refm_projects.user_id = auth.uid()
  ));


-- ── updated_at touch trigger ────────────────────────────────────────────────
-- Auto-bumps refm_projects.updated_at on any row update so the picker
-- ("Last modified") sort order is always correct. Idempotent: drop +
-- create.
CREATE OR REPLACE FUNCTION refm_projects_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refm_projects_touch_updated_at ON refm_projects;
CREATE TRIGGER trg_refm_projects_touch_updated_at
  BEFORE UPDATE ON refm_projects
  FOR EACH ROW
  EXECUTE FUNCTION refm_projects_touch_updated_at();
