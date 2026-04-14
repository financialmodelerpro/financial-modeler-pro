-- ============================================================
-- 078: Newsletter subscribers table for articles page
-- Articles table already has: featured, category, cover_url, body
-- ============================================================

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'articles',
  is_active BOOLEAN DEFAULT true,
  subscribed_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access newsletter" ON newsletter_subscribers FOR ALL USING (true);
