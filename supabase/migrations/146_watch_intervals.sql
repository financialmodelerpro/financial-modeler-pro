-- Migration 146: Persist watch intervals across sessions (smoking-gun fix)
--
-- Background:
--   The pre-146 schema persisted only `watch_seconds` (a scalar) plus the
--   wall-clock anti-tamper helpers. The interval-merging tracker
--   (src/lib/training/watchTracker.ts) reconstructs watched-seconds from
--   `[start, end]` intervals in memory, but those intervals were thrown
--   away on unmount. On a return visit the tracker was seeded with
--   `baseline = persisted_watch_seconds` and `intervals = []`. Because
--   `watchedSeconds() = max(baseline, sumNew + open)` only ever takes the
--   LARGER of baseline OR the new contiguous run, a student whose first
--   sitting watched 0 to 46% and whose later sittings watched
--   non-overlapping chunks like 46-60% and 60-100% would stay frozen at
--   46% forever -- the new contiguous runs are individually shorter than
--   the baseline and the cross-session union never happens.
--
--   This migration fixes the persistence side: store the actual intervals
--   so the union really happens. Combined with the application-side
--   changes in the same commit (re-seed tracker from the JSONB on mount,
--   POST snapshot intervals every report, server-side union before
--   deriving watch_seconds), multi-session watch progress finally
--   accumulates correctly.
--
-- Backwards compatibility:
--   Pre-146 rows have `watch_intervals = '[]'::jsonb` after this migration
--   runs. The application code treats an empty array as "trust the legacy
--   scalar baseline" -- so a student mid-course doesn't lose their
--   existing watch_seconds. The first POST after deploy seeds the
--   intervals JSONB with a real snapshot; from then on cross-session
--   union works as designed.
--
--   Idempotent (`ADD COLUMN IF NOT EXISTS`). Safe to re-run.

ALTER TABLE certification_watch_history
  ADD COLUMN IF NOT EXISTS watch_intervals JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE session_watch_history
  ADD COLUMN IF NOT EXISTS watch_intervals JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN certification_watch_history.watch_intervals IS
  'JSONB array of [start, end] tuples (seconds). Persisting these across sessions is what makes multi-session watch% accumulate. Pre-migration rows default to [] and the legacy watch_seconds scalar is preserved as a floor.';

COMMENT ON COLUMN session_watch_history.watch_intervals IS
  'JSONB array of [start, end] tuples (seconds). See certification_watch_history.watch_intervals for the rationale.';
