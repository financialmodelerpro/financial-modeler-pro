-- ============================================================
-- 119: Append {hubUrl} to share templates that don't already
-- carry a Training Hub URL.
--
-- Soft-upgrade semantics: only rows whose template_text doesn't
-- already mention the learn subdomain OR the {hubUrl} variable
-- are touched. That way admins who customized the copy keep
-- their edits, and this migration is idempotent — re-running
-- is a no-op because the updated rows then match the skip
-- predicate.
--
-- certificate_earned is intentionally excluded: it already
-- embeds {verifyUrl} which links to the specific certificate.
-- ============================================================

UPDATE share_templates
SET template_text = template_text || E'\n\nLearn more at {hubUrl}'
WHERE template_key IN (
        'assessment_passed',
        'achievement_card',
        'live_session_watched',
        'session_shared',
        'daily_certifications_roundup'
      )
  AND template_text NOT ILIKE '%learn.financialmodelerpro.com%'
  AND template_text NOT ILIKE '%{hubUrl}%';
