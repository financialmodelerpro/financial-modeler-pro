-- ═══════════════════════════════════════════════════════════════════════════════
-- 249: Live course status, enrolment switch, public details, images, time zones.
--
-- ADDITIVE. `status` replaces `is_public` as the visibility rule:
--   draft      hidden from the public page, public APIs, sitemap, newsletter;
--              registration closed; admin preview link only
--   published  course card and course page are public
--   archived   hidden publicly; enrolled students keep their access
-- Backfill: is_public = true -> published (REFM), else draft (TEST).
-- `is_public` is KEPT (deprecated, read by nothing after this release) so the
-- previous deploy keeps working if this is applied before the new code ships.
-- `time_zones` NULL means the default region list in code.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE training_course_settings
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  ADD COLUMN IF NOT EXISTS enrolment_open  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tagline         TEXT,
  ADD COLUMN IF NOT EXISTS who_for         TEXT,
  ADD COLUMN IF NOT EXISTS prerequisites   TEXT,
  ADD COLUMN IF NOT EXISTS trainer_name    TEXT,
  ADD COLUMN IF NOT EXISTS trainer_title   TEXT,
  ADD COLUMN IF NOT EXISTS banner_url      TEXT,
  ADD COLUMN IF NOT EXISTS banner_alt      TEXT,
  ADD COLUMN IF NOT EXISTS card_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS card_image_alt  TEXT,
  ADD COLUMN IF NOT EXISTS time_zones      TEXT[],
  ADD COLUMN IF NOT EXISTS published_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ;

-- Status from the old flag, once (a row already moved off draft is left alone).
UPDATE training_course_settings
   SET status = 'published', published_at = COALESCE(published_at, now())
 WHERE is_public = true AND status = 'draft';

COMMENT ON COLUMN training_course_settings.status IS
  'draft | published | archived (mig 249). The ONE public-visibility rule; enrolled students keep access in every status.';
COMMENT ON COLUMN training_course_settings.is_public IS
  'DEPRECATED by status (mig 249). Kept for the previous deploy only; read by nothing.';
COMMENT ON COLUMN training_course_settings.time_zones IS
  'IANA zones shown in the time zone table, in order. NULL = the default region list in code.';

-- A session's own banner alt text (the banner itself is live_sessions.banner_url).
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS banner_alt TEXT;

-- Per-session completion cards (the same achievement card single sessions
-- use, issued when a session's rule is met). On by default. Re-running this
-- file is safe: every statement is IF NOT EXISTS or only moves draft rows.
ALTER TABLE training_course_settings
  ADD COLUMN IF NOT EXISTS session_certificates BOOLEAN NOT NULL DEFAULT true;
