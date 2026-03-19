-- Site Pages table — controls nav links visibility and labels
CREATE TABLE IF NOT EXISTS site_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  href          text NOT NULL,
  visible       boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  can_toggle    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE site_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read site_pages" ON site_pages;
CREATE POLICY "Public read site_pages" ON site_pages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write site_pages" ON site_pages;
CREATE POLICY "Admin write site_pages" ON site_pages FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

INSERT INTO site_pages (label, href, visible, display_order, can_toggle) VALUES
('Home',             '/',         true,  1, false),
('Modeling Hub',     '#modules',  true,  2, true),
('Training Academy', '/training', true,  3, true),
('Articles',         '/articles', true,  4, true),
('About',            '/about',    true,  5, true),
('Pricing',          '#pricing',  true,  6, true)
ON CONFLICT DO NOTHING;
