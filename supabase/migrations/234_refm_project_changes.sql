-- ============================================================
--  234_refm_project_changes.sql
--
--  THE APPEND-ONLY CHANGE LOG. Module 10 Collaboration, step 6.
--
--  Who changed what, when. A separate table, and the reasons are specific:
--
--  ── WHY NOT `refm_project_versions.change_log` ────────────────────────────
--
--  That column is a good thing that answers a different question. It holds a
--  DIFF BETWEEN TWO VERSIONS, recomputed against `base_version_id` on every
--  save, and it is what the version-history UI renders. It cannot serve as an
--  audit trail for three independent reasons:
--
--    1. NO AUTHOR. Its entries are {path, label, before, after, kind}. There is
--       nowhere to put who made the change.
--    2. NO TIMESTAMP. An entry says what differs, not when it differed.
--    3. IT IS RECOMPUTED, NOT APPENDED. Every PATCH rewrites it wholesale, so
--       history is overwritten rather than accumulated. One editing session is
--       one version row, autosaved every 1.5 seconds, and all of it collapses
--       into a single diff with no sequence.
--
--  IT IS KEPT, UNCHANGED, for the diff view it already serves. This table
--  stands beside it, not in place of it.
--
--  ── WHY NOT `admin_audit_log` ─────────────────────────────────────────────
--
--  It models ADMIN ACTIONS ON USERS: its columns are admin_id / action /
--  target_user_id, and `admin_id` is NOT NULL (TRAPS 2.5). A model edit has no
--  admin and no target user, so every row would need a fabricated actor.
--
--  ── APPEND ONLY, ENFORCED BY THE DATABASE ─────────────────────────────────
--
--  A trigger REJECTS every UPDATE THAT CHANGES CONTENT. An append-only rule
--  that lives only in application code is a rule that gets broken by the next
--  writer who has a good reason, and an audit trail that can be edited is not
--  one.
--
--  THE RULE IS ABOUT CONTENT, NOT ABOUT THE OPERATION, and it had to be:
--  `ON DELETE SET NULL` is implemented AS AN UPDATE on the child row, so a
--  blanket UPDATE ban made it impossible to delete a version or close an
--  account. The first version of this migration did exactly that and the
--  applier probe caught it. The trigger now permits ONE thing: an FK moving
--  to NULL. Re-pointing an FK at a different row is still refused, as is any
--  change to action, path, before, after, created_at, project_id or id.
--
--  A consequence worth stating: a no-op UPDATE that changes nothing is
--  allowed, because the rule tests what changed rather than what was
--  attempted. That costs nothing, since a no-op leaves no trace.
--
--  DELETE is deliberately NOT blocked, because it is how the project cascade
--  works: destroying a project must take its history with it, and a blanket
--  ban would make `ON DELETE CASCADE` fail. Nothing in the application deletes
--  from this table; only the cascade does.
--
--  ── NULLABLE version_id AND user_id ───────────────────────────────────────
--
--  Both are ON DELETE SET NULL, for the reason migration 230 gave for
--  `created_by`: the audit FACT must outlive the thing it points at. A version
--  can be deleted and an account can be closed; that a change happened, to
--  that path, at that time, remains true. NULL reads as "unknown", never as
--  someone else.
--
--  Apply with: npx tsx scripts/apply-migration-234.ts --apply
--  Idempotent. Safe to re-run. No em dashes.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS refm_project_changes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES refm_projects(id)         ON DELETE CASCADE,
  version_id uuid                 REFERENCES refm_project_versions(id) ON DELETE SET NULL,
  user_id    uuid                 REFERENCES users(id)                 ON DELETE SET NULL,
  action     text        NOT NULL,
  path       text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE refm_project_changes IS
  'APPEND-ONLY change log: who changed what, when (migration 234, Module 10 step 6). A trigger rejects every UPDATE; nothing rewrites or recomputes a row. Distinct from refm_project_versions.change_log, which is a RECOMPUTED diff between two versions with no author and no timestamp and which is kept for the version-history view it serves.';

COMMENT ON COLUMN refm_project_changes.user_id IS
  'Who made the change. NULL means the author has since deleted their account (the FK is ON DELETE SET NULL): the audit fact outlives the actor. NULL reads as unknown, never as someone else.';

COMMENT ON COLUMN refm_project_changes.action IS
  'What kind of change: add / remove / update for a field edit, or a lifecycle action such as version.created. Free text rather than an enum so a new action does not need a migration, and because this table is never queried by branching on the value.';

COMMENT ON COLUMN refm_project_changes.path IS
  'The snapshot path that changed, in the same grammar snapshot-diff uses (e.g. assets[id=x].buaSqm), so an entry can be tied to a field. NULL for lifecycle actions that are not about one path.';

-- The user-facing read is "this project's history, newest first".
CREATE INDEX IF NOT EXISTS idx_refm_changes_project
  ON refm_project_changes (project_id, created_at DESC);

-- And "what has this person changed", for a per-user view.
CREATE INDEX IF NOT EXISTS idx_refm_changes_user
  ON refm_project_changes (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ── THE APPEND-ONLY GUARD ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refm_project_changes_no_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Everything that carries the MEANING of the entry is immutable.
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.action     IS DISTINCT FROM OLD.action
     OR NEW.path       IS DISTINCT FROM OLD.path
     OR NEW.before     IS DISTINCT FROM OLD.before
     OR NEW.after      IS DISTINCT FROM OLD.after
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     -- An FK may be RELEASED to NULL (that is ON DELETE SET NULL doing its
     -- job) but never re-pointed at a different row, which would silently
     -- re-attribute a change to another person or another version.
     OR (NEW.version_id IS DISTINCT FROM OLD.version_id AND NEW.version_id IS NOT NULL)
     OR (NEW.user_id    IS DISTINCT FROM OLD.user_id    AND NEW.user_id    IS NOT NULL)
  THEN
    RAISE EXCEPTION
      'refm_project_changes is APPEND ONLY: an audit row cannot be rewritten (attempted on id %). The only permitted update is an FK being released to NULL by ON DELETE SET NULL. If a correction is needed, append a new row that records it.',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refm_changes_no_update ON refm_project_changes;
CREATE TRIGGER trg_refm_changes_no_update
  BEFORE UPDATE ON refm_project_changes
  FOR EACH ROW EXECUTE FUNCTION refm_project_changes_no_update();

COMMENT ON FUNCTION refm_project_changes_no_update() IS
  'Rejects every UPDATE that changes an audit row''s CONTENT. The one permitted update is an FK (version_id / user_id) being released to NULL, because ON DELETE SET NULL is implemented as an UPDATE and a blanket ban made it impossible to delete a version or close an account. Re-pointing an FK is refused, which would otherwise silently re-attribute a change. DELETE is left alone because it is how ON DELETE CASCADE removes a deleted project''s history.';

COMMIT;
