-- Migration 147: completed_via provenance + video_load_at safety anchor
--
-- Background:
--   Phase 2 (migration 146) made cross-session watch progress accumulate
--   correctly. Phase 3 adds a manual override path so a student whose
--   tracker genuinely undershot can self-rescue at 50%+ instead of
--   waiting for an admin. To make that override resistant to abuse and
--   to keep the audit trail honest, two columns are added to both watch
--   history tables:
--
--   `completed_via` records HOW a row reached `status='completed'`:
--     'threshold'            -- auto-unlock at >= watch_enforcement_threshold (default 70%)
--     'manual'               -- student override at >= 50% with elapsed-time check
--     'admin_override'       -- admin force-unlock from the students panel (Phase 4)
--     'auto_recovery_2026_04' -- one-shot recovery sweep for the 4 stuck students (Phase 5)
--   Null on in_progress rows and on legacy rows that completed before
--   this migration shipped. Existing readers ignore the column, so
--   adding it is a non-breaking change.
--
--   `video_load_at` is server-stamped on the FIRST progress POST per
--   row (when the column is null). The manual override path requires
--   `now() - video_load_at >= total_seconds * 0.8` so a student cannot
--   open the page, scrub to 50%, and immediately override -- they have
--   to keep the page open for ~80% of the video's actual duration in
--   real wall-clock time. Server-set means clock-tampered clients
--   cannot advance it.
--
-- Backwards compatibility:
--   `ADD COLUMN IF NOT EXISTS` on both columns. Pre-147 rows have null
--   in both fields. The Phase 3 application code treats:
--     - `completed_via IS NULL AND status='completed'`  ->  legacy
--       (treat as 'threshold' for display purposes; recovery rows
--       set the column explicitly).
--     - `video_load_at IS NULL`                         ->  manual
--       override unavailable (the elapsed-time anchor doesn't exist
--       yet); the row will be stamped on the next progress POST.
--
--   Idempotent. Safe to re-run.

ALTER TABLE certification_watch_history
  ADD COLUMN IF NOT EXISTS completed_via TEXT,
  ADD COLUMN IF NOT EXISTS video_load_at TIMESTAMPTZ;

ALTER TABLE session_watch_history
  ADD COLUMN IF NOT EXISTS completed_via TEXT,
  ADD COLUMN IF NOT EXISTS video_load_at TIMESTAMPTZ;

COMMENT ON COLUMN certification_watch_history.completed_via IS
  'How the row reached completed status. Values: threshold (auto >=70%), manual (student override at >=50% + elapsed-time check), admin_override (admin force-unlock), auto_recovery_2026_04 (one-shot sweep). Null on in_progress + legacy rows.';

COMMENT ON COLUMN certification_watch_history.video_load_at IS
  'Server-stamped on first progress POST per row. Anchors the manual override elapsed-time safety check (now - video_load_at must be >= total_seconds * 0.8).';

COMMENT ON COLUMN session_watch_history.completed_via IS
  'See certification_watch_history.completed_via.';

COMMENT ON COLUMN session_watch_history.video_load_at IS
  'See certification_watch_history.video_load_at.';
