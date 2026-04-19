-- 115_share_mention_settings.sql
-- Admin-editable brand + founder @-mention text used by the share-template
-- render engine. Previously hardcoded as FOUNDER_HANDLE/BRAND_HANDLE in
-- src/lib/training/shareTemplates.ts — now driven from training_settings
-- so admins can rotate LinkedIn handles without a code change.

INSERT INTO training_settings (key, value) VALUES
  ('share_brand_mention',   'FinancialModelerPro'),
  ('share_founder_mention', 'Ahmad Din, ACCA, FMVA®')
ON CONFLICT (key) DO NOTHING;
