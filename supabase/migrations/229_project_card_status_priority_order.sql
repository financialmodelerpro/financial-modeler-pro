-- ============================================================
--  229_project_card_status_priority_order.sql
--
--  Project card ordering: a lifecycle STATUS the user can set from the card,
--  an URGENT flag, and a per-user MANUAL order within a status group.
--
--  Two additive columns, and ONE constraint replacement that is unavoidable.
--
--  ── THE STATUS VOCABULARY IS REPLACED, NOT EXTENDED ───────────────────────
--
--  149 declares CHECK (status IN ('Draft','Active','IC Review','Approved',
--  'Archived')), which is an APPROVAL WORKFLOW. The new set is a PROJECT
--  LIFECYCLE:
--
--      Draft, Funded, Construction, Operation, Completed, Closed, Dropped
--
--  They overlap on 'Draft' alone. 'Active', 'IC Review' and 'Approved' have no
--  counterpart, so extending the list would leave three values that mean
--  nothing and that no screen offers.
--
--  This is the one part of this change that is not additive, and it is
--  unavoidable: with the old CHECK in place, writing 'Funded' fails. It is
--  also LOSSLESS here, and that is measured rather than assumed: every row on
--  production carries 'Draft' (4 projects, 3 users, probed 2026-09-01), and
--  'Draft' survives into the new set. NO ROW IS REWRITTEN by this migration.
--  The guard below refuses the whole transaction rather than dropping a
--  constraint that live data would violate.
--
--  ── 'Archived' IS NOT REINTRODUCED, AND MUST NOT BE ───────────────────────
--
--  Archiving is the separate `archived` boolean (migration 161). 149's enum
--  ALSO carried an 'Archived' value, so one word meant two things: a workflow
--  status and a cap-freeing shelf state. The application-side enum dropped it
--  on 2026-08-30; this migration removes it from the database too, which is
--  the half that was left behind. A project is archived, or it is not, and
--  that is `archived`. Soft delete stays `deleted_at` (migration 224).
--  Neither is a status, and no status value may imply either.
--
--  ── THE TWO NEW COLUMNS ───────────────────────────────────────────────────
--
--  `priority`   boolean NOT NULL DEFAULT false. ONE FLAG, not a scale: a
--               project is urgent or it is not. Every existing row reads
--               false, so nothing changes until a user sets one.
--
--  `sort_order` integer NULL. The user's manual position WITHIN its status
--               group. NULL means "never dragged", and the reader falls back
--               to updated_at DESC for those, so a database with this column
--               and no drags behaves exactly as it did before. It is NOT
--               made NOT NULL DEFAULT 0: zero is a real position, and an
--               un-dragged project must be distinguishable from one dragged
--               to the top. (TRAPS 2.4, an absent value collapsing into a
--               real one.)
--
--               PER USER is satisfied by a column on the project row: a
--               project has exactly one owner (`user_id`, a real FK, and
--               every query filters on it), so there is no second user whose
--               order could differ. A join table would model sharing that
--               does not exist.
--
--  Both are read through the platform's schema-tolerance pattern, so the app
--  keeps working against a database where this migration has not been applied.
--
--  Apply manually via the Supabase dashboard, or with the applier script.
--  Idempotent: safe to run twice. No em dashes.
-- ============================================================

BEGIN;

-- ── 1. Guard: refuse if any live row holds a status the new set cannot ────
--    express. Names the offending values and the count, rather than letting
--    Postgres report a bare constraint violation.
DO $$
DECLARE
  bad_count integer;
  bad_values text;
BEGIN
  SELECT count(*), string_agg(DISTINCT status, ', ')
    INTO bad_count, bad_values
    FROM refm_projects
   WHERE status NOT IN ('Draft', 'Funded', 'Construction', 'Operation',
                        'Completed', 'Closed', 'Dropped');
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to replace the status CHECK: % row(s) hold a value outside the new set (%). Map them first; this migration never rewrites a user''s status.',
      bad_count, bad_values;
  END IF;
END $$;

-- ── 2. Replace the status vocabulary. ─────────────────────────────────────
ALTER TABLE refm_projects DROP CONSTRAINT IF EXISTS refm_projects_status_check;
ALTER TABLE refm_projects
  ADD CONSTRAINT refm_projects_status_check
  CHECK (status IN ('Draft', 'Funded', 'Construction', 'Operation',
                    'Completed', 'Closed', 'Dropped'));

COMMENT ON COLUMN refm_projects.status IS
  'Project LIFECYCLE status, label only: Draft, Funded, Construction, Operation, Completed, Closed, Dropped. Purely presentational, it gates nothing. Archiving is the separate `archived` boolean and soft delete is `deleted_at`; no status value may imply either (migration 229).';

-- ── 3. The urgent flag. Additive, defaults false on every existing row. ───
ALTER TABLE refm_projects
  ADD COLUMN IF NOT EXISTS priority boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN refm_projects.priority IS
  'User-set URGENT flag, one flag not a scale. Sorts within a status group, never across one (migration 229).';

-- ── 4. The manual position within a status group. NULL = never dragged. ───
ALTER TABLE refm_projects
  ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN refm_projects.sort_order IS
  'Manual card position WITHIN this project''s status group. NULL means never dragged, and those fall back to updated_at DESC; nullable on purpose so an un-dragged project is distinguishable from one dragged to position 0 (migration 229).';

-- ── 5. One index for the card query, which reads the live projects of one
--       user in group / priority / manual order.
CREATE INDEX IF NOT EXISTS idx_refm_projects_card_order
  ON refm_projects (user_id, status, priority DESC, sort_order)
  WHERE deleted_at IS NULL;

COMMIT;
