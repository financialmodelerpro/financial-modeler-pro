-- ═══════════════════════════════════════════════════════════════════════════════
-- 142: Marketing Studio rebuild (Training Hub edition)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Replaces the Phase 1.5 canvas editor (migrations 100-102) with a focused
-- 4-template Training Hub admin tool: LinkedIn banners, live-session banners,
-- YouTube thumbnails, article banners. All output is rendered server-side via
-- next/og ImageResponse against fixed templates - no canvas state to persist.
--
-- Drops the old canvas-state tables (marketing_designs, marketing_brand_kit)
-- and adds one new table for the uploaded-background asset library.
--
-- Brand pack (logo, primary color, default trainer photo + name + credentials)
-- is now sourced live from email_branding + cms_content.header_settings +
-- the default row of the instructors table - no separate brand_kit row.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Drop old Phase 1.5 tables ──────────────────────────────────────────────
DROP TABLE IF EXISTS marketing_designs CASCADE;
DROP TABLE IF EXISTS marketing_brand_kit CASCADE;

-- ── New: uploaded background asset library ─────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_uploaded_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  url         TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  file_size   INTEGER NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  uploaded_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_assets_created
  ON marketing_uploaded_assets(created_at DESC);

COMMENT ON TABLE marketing_uploaded_assets IS
  'Reusable background images uploaded by admins for the Training Hub Marketing Studio. Files live in the marketing-assets storage bucket; this table is the metadata index.';

-- ── Storage bucket: marketing-assets (public-read) ─────────────────────────
-- Idempotent: pre-existing bucket left alone.
INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-assets', 'marketing-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read policy (so satori can fetch the image when rendering)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'marketing-assets public read'
  ) THEN
    CREATE POLICY "marketing-assets public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'marketing-assets');
  END IF;
END
$$;
