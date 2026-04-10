-- Site-wide settings for CMS-driven header, footer, colors, typography, SEO
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default settings
INSERT INTO site_settings (key, value) VALUES
  ('header', '{
    "logo_url": "",
    "logo_width": 140,
    "logo_position": "left",
    "logo_link_url": "/",
    "tagline_text": "",
    "tagline_size": 12,
    "tagline_color": "#6B7280",
    "tagline_position": "beside",
    "bg_color": "#ffffff",
    "text_color": "#0D2E5A",
    "cta_text": "",
    "cta_url": "",
    "cta_color": "#2EAA4A",
    "cta_visible": false,
    "sticky": true,
    "height": 64
  }'::jsonb),
  ('footer', '{
    "logo_url": "",
    "bg_color": "#0A1F3D",
    "text_color": "#ffffff",
    "copyright": "© {year} Financial Modeler Pro. All rights reserved.",
    "columns": [
      {"heading": "Platform", "links": [{"label": "Modeling Hub", "url": "https://app.financialmodelerpro.com"}, {"label": "Training Hub", "url": "https://learn.financialmodelerpro.com"}, {"label": "Articles", "url": "/articles"}]},
      {"heading": "Company", "links": [{"label": "About", "url": "/about"}, {"label": "Pricing", "url": "/pricing"}, {"label": "Contact", "url": "/contact"}]}
    ],
    "social": {"twitter": "", "linkedin": "", "youtube": "", "instagram": "", "facebook": ""},
    "show_logo": true,
    "show_social": true,
    "show_copyright": true
  }'::jsonb),
  ('colors', '{
    "primary": "#2EAA4A",
    "secondary": "#0D2E5A",
    "font_family": "Inter",
    "base_font_size": 16,
    "heading_font_weight": 800
  }'::jsonb),
  ('seo', '{
    "title_template": "{page} | Financial Modeler Pro",
    "default_description": "Professional financial modeling tools and training for analysts, developers, and investment professionals.",
    "google_analytics_id": "",
    "google_tag_manager_id": "",
    "facebook_pixel_id": "",
    "head_code": "",
    "body_code": "",
    "favicon_url": ""
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
