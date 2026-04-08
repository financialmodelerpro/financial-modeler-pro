-- ============================================================
-- 034: Live Sessions & Playlists
-- Live/upcoming/recorded training sessions with email notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS live_playlists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  thumbnail_url text,
  display_order int NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   text NOT NULL,
  description             text,
  youtube_url             text,
  live_url                text,
  session_type            text NOT NULL DEFAULT 'recorded',  -- 'upcoming', 'live', 'recorded'
  scheduled_datetime      timestamptz,
  timezone                text DEFAULT 'Asia/Riyadh',
  category                text,
  playlist_id             uuid REFERENCES live_playlists(id) ON DELETE SET NULL,
  is_published            boolean NOT NULL DEFAULT false,
  display_order           int NOT NULL DEFAULT 0,
  notification_sent       boolean NOT NULL DEFAULT false,
  notification_sent_at    timestamptz,
  notification_sent_count int NOT NULL DEFAULT 0,
  reminder_sent           boolean NOT NULL DEFAULT false,
  reminder_sent_at        timestamptz,
  reminder_sent_count     int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_sessions_type ON live_sessions (session_type, is_published);
CREATE INDEX idx_live_sessions_playlist ON live_sessions (playlist_id);
