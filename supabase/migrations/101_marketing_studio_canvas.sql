-- Migration 101: Marketing Studio Phase 1.5 — flexible canvas editor
-- Adds element-based design storage to marketing_designs.
-- Adds multiple-image support to marketing_brand_kit.

-- Element-based design storage (canvas editor data)
ALTER TABLE marketing_designs ADD COLUMN IF NOT EXISTS dimensions JSONB DEFAULT '{"width": 1280, "height": 720}'::jsonb;
ALTER TABLE marketing_designs ADD COLUMN IF NOT EXISTS background JSONB DEFAULT '{"type": "color", "color": "#1B4F72"}'::jsonb;
ALTER TABLE marketing_designs ADD COLUMN IF NOT EXISTS elements JSONB DEFAULT '[]'::jsonb;
-- content column kept for backward compat with old template-based designs

-- Brand kit: multi-image libraries
ALTER TABLE marketing_brand_kit ADD COLUMN IF NOT EXISTS additional_logos JSONB DEFAULT '[]'::jsonb;
ALTER TABLE marketing_brand_kit ADD COLUMN IF NOT EXISTS additional_photos JSONB DEFAULT '[]'::jsonb;
ALTER TABLE marketing_brand_kit ADD COLUMN IF NOT EXISTS uploaded_images JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN marketing_designs.elements IS 'Array of CanvasElement (text/image/shape) with absolute positioning';
COMMENT ON COLUMN marketing_designs.background IS 'CanvasBackground: solid color, gradient, or image with optional overlay';
COMMENT ON COLUMN marketing_brand_kit.additional_logos IS 'Array of {url, name} — extra logo variants beyond primary + light';
COMMENT ON COLUMN marketing_brand_kit.additional_photos IS 'Array of {url, name} — extra photos beyond founder_photo_url';
COMMENT ON COLUMN marketing_brand_kit.uploaded_images IS 'Library of uploaded images available for re-use across designs: [{url, name, uploaded_at}]';
