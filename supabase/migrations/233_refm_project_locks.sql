-- ============================================================
--  233_refm_project_locks.sql
--
--  THE EDIT LOCK. Module 10 Collaboration, step 5.
--
--  One person edits a project at a time. Until now nothing enforced that:
--  `editMode` is React state, `editingVersionId` is a module variable in
--  module1-sync, both per browser tab, and the autosave PATCHes the same
--  version row every 1.5 seconds. Two people editing one project meant last
--  write wins, silently, with neither told. That is why membership shipped
--  read-only for non-owners in step 2, and this is the migration that lifts it.
--
--  ── ONE ROW PER PROJECT, AND THE ROW IS THE LOCK ──────────────────────────
--
--  `project_id` is the PRIMARY KEY, so the existence of a row IS the lock and
--  the database refuses two holders by construction rather than by convention.
--  No row means unlocked. There is no `is_locked` boolean to drift.
--
--  ── HEARTBEAT, NOT AN UNLOAD HANDLER ──────────────────────────────────────
--
--  `heartbeat_at` is refreshed by the holder while they are editing. A lock is
--  STALE when the heartbeat stops, and staleness is the ONLY way a lock is
--  released other than the holder releasing it deliberately.
--
--  This is not a preference. An unload handler does not fire on a crash, a
--  killed tab, a closed laptop or a dropped network, and those are precisely
--  the cases where a lock would otherwise be held forever by nobody. A
--  heartbeat has no such gap: if the client stops talking, for any reason at
--  all, the lock ages out. The cost is a bounded window (the TTL) where a lock
--  is held by a session that has already gone, which is the correct trade
--  against a lock that is never released.
--
--  ── THE STEAL IS ONE ATOMIC STATEMENT ─────────────────────────────────────
--
--  `refm_acquire_project_lock` below is the ONLY way a lock is taken. It is a
--  single INSERT ... ON CONFLICT DO UPDATE whose WHERE clause decides, inside
--  the statement, whether the caller may have it:
--
--      no row          -> the INSERT wins
--      the row is mine -> refresh my own heartbeat
--      the row is stale-> steal it
--      otherwise       -> the UPDATE matches nothing and the caller gets NO ROWS
--
--  Because that is one statement against a primary key, Postgres serialises
--  two concurrent callers on the row lock: the second sees the first's
--  committed row and its WHERE is evaluated against the NEW heartbeat, so it
--  loses. TWO WAITERS CANNOT BOTH WIN. Doing this as SELECT-then-UPDATE in the
--  application would leave exactly that race, which is why it lives here.
--
--  A CRON WOULD BE WORSE. Releasing stale locks on a schedule makes the
--  release window depend on the cron's cadence, and leaves a lock held by
--  nobody until the next tick. The next acquirer breaking a stale lock is both
--  tighter and simpler: the release happens exactly when someone wants it.
--
--  ── REQUEST AND RESPOND ───────────────────────────────────────────────────
--
--  A waiter sets `release_requested_by` / `release_requested_at` on the row.
--  The holder's next heartbeat returns it, so they learn of the request
--  without any push channel. Accepting means releasing; declining clears the
--  request. Neither is a lock transfer: after a release the lock is simply
--  free, and the waiter takes it the ordinary way, through the same atomic
--  acquire. A "hand it to them" path would need to name a beneficiary and
--  would race with anyone else acquiring in between.
--
--  Apply with: npx tsx scripts/apply-migration-233.ts --apply
--  Idempotent. Safe to re-run. No em dashes.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS refm_project_locks (
  project_id           uuid        PRIMARY KEY REFERENCES refm_projects(id) ON DELETE CASCADE,
  holder_user_id       uuid        NOT NULL    REFERENCES users(id)         ON DELETE CASCADE,
  acquired_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  release_requested_by uuid        REFERENCES users(id) ON DELETE SET NULL,
  release_requested_at timestamptz
);

COMMENT ON TABLE refm_project_locks IS
  'The edit lock: one row per project, and the ROW IS THE LOCK (project_id is the primary key, so two holders are impossible by construction). No row means unlocked. Taken only through refm_acquire_project_lock, which is one atomic statement. Released by the holder, or aged out when heartbeat_at stops advancing (migration 233, Module 10 step 5).';

