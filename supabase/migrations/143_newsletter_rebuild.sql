-- ═══════════════════════════════════════════════════════════════════════════════
-- 143: Newsletter system rebuild
--
-- Three additions for the comprehensive newsletter rebuild (2026-04-27):
--
--   1. newsletter_templates - admin-editable subject + body library. Replaces
--      the two diverging hardcoded copies (generateContent in NewsletterTab,
--      generateEmail in autoNotify) with a single source of truth. The 6
--      seeded rows mirror the hardcoded content exactly so behavior does
--      not change for existing event types until an admin edits.
--
--   2. newsletter_recipient_log - per-(campaign, email) row that captures
--      delivery status + Resend message_id + open/click timestamps. Mirrors
--      the announcement_recipient_log pattern from migration 138. Unblocks
--      retry-failed, real send-count under partial failure, and Resend
--      webhook event handling.
--
--   3. newsletter_campaigns gains scheduled_at + segment columns to support
--      the new schedule-for-later flow and beyond-hub recipient targeting.
--      `status` CHECK extended with 'scheduled' and 'cancelled'.
--
-- Idempotent throughout (IF NOT EXISTS / DO NOTHING / DROP CONSTRAINT IF
-- EXISTS) so re-running this migration is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. newsletter_templates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS newsletter_templates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key      TEXT        NOT NULL UNIQUE,
  name              TEXT        NOT NULL,
  subject_template  TEXT        NOT NULL,
  body_html         TEXT        NOT NULL,
  event_type        TEXT,                                -- nullable: only set for auto-notify rows
  active            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_templates_event ON newsletter_templates (event_type) WHERE event_type IS NOT NULL;

ALTER TABLE newsletter_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "newsletter_templates_all" ON newsletter_templates;
CREATE POLICY "newsletter_templates_all" ON newsletter_templates FOR ALL USING (true);

-- Seed the 6 hardcoded templates. The generateContent (manual compose) and
-- generateEmail (auto-notify) implementations diverged slightly in markup;
-- we standardize on the auto-notify version with the gold-button CTA which
-- is the more polished of the two. {variables} are interpolated at send
-- time by the shared template engine in src/lib/newsletter/templates.ts.
INSERT INTO newsletter_templates (template_key, name, subject_template, body_html, event_type) VALUES
  (
    'article_published',
    'New Article Published',
    'New Article: {title}',
    '<h2>{title}</h2><p>{description}</p><p><a href="{url}" style="display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;">Read Article &rarr;</a></p>',
    'article_published'
  ),
  (
    'live_session_scheduled',
    'Live Session Announcement',
    'Upcoming Live Session: {title}',
    '<h2>{title}</h2><p>{description}</p><p><strong>Date:</strong> {date}</p><p><strong>Time:</strong> {time}</p><p><strong>Platform:</strong> {platform}</p><p><a href="{url}" style="display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;">Register &rarr;</a></p>',
    'live_session_scheduled'
  ),
  (
    'live_session_recording',
    'Recording Available',
    'Recording Available: {title}',
    '<h2>Recording Now Available</h2><p>The recording for <strong>{title}</strong> is now available.</p><p>{description}</p><p><a href="{url}" style="display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;">Watch Recording &rarr;</a></p>',
    'live_session_recording'
  ),
  (
    'new_course_session',
    'New Course Session Released',
    'New Session Released: {title}',
    '<h2>{title}</h2><p>Part of the <strong>{course}</strong> course.</p><p>{description}</p><p><a href="{url}" style="display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;">Start Learning &rarr;</a></p>',
    'new_course_session'
  ),
  (
    'platform_launch',
    'Platform Launch',
    'Now Live: {title}',
    '<h2>{title}</h2><p>{description}</p><p><a href="{url}" style="display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;">Try It Now &rarr;</a></p>',
    'platform_launch'
  ),
  (
    'new_modeling_module',
    'New Modeling Module',
    'New Module: {title}',
    '<h2>{title}</h2><p>{description}</p><p><a href="{url}" style="display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;">Open Module &rarr;</a></p>',
    'new_modeling_module'
  )
ON CONFLICT (template_key) DO NOTHING;

-- ── 2. newsletter_recipient_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS newsletter_recipient_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID        NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  email             TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed', 'bounced', 'complained', 'opened', 'clicked')),
  resend_message_id TEXT,
  error_message     TEXT,
  sent_at           TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ,
  clicked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_recipient_log_campaign ON newsletter_recipient_log (campaign_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_recipient_log_msgid ON newsletter_recipient_log (resend_message_id) WHERE resend_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_recipient_log_failed ON newsletter_recipient_log (campaign_id) WHERE status IN ('failed', 'bounced');

ALTER TABLE newsletter_recipient_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "newsletter_recipient_log_all" ON newsletter_recipient_log;
CREATE POLICY "newsletter_recipient_log_all" ON newsletter_recipient_log FOR ALL USING (true);

-- ── 3. newsletter_campaigns: scheduled_at + segment + status check extension ──
ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'all_active';

-- Drop and re-add the status CHECK to include 'scheduled' and 'cancelled'.
-- The constraint name was generated by Postgres (newsletter_campaigns_status_check
-- by convention). DROP CONSTRAINT IF EXISTS makes the migration safe to
-- re-run.
ALTER TABLE newsletter_campaigns DROP CONSTRAINT IF EXISTS newsletter_campaigns_status_check;
ALTER TABLE newsletter_campaigns ADD CONSTRAINT newsletter_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_scheduled
  ON newsletter_campaigns (scheduled_at) WHERE status = 'scheduled';
