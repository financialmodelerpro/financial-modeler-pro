-- Migration 092: Auto newsletter notifications

-- Auto-notification settings
CREATE TABLE IF NOT EXISTS newsletter_auto_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  target_hub TEXT NOT NULL CHECK (target_hub IN ('training', 'modeling', 'all')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE newsletter_auto_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "newsletter_auto_settings_all" ON newsletter_auto_settings FOR ALL USING (true);

-- Seed default settings (all disabled)
INSERT INTO newsletter_auto_settings (event_type, enabled, target_hub) VALUES
  ('article_published', false, 'all'),
  ('live_session_scheduled', false, 'training'),
  ('live_session_recording', false, 'training'),
  ('new_course_session', false, 'training'),
  ('platform_launch', false, 'modeling'),
  ('new_modeling_module', false, 'modeling')
ON CONFLICT (event_type) DO NOTHING;

-- Add source tracking to campaigns
ALTER TABLE newsletter_campaigns
  ADD COLUMN IF NOT EXISTS campaign_type TEXT DEFAULT 'manual' CHECK (campaign_type IN ('manual', 'auto')),
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT;

-- Prevent duplicate auto-sends for same content
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_auto_unique
  ON newsletter_campaigns(source_type, source_id)
  WHERE campaign_type = 'auto';
