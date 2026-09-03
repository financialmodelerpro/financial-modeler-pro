-- ============================================================
--  236_refm_project_comments.sql
--
--  COMMENTS. Module 10 Collaboration, step 7.
--
--  A person's words about the model: on the project as a whole, on one saved
--  version, or on one field. Distinct from BOTH existing records, and the
--  distinction is why this is a third table rather than a column on either:
--
--    refm_project_changes (234)  WHAT THE SYSTEM OBSERVED. Appended by the
--                                save path, never written by a client, and
--                                immutable by trigger. A comment is the
--                                opposite on all three counts: a person
--                                writes it, edits it, and deletes it.
--    refm_project_versions       A version's `comment` (mig 153) is the
--                                REQUIRED note attached to one save. One
--                                author, no thread, no resolve state, and it
--                                describes a save rather than opening a
--                                conversation.
--
--  EVERYTHING IS NULLABLE EXCEPT THE PROJECT AND THE BODY. A comment on the
--  PROJECT AS A WHOLE is valid and is expected to be the common case, so
--  `version_id` and `path` are both optional and neither implies the other: a
--  comment can name a field without a version, or a version without a field.
--
--  `path` uses the SNAPSHOT-DIFF GRAMMAR, the same one refm_project_changes
--  stores and applyOverrides.getByPath resolves (e.g. assets[id=x].buaSqm).
--  There is exactly one path vocabulary in this platform and a second one
--  would immediately disagree with it.
--
--  version_id IS ON DELETE SET NULL, so the comment outlives the version.
--  Same rule as 230's created_by and 234's version_id: the fact outlives what
--  it points at. A comment written against v3 stays readable after v4 is saved
--  (nothing filters by version) and after v3 is deleted (the FK nulls). NULL
--  reads as "the version it was written against is gone", never as "written
--  against the current one".
--
--  REPLIES ARE ONE LEVEL, ENFORCED BY THE DATABASE. A trigger refuses a reply
--  whose parent is itself a reply. A depth rule kept only in application code
--  is one the next writer breaks, and a thread that has quietly become a tree
--  cannot be flattened afterwards without deciding, for somebody else, what
--  their reply was replying to. ON DELETE CASCADE on parent_id fires only when
--  the parent row is HARD deleted, which the application never does.
--
--  SOFT DELETE. `deleted_at` hides a comment; the row stays so a thread keeps
--  its shape and no reply is orphaned. The body is left intact in the table
--  and is STRIPPED BY THE SERVER on read, so a deleted comment's text never
--  reaches a client again.
--
--  RESOLVED IS A TIMESTAMP AND AN ACTOR, not a boolean. A boolean answers "is
--  it resolved" and nothing else; the question a resolved thread actually gets
--  asked is "who closed this, and when", and that cannot be backfilled later.
--
--  Apply with: npx tsx scripts/apply-migration-236.ts --apply
--  Idempotent. Safe to re-run. No em dashes.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS refm_project_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES refm_projects(id)         ON DELETE CASCADE,
  version_id  uuid                 REFERENCES refm_project_versions(id) ON DELETE SET NULL,
  parent_id   uuid                 REFERENCES refm_project_comments(id) ON DELETE CASCADE,
  user_id     uuid                 REFERENCES users(id)                 ON DELETE SET NULL,
  path        text,
  body        text        NOT NULL CHECK (length(btrim(body)) > 0),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at  timestamptz,
  deleted_at  timestamptz,
  resolved_at timestamptz,
  resolved_by uuid                 REFERENCES users(id)                 ON DELETE SET NULL
);

COMMENT ON TABLE refm_project_comments IS
  'Comments on a project, a version, or a field (migration 236, Module 10 step 7). Person-authored, editable and soft-deletable, unlike refm_project_changes which is system-appended and immutable by trigger. Replies are ONE level, enforced by trg_refm_comments_one_level.';

COMMENT ON COLUMN refm_project_comments.version_id IS
  'The version this comment was written against, or NULL. ON DELETE SET NULL so the comment outlives the version: NULL means that version is gone, never that the comment applies to the current one. Nothing filters the read by version, so a comment stays visible after a newer version is saved.';

COMMENT ON COLUMN refm_project_comments.path IS
  'The snapshot path this comment is about, in the SAME grammar snapshot-diff emits and applyOverrides resolves (e.g. assets[id=x].buaSqm). NULL for a comment on the project or a version as a whole. There is one path vocabulary in this platform; do not introduce a second.';

COMMENT ON COLUMN refm_project_comments.parent_id IS
  'The comment this one replies to. NULL for a thread root. A reply may not itself be replied to (trg_refm_comments_one_level). ON DELETE CASCADE fires only on a HARD delete of the parent, which the application never performs: a user Delete sets deleted_at.';

COMMENT ON COLUMN refm_project_comments.deleted_at IS
  'Soft delete. The row stays so the thread keeps its shape and no reply is orphaned; the server strips the body from every read once this is set.';

COMMENT ON COLUMN refm_project_comments.resolved_at IS
  'When the thread was resolved, NULL while open. Paired with resolved_by, because "who closed this and when" is what a resolved thread actually gets asked, and a boolean cannot be backfilled into that answer.';

CREATE INDEX IF NOT EXISTS idx_refm_comments_project
  ON refm_project_comments (project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_refm_comments_parent
  ON refm_project_comments (parent_id, created_at)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refm_comments_path
  ON refm_project_comments (project_id, path)
  WHERE path IS NOT NULL;

CREATE OR REPLACE FUNCTION refm_comments_one_level()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grandparent uuid;
  found_parent boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a comment cannot reply to itself (id %)', NEW.id;
  END IF;
  SELECT TRUE, parent_id INTO found_parent, grandparent
    FROM refm_project_comments WHERE id = NEW.parent_id;
  IF found_parent IS NULL THEN
    RAISE EXCEPTION 'parent comment % does not exist', NEW.parent_id;
  END IF;
  IF grandparent IS NOT NULL THEN
    RAISE EXCEPTION
      'replies are ONE level: comment % is already a reply, so it cannot be replied to. Reply to its thread root (%) instead.',
      NEW.parent_id, grandparent;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION refm_comments_one_level() IS
  'Refuses a reply whose parent is itself a reply, and a comment replying to itself. Enforced in the database because a depth rule kept only in application code is one the next writer breaks, and a thread that has silently become a tree cannot be flattened afterwards without guessing what somebody meant to reply to.';

DROP TRIGGER IF EXISTS trg_refm_comments_one_level ON refm_project_comments;
CREATE TRIGGER trg_refm_comments_one_level
  BEFORE INSERT OR UPDATE OF parent_id ON refm_project_comments
  FOR EACH ROW EXECUTE FUNCTION refm_comments_one_level();

COMMIT;
