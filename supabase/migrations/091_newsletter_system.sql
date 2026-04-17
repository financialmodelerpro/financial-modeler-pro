-- Migration 091: Newsletter system with hub segmentation
-- Drop and recreate newsletter_subscribers with hub support + create campaigns table

-- Rename old table if it exists (preserve data for reference)
ALTER TABLE IF EXISTS newsletter_subscribers RENAME TO newsletter_subscribers_legacy;

-- New newsletter_subscribers: one row per email+hub
CREATE TABLE newsletter_subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  hub TEXT NOT NULL CHECK (hub IN ('training', 'modeling')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_token UUID DEFAULT gen_random_uuid(),
  source TEXT,
  UNIQUE(email, hub)
);

CREATE INDEX idx_newsletter_hub ON newsletter_subscribers(hub);
CREATE INDEX idx_newsletter_status ON newsletter_subscribers(status);
CREATE INDEX idx_newsletter_email ON newsletter_subscribers(email);
CREATE INDEX idx_newsletter_unsubscribe_token ON newsletter_subscribers(unsubscribe_token);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "newsletter_subscribers_all" ON newsletter_subscribers FOR ALL USING (true);

-- Migrate legacy subscribers into new table (all go to 'training' hub)
INSERT INTO newsletter_subscribers (email, hub, status, subscribed_at, source)
SELECT email, 'training', CASE WHEN is_active THEN 'active' ELSE 'unsubscribed' END, subscribed_at, source
FROM newsletter_subscribers_legacy
ON CONFLICT (email, hub) DO NOTHING;

-- Newsletter campaigns
CREATE TABLE newsletter_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  target_hub TEXT NOT NULL CHECK (target_hub IN ('training', 'modeling', 'all')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by TEXT
);

ALTER TABLE newsletter_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "newsletter_campaigns_all" ON newsletter_campaigns FOR ALL USING (true);
