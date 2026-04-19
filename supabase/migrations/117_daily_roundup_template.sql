-- 117_daily_roundup_template.sql
-- Adds the daily_certifications_roundup share template. Admin picks a date,
-- selects which of that day's issued certs to include, and shares a single
-- post celebrating the cohort instead of one post per student.

INSERT INTO share_templates (template_key, title, template_text, hashtags, mention_brand, mention_founder, active)
VALUES
  (
    'daily_certifications_roundup',
    'Daily Certifications Roundup',
    E'Congratulations to today''s newly certified professionals at {@brand}!\n\n'
    '{studentList}\n\n'
    'Proud of the dedication and hard work from {count} students under the guidance of {@founder}.\n\n'
    'View their credentials:\n'
    '{verifyLinks}\n\n'
    'Structured Modeling. Real-World Finance.',
    ARRAY['FinancialModeling', 'FinancialModelerPro', 'CorporateFinance'],
    TRUE, TRUE, TRUE
  )
ON CONFLICT (template_key) DO NOTHING;
