-- ============================================================
-- 074: Add modeling_hub_coming_soon setting
-- When 'true': signin/register show coming soon page
-- When 'false': normal signin/register work
-- ============================================================

INSERT INTO training_settings (key, value)
VALUES ('modeling_hub_coming_soon', 'true')
ON CONFLICT (key) DO NOTHING;
