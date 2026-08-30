-- 225_admin_campaigns.sql
--
-- Admin email campaigns to Modeling Hub users (2026-08-30). ADDITIVE ONLY:
-- two new tables and one nullable column. Nothing existing is altered.
--
--   admin_campaign_templates - the reusable, editable template set. One seed
--     row (the walkthrough invitation) is inserted here so the feature is
--     usable the moment it ships; is_seed marks it so a future seed change can
--     tell its own row from an admin's.
--
--   admin_campaign_sends - the log, ONE ROW PER RECIPIENT: who sent it, to
--     whom, which template, when, and the result. recipient_user_id is a RAW
--     uuid and the email is COPIED, deliberately not a foreign key: the log
--     has to survive the recipient being deleted, which is the same reasoning
--     as account_deletions (mig 219). campaign_id groups the rows of one send.
--
--   users.campaign_unsubscribed_at - the per-user unsubscribe, respected by
--     every future campaign. A column rather than a table because it is one
--     fact per user, and NULL (the default on every existing row) means
--     subscribed, so nothing changes for anyone until they opt out.
--
-- The unsubscribe LINK carries an HMAC of the user id (NEXTAUTH_SECRET), so no
-- token needs storing and a link cannot be forged for another user.
--
-- RLS on with no policies: service-role only, the pattern every recent table
-- here uses (public_api_audit mig 212, account_deletions mig 219).

CREATE TABLE IF NOT EXISTS admin_campaign_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  description  text,
  subject      text NOT NULL,
  body_html    text NOT NULL,
  is_seed      boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_campaign_sends (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL,
  admin_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  template_id       uuid,
  template_name     text,
  subject           text NOT NULL,
  recipient_user_id uuid,
  recipient_email   text NOT NULL,
  status            text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_unsubscribed')),
  error             text,
  message_id        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_campaign_sends_campaign
  ON admin_campaign_sends (campaign_id);
CREATE INDEX IF NOT EXISTS idx_admin_campaign_sends_created
  ON admin_campaign_sends (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_campaign_sends_recipient
  ON admin_campaign_sends (recipient_user_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS campaign_unsubscribed_at timestamptz;

ALTER TABLE admin_campaign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_campaign_sends ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN users.campaign_unsubscribed_at IS
  'Per-user opt-out of admin email campaigns (mig 225). NULL = subscribed. Set by the public unsubscribe link (HMAC-signed, no stored token); every campaign send filters on it, and an unsubscribed user is logged as skipped_unsubscribed rather than silently dropped.';

-- The seeded walkthrough invitation. ON CONFLICT DO NOTHING so re-running the
-- migration never overwrites an admin's edits to it.
INSERT INTO admin_campaign_templates (name, description, subject, body_html, is_seed)
VALUES (
  'Walkthrough invitation',
  'Offers a guided platform walkthrough with a meeting link. Uses {{name}}, {{company}} and {{meeting_link}}.',
  'A guided walkthrough of Financial Modeler Pro',
  E'<p>Hi {{name}},</p>\n<p>Thank you for creating a Financial Modeler Pro account. I would like to offer you a short guided walkthrough of the platform, so you can see how it handles a real development feasibility and investment model end to end.</p>\n<p>In about thirty minutes we can cover the modules that matter for the work you do{{company_clause}}, and answer anything you want to test before you build your first model.</p>\n<p>You can book a time that suits you here:</p>\n<p><a href="{{meeting_link}}">Book your walkthrough</a></p>\n<p>If you would rather explore on your own first, that is completely fine: your account is ready whenever you are.</p>\n<p>Best regards,<br/>Ahmad Din<br/>Financial Modeler Pro</p>',
  true
)
ON CONFLICT (name) DO NOTHING;
