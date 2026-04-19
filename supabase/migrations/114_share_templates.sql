-- 114_share_templates.sql
-- Centralized share-message templates. All share buttons (certificate verify,
-- dashboard cert card, achievement cards, assessment passes, live session
-- watched, generic session share) resolve their text through this table.

BEGIN;

CREATE TABLE IF NOT EXISTS share_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  template_text   TEXT NOT NULL,
  hashtags        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  mention_brand   BOOLEAN NOT NULL DEFAULT TRUE,
  mention_founder BOOLEAN NOT NULL DEFAULT TRUE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at auto-bump on every UPDATE
CREATE OR REPLACE FUNCTION set_share_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_share_templates_updated_at ON share_templates;
CREATE TRIGGER trg_share_templates_updated_at
  BEFORE UPDATE ON share_templates
  FOR EACH ROW EXECUTE FUNCTION set_share_templates_updated_at();

-- Seed defaults. Idempotent — re-running the migration skips rows that
-- already exist (admins can edit them without being overwritten).
INSERT INTO share_templates (template_key, title, template_text, hashtags, mention_brand, mention_founder, active)
VALUES
  (
    'certificate_earned',
    'Certificate Earned',
    E'I just earned my {course} Certification from {@brand}!\n\n'
    '✅ Grade: {grade}\n'
    '📅 Issued: {date}\n'
    '🎯 Certificate ID: {certId}\n\n'
    'Verify the credential →\n'
    '{verifyUrl}\n\n'
    'Huge thanks to {@founder} and the team for structured, practitioner-led training in real-world financial modeling.',
    ARRAY['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    TRUE, TRUE, TRUE
  ),
  (
    'assessment_passed',
    'Assessment Passed',
    E'Just passed "{sessionName}" on the {@brand} Training Hub!\n\n'
    '📊 Score: {score}%\n'
    '📘 Course: {course}\n'
    '📅 Date: {date}\n\n'
    'Another milestone on the way to {course} Certification with {@founder}.',
    ARRAY['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    TRUE, TRUE, TRUE
  ),
  (
    'achievement_card',
    'Achievement Card (Session Completed)',
    E'Just completed "{sessionName}" on the {@brand} Training Hub!\n\n'
    '📊 Score: {score}%\n'
    '📘 {course}\n\n'
    'Thanks to {@founder} for the practitioner-led curriculum.',
    ARRAY['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    TRUE, TRUE, TRUE
  ),
  (
    'live_session_watched',
    'Live Session Watched',
    E'Just finished watching "{sessionName}" — part of FMP Real-World Financial Modeling from {@brand}.\n\n'
    'Practitioner-led, built on real deal work with {@founder}.',
    ARRAY['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    TRUE, TRUE, TRUE
  ),
  (
    'session_shared',
    'Session / Course Shared (Generic)',
    E'Check out "{sessionName}" on the {@brand} Training Hub.\n\n'
    '{sessionDescription}\n\n'
    '{sessionUrl}',
    ARRAY['FinancialModeling', 'FinancialModelerPro'],
    TRUE, FALSE, TRUE
  )
ON CONFLICT (template_key) DO NOTHING;

COMMIT;
