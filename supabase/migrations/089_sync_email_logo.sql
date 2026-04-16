-- Migration 089: Sync email_branding logo from CMS header_settings
-- If email_branding.logo_url is empty, populate it from cms_content header_settings logo_url.

UPDATE email_branding
SET logo_url = (
  SELECT value FROM cms_content
  WHERE section = 'header_settings'
  AND key = 'logo_url'
  AND value != ''
  LIMIT 1
)
WHERE logo_url = '' OR logo_url IS NULL;
