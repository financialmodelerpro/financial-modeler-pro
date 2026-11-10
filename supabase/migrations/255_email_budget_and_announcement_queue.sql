-- ═══════════════════════════════════════════════════════════════════════════════
-- 255: Daily email budget and the announcement queue (2026-11-10, founder).
--
-- The Brevo free plan sends 300 emails a day, shared by EVERY email the
-- platform sends. Announcements may use at most a set number a day (setting
-- announcement_daily_cap, default 200), leaving room for system emails
-- (enrolment, reminders, reschedule, certificates), which always go first.
--
--   1. email_usage_daily: emails sent per UTC day, split system / announcement,
--      incremented atomically by increment_email_usage() from the one send
--      path (src/shared/email/sendEmail.ts, emailBudget.ts).
--   2. announcement_jobs + announcement_job_items: an announcement's recipients
--      beyond today's allowance wait here and are sent the next day, oldest
--      job first (src/hubs/training/lib/announcements/queue.ts), with progress
--      shown in admin.
--
-- ADDITIVE. Until this runs the code still sends what today's budget allows
-- and reports the rest as not sent (it never queues, never fails a send).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_usage_daily (
  day   DATE    NOT NULL,
  kind  TEXT    NOT NULL CHECK (kind IN ('system', 'announcement')),
  sent  INTEGER NOT NULL DEFAULT 0 CHECK (sent >= 0),
  PRIMARY KEY (day, kind)
);
ALTER TABLE email_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_email_usage(p_day DATE, p_kind TEXT, p_n INTEGER)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO email_usage_daily (day, kind, sent) VALUES (p_day, p_kind, GREATEST(p_n, 0))
  ON CONFLICT (day, kind) DO UPDATE SET sent = email_usage_daily.sent + GREATEST(EXCLUDED.sent, 0);
$$;
REVOKE ALL ON FUNCTION increment_email_usage(DATE, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS announcement_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          TEXT NOT NULL CHECK (kind IN ('session', 'course')),
  ref           TEXT NOT NULL,                 -- session id or course code
  label         TEXT NOT NULL DEFAULT '',      -- shown in admin
  audience      JSONB NOT NULL DEFAULT '{}'::JSONB,
  subject       TEXT NOT NULL,
  html          TEXT NOT NULL,                 -- {{name}} replaced per recipient
  from_address  TEXT,
  created_by    TEXT,
  total         INTEGER NOT NULL DEFAULT 0,
  sent          INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done')),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_announcement_jobs_status ON announcement_jobs (status, created_at);
ALTER TABLE announcement_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS announcement_job_items (
  id        BIGSERIAL PRIMARY KEY,
  job_id    UUID NOT NULL REFERENCES announcement_jobs(id) ON DELETE CASCADE,
  email     TEXT NOT NULL,
  name      TEXT,
  status    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at   TIMESTAMPTZ,
  error     TEXT,
  UNIQUE (job_id, email)
);
CREATE INDEX IF NOT EXISTS idx_announcement_job_items_pending ON announcement_job_items (job_id, status, id);
ALTER TABLE announcement_job_items ENABLE ROW LEVEL SECURITY;
