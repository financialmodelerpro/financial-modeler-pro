-- ============================================================================
-- Migration 097 — Backfill TwoPlatforms VF keys into nested array items
-- ----------------------------------------------------------------------------
-- Phase 2B fix. Prior admin stored VF keys (visibility, width, alignment) for
-- per-column fields at the TOP LEVEL of the section content (e.g.
-- content.col0_desc_align), while the actual text lived at
-- content.columns[0].description. The frontend could not correlate them, so
-- all per-column VF controls on the Two Platforms section were ghost UI.
--
-- This migration moves any pre-existing col{i}_{field}_{align|width|visible}
-- keys from the top level into the matching columns[i] object, renaming them
-- to {field}_{align|width|visible}. CmsField on the frontend reads the VF
-- suffixes directly from the array item when the item is passed as content.
--
-- Safe to re-run: keys that don't exist are treated as NULL and skipped by
-- jsonb concat. The cleanup `content - key` calls are no-ops when absent.
-- ============================================================================

DO $$
DECLARE
  rec RECORD;
  new_columns jsonb;
  idx int;
  col jsonb;
  patched jsonb;
  prefixes text[] := ARRAY['col0', 'col1', 'col2', 'col3'];
  fields   text[] := ARRAY['title', 'desc', 'features', 'cta'];
  field_target text;
  prefix text;
  fld text;
  top_key text;
BEGIN
  FOR rec IN
    SELECT id, content
    FROM page_sections
    WHERE section_type = 'columns'
      AND content ? 'columns'
      AND (
        content ? 'col0_desc_align' OR content ? 'col0_desc_width' OR content ? 'col0_desc_visible' OR
        content ? 'col0_title_align' OR content ? 'col0_title_width' OR content ? 'col0_title_visible' OR
        content ? 'col1_desc_align' OR content ? 'col1_desc_width' OR content ? 'col1_desc_visible' OR
        content ? 'col1_title_align' OR content ? 'col1_title_width' OR content ? 'col1_title_visible'
      )
  LOOP
    new_columns := '[]'::jsonb;

    FOR idx IN 0 .. jsonb_array_length(rec.content->'columns') - 1 LOOP
      col := rec.content->'columns'->idx;
      patched := col;
      prefix := 'col' || idx::text;

      -- For each field name group, map `col{i}_{field}_{suffix}` → item-level
      -- `{target}_{suffix}` where `desc` → `description`, `cta` → `ctaText`.
      FOREACH fld IN ARRAY fields LOOP
        field_target := CASE fld
          WHEN 'desc' THEN 'description'
          WHEN 'cta'  THEN 'ctaText'
          ELSE fld
        END;

        -- _align
        top_key := prefix || '_' || fld || '_align';
        IF rec.content ? top_key THEN
          patched := patched || jsonb_build_object(field_target || '_align', rec.content->>top_key);
        END IF;

        -- _width
        top_key := prefix || '_' || fld || '_width';
        IF rec.content ? top_key THEN
          patched := patched || jsonb_build_object(field_target || '_width', rec.content->>top_key);
        END IF;

        -- _visible (store boolean, default true when absent)
        top_key := prefix || '_' || fld || '_visible';
        IF rec.content ? top_key THEN
          patched := patched || jsonb_build_object(
            field_target || '_visible',
            (rec.content->top_key)::boolean
          );
        END IF;
      END LOOP;

      new_columns := new_columns || jsonb_build_array(patched);
    END LOOP;

    -- Strip legacy top-level keys + write back the patched columns array
    UPDATE page_sections
    SET content = (
      (rec.content
        - 'col0_title_align' - 'col0_title_width' - 'col0_title_visible'
        - 'col0_desc_align'  - 'col0_desc_width'  - 'col0_desc_visible'
        - 'col0_features_align' - 'col0_features_width' - 'col0_features_visible'
        - 'col0_cta_align'   - 'col0_cta_width'   - 'col0_cta_visible'
        - 'col1_title_align' - 'col1_title_width' - 'col1_title_visible'
        - 'col1_desc_align'  - 'col1_desc_width'  - 'col1_desc_visible'
        - 'col1_features_align' - 'col1_features_width' - 'col1_features_visible'
        - 'col1_cta_align'   - 'col1_cta_width'   - 'col1_cta_visible'
        - 'col2_title_align' - 'col2_title_width' - 'col2_title_visible'
        - 'col2_desc_align'  - 'col2_desc_width'  - 'col2_desc_visible'
        - 'col2_features_align' - 'col2_features_width' - 'col2_features_visible'
        - 'col2_cta_align'   - 'col2_cta_width'   - 'col2_cta_visible'
        - 'col3_title_align' - 'col3_title_width' - 'col3_title_visible'
        - 'col3_desc_align'  - 'col3_desc_width'  - 'col3_desc_visible'
        - 'col3_features_align' - 'col3_features_width' - 'col3_features_visible'
        - 'col3_cta_align'   - 'col3_cta_width'   - 'col3_cta_visible'
      )
      || jsonb_build_object('columns', new_columns)
    ),
    updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END $$;
