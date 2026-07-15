-- 198_article_scheduled_publish.sql
-- Scheduled publishing for articles.
--
-- 'scheduled' has been a legal article status since 002_phase1_cms.sql (the CHECK
-- constraint already permits it, and the admin list already renders an amber
-- "scheduled" chip), but there was no timestamp to schedule against and nothing
-- that ever flipped such a row to 'published'. Choosing "Scheduled" therefore made
-- an article permanently invisible. This adds the missing timestamp; the flip is
-- done by /api/cron/publish-scheduled-articles (runs every minute).
--
-- Additive only: no existing row changes, and every reader/writer tolerates the
-- column being absent, so the repo can deploy before this is applied.

ALTER TABLE articles ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

COMMENT ON COLUMN articles.scheduled_at IS
  'When a status=scheduled article auto-publishes (UTC). Cleared on publish. Meaningless for draft/published rows.';

-- The cron polls "status = 'scheduled' AND scheduled_at <= now()" every minute.
-- A partial index keeps that tick an index probe over the handful of pending rows
-- rather than a scan of the whole articles table.
CREATE INDEX IF NOT EXISTS idx_articles_scheduled
  ON articles (scheduled_at)
  WHERE status = 'scheduled';
