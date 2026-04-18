-- Migration 102: Marketing Studio — background library + aspect ratio prep
-- Adds reusable background library to brand kit.
-- (Aspect-ratio lock is element-level, stored inside marketing_designs.elements jsonb — no schema change needed.)

ALTER TABLE marketing_brand_kit ADD COLUMN IF NOT EXISTS background_library JSONB DEFAULT '[]'::jsonb;

-- Seed one default FMP brand background placeholder. Admin can upload the
-- actual image via Brand Kit → Backgrounds; brand-typed entries aren't deletable
-- in the UI but the URL can be swapped.
UPDATE marketing_brand_kit SET background_library = '[
  {
    "id": "fmp-navy-default",
    "name": "FMP Dark Navy",
    "url": "",
    "thumbnail": "",
    "type": "brand"
  }
]'::jsonb
WHERE id = 1
  AND (background_library IS NULL OR jsonb_array_length(background_library) = 0);

COMMENT ON COLUMN marketing_brand_kit.background_library IS 'Reusable background images: [{id, name, url, thumbnail, type: brand|custom}]';