COMMENT ON COLUMN refm_project_locks.heartbeat_at IS
  'Refreshed by the holder while editing. A lock is STALE when this stops advancing, and staleness is the only release other than a deliberate one. Deliberately NOT an unload handler: that does not fire on a crash, a killed tab or a dropped network, which are exactly the cases that would otherwise hold a lock forever.';

COMMENT ON COLUMN refm_project_locks.release_requested_by IS
  'A waiter asking the holder to save and release. The holder learns of it from their next heartbeat, so no push channel is needed. Accepting releases the lock; declining clears this. Neither transfers the lock: the waiter re-acquires the ordinary way.';

-- The stale scan and the "who is editing" read both key off the project, which
-- the primary key serves. This one supports finding a user's held locks, which
-- the client uses to release everything on sign-out.
CREATE INDEX IF NOT EXISTS idx_refm_locks_holder
  ON refm_project_locks (holder_user_id);

-- ── THE ATOMIC ACQUIRE ───────────────────────────────────────────────────
--
-- Returns the winning row, or NO ROWS when the caller did not get the lock.
--
-- SETOF, AND THAT IS NOT A DETAIL. Declared as `RETURNS refm_project_locks`
-- this function returns a NULL COMPOSITE when its query matches nothing, and
-- `SELECT * FROM refm_acquire_project_lock(...)` renders that as ONE ROW OF
-- NULLS rather than zero rows. A refusal then looks exactly like a win to any
-- caller counting rows, which would have let a second person hold the lock.
-- Caught by the applier probe before this shipped. `RETURNS SETOF` makes
-- "no rows" actually mean no rows.
--
-- CLOCK_TIMESTAMP, NOT NOW. `now()` is the TRANSACTION timestamp and is
-- frozen for the life of a transaction, so a heartbeat written inside a long
-- transaction would record when the transaction began rather than when the
-- heartbeat happened, and two calls in one transaction would be
-- indistinguishable. A heartbeat is a wall-clock fact.
--
-- `p_ttl_seconds` is passed in rather than hardcoded so the TTL has ONE
-- definition, in TypeScript, shared by the client heartbeat interval and the
-- server; a second copy here could drift from it.
-- Dropped first: CREATE OR REPLACE cannot change a function's RETURN TYPE,
-- so a database that already has the first (scalar-returning) version would
-- refuse the replacement with "cannot change return type of existing
-- function". Dropping by exact signature is idempotent and affects nothing
-- else.
DROP FUNCTION IF EXISTS refm_acquire_project_lock(uuid, uuid, integer);

CREATE FUNCTION refm_acquire_project_lock(
  p_project_id  uuid,
  p_user_id     uuid,
  p_ttl_seconds integer
)
RETURNS SETOF refm_project_locks
LANGUAGE sql
AS $$
  INSERT INTO refm_project_locks AS l (project_id, holder_user_id, acquired_at, heartbeat_at)
  VALUES (p_project_id, p_user_id, clock_timestamp(), clock_timestamp())
  ON CONFLICT (project_id) DO UPDATE
    SET holder_user_id = p_user_id,
        -- A steal is a NEW session, so acquired_at moves; refreshing my own
        -- lock is the same session, so it does not.
        acquired_at    = CASE WHEN l.holder_user_id = p_user_id THEN l.acquired_at ELSE clock_timestamp() END,
        heartbeat_at   = clock_timestamp(),
        -- Taking the lock clears any pending request: it was addressed to the
        -- previous holder and means nothing to the new one.
        release_requested_by = CASE WHEN l.holder_user_id = p_user_id THEN l.release_requested_by ELSE NULL END,
        release_requested_at = CASE WHEN l.holder_user_id = p_user_id THEN l.release_requested_at ELSE NULL END
    WHERE l.holder_user_id = p_user_id
       OR l.heartbeat_at < clock_timestamp() - make_interval(secs => p_ttl_seconds)
  RETURNING l.*;
$$;

COMMENT ON FUNCTION refm_acquire_project_lock(uuid, uuid, integer) IS
  'THE ONLY way an edit lock is taken. One INSERT ... ON CONFLICT DO UPDATE, so two concurrent callers serialise on the primary key and the second evaluates its WHERE against the first committed heartbeat: two waiters cannot both win. Returns nothing when the caller did not get it. A SELECT-then-UPDATE in the application would leave exactly that race (migration 233).';

COMMIT;
