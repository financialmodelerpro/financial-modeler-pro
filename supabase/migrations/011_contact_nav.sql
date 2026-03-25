-- Add Contact Us to site_pages nav
INSERT INTO site_pages (label, href, visible, display_order, can_toggle) VALUES
('Contact', '/contact', true, 7, true)
ON CONFLICT DO NOTHING;
