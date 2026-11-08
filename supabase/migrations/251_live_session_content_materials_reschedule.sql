-- ═══════════════════════════════════════════════════════════════════════════════
-- 251: Live-course session content, materials and reschedules.
--
-- ADDITIVE. A standalone session leaves every new column empty and behaves
-- exactly as before.
--   1. Four content fields per session (overview, what you will learn as a
--      list, by the end, build with Claude).
--   2. Reschedule history on the session: rescheduled_from (the previous
--      start), rescheduled_at, and ics_sequence (bumped on every move so a
--      calendar updates the event with the same UID instead of adding one).
--   3. Materials: a PRIVATE bucket and one row per (session, file name). A
--      replacement uploads a NEW object (previous versions stay in storage,
--      listed in `versions`) and the row points at the latest, so students
--      keep the same link. Files are released to enrolled students only after
--      the session's current end time (enforced in the download route).
--   4. A reschedule log (who moved what, from when to when, how many emails).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS content_overview  TEXT,
  ADD COLUMN IF NOT EXISTS content_learn     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS content_outcome   TEXT,
  ADD COLUMN IF NOT EXISTS content_claude    TEXT,
  ADD COLUMN IF NOT EXISTS rescheduled_from  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rescheduled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ics_sequence      INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS live_session_materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  size_bytes    BIGINT,
  mime_type     TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  -- Earlier versions, newest last: [{version, storage_path, sha256, replaced_at}].
  versions      JSONB NOT NULL DEFAULT '[]'::JSONB,
  uploaded_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, file_name)
);

CREATE INDEX IF NOT EXISTS idx_live_session_materials_session ON live_session_materials (session_id);
ALTER TABLE live_session_materials ENABLE ROW LEVEL SECURITY;

-- Private: files are streamed through the release-checked download route.
INSERT INTO storage.buckets (id, name, public)
VALUES ('live-course-materials', 'live-course-materials', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS live_session_reschedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  old_start     TIMESTAMPTZ,
  new_start     TIMESTAMPTZ NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('single','following')),
  moved_by      TEXT,
  emails_sent   INTEGER NOT NULL DEFAULT 0,
  teams_updated BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_session_reschedules_session ON live_session_reschedules (session_id);
ALTER TABLE live_session_reschedules ENABLE ROW LEVEL SECURITY;
