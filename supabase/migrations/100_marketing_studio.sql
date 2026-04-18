-- Migration 100: Marketing Studio — Foundation + 3 Templates
-- Creates storage for saved designs + brand kit singleton.

-- Saved designs (YouTube thumbnails, LinkedIn posts, Instagram posts)
CREATE TABLE IF NOT EXISTS marketing_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_type TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_captions JSONB DEFAULT '{}'::jsonb,
  preview_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_marketing_designs_template ON marketing_designs(template_type);
CREATE INDEX IF NOT EXISTS idx_marketing_designs_created ON marketing_designs(created_at DESC);

-- Brand kit — single row (logos, colors, fonts shared across all templates)
CREATE TABLE IF NOT EXISTS marketing_brand_kit (
  id INTEGER PRIMARY KEY DEFAULT 1,
  logo_url TEXT,
  logo_light_url TEXT,
  founder_photo_url TEXT,
  primary_color TEXT DEFAULT '#1B4F72',
  secondary_color TEXT DEFAULT '#2DD4BF',
  accent_color TEXT DEFAULT '#F59E0B',
  text_color_dark TEXT DEFAULT '#1F2937',
  text_color_light TEXT DEFAULT '#FFFFFF',
  font_family TEXT DEFAULT 'Inter',
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO marketing_brand_kit (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE marketing_designs IS 'Saved marketing design drafts (thumbnails, social posts) — rendered via Satori on demand';
COMMENT ON TABLE marketing_brand_kit IS 'Single-row brand kit — logos, colors, fonts shared across Marketing Studio templates';
