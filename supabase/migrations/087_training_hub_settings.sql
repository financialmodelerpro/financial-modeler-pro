-- 087: Training Hub CMS settings
INSERT INTO cms_content (section, key, value)
VALUES ('training_hub', 'live_sessions_label', 'Live Sessions')
ON CONFLICT (section, key) DO NOTHING;
