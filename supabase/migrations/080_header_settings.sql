-- ============================================================
-- 080: Seed header_settings into cms_content
-- Centralizes all header/logo/branding text controls
-- ============================================================

INSERT INTO cms_content (section, key, value) VALUES
  ('header_settings', 'logo_enabled', 'true'),
  ('header_settings', 'logo_url', ''),
  ('header_settings', 'logo_width_px', ''),
  ('header_settings', 'logo_height_px', '36'),
  ('header_settings', 'logo_position', 'left'),
  ('header_settings', 'show_brand_name', 'true'),
  ('header_settings', 'brand_name', 'Financial Modeler Pro'),
  ('header_settings', 'show_tagline', 'true'),
  ('header_settings', 'tagline', 'Structured Modeling. Real-World Finance.'),
  ('header_settings', 'icon_url', ''),
  ('header_settings', 'icon_as_favicon', 'false'),
  ('header_settings', 'icon_in_header', 'false'),
  ('header_settings', 'icon_size_px', '20'),
  ('header_settings', 'header_height_px', ''),
  ('header_settings', 'header_padding_top_px', ''),
  ('header_settings', 'header_padding_bottom_px', '')
ON CONFLICT (section, key) DO NOTHING;

-- Migrate existing logo if admin already uploaded one via branding page
UPDATE cms_content
SET value = (
  SELECT value FROM cms_content
  WHERE section = 'branding' AND key = 'logo_url' AND value != ''
  LIMIT 1
)
WHERE section = 'header_settings'
  AND key = 'logo_url'
  AND EXISTS (
    SELECT 1 FROM cms_content
    WHERE section = 'branding' AND key = 'logo_url' AND value != ''
  );
