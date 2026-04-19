-- 116_share_prefix_at_settings.sql
-- Admin-controlled toggles for prefixing `@` on the {@brand} / {@founder}
-- placeholders in share templates. Both default OFF — plain text.
-- Previously the per-template `mention_brand` / `mention_founder` booleans
-- in `share_templates` forced an `@` prefix; this migration moves the
-- control to global settings so admins can flip the behavior across every
-- template without re-saving each row.

INSERT INTO training_settings (key, value) VALUES
  ('share_brand_prefix_at',   'false'),
  ('share_founder_prefix_at', 'false')
ON CONFLICT (key) DO NOTHING;
