-- ─────────────────────────────────────────────────────────────────────────────
-- 015_contact_nav_email.sql
-- 1. Ensure Contact row exists in site_pages (visible=false by default)
-- 2. Update contact email in cms_content
-- ─────────────────────────────────────────────────────────────────────────────

-- Insert Contact nav item if it doesn't already exist
INSERT INTO site_pages (label, href, visible, display_order, can_toggle)
SELECT 'Contact', '/contact', false, 7, true
WHERE NOT EXISTS (
  SELECT 1 FROM site_pages WHERE label = 'Contact' OR href = '/contact'
);

-- If a Contact row already exists (from migration 011), ensure visible=false
-- and can_toggle=true so admin can control it
UPDATE site_pages
SET visible = false, can_toggle = true, display_order = 7
WHERE (label = 'Contact' OR href = '/contact');

-- Update contact email in cms_content (upsert so it works even if never set)
INSERT INTO cms_content (section, key, value)
VALUES ('contact', 'email', 'meetahmadch@gmail.com')
ON CONFLICT (section, key) DO UPDATE SET value = 'meetahmadch@gmail.com';
