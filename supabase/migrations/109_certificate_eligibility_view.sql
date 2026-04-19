-- ============================================================
-- 109: Native Supabase certificate eligibility
--      (removes the hard dependency on Apps Script's pending flag)
-- ============================================================

-- View that surfaces (email, course_code) pairs where the student has BOTH
-- passed the final exam AND passed at least one non-final session. The
-- certificate engine walks this list, then runs the full per-course
-- "all required sessions passed" check in code (needs COURSES config).
--
-- Tab-key convention: `{COURSE_CODE}_{S|L|FINAL}…` e.g. `3SFM_S1`, `BVM_L4`,
-- `3SFM_Final`. The view splits on the first underscore.
CREATE OR REPLACE VIEW certificate_eligibility_raw AS
SELECT
  email,
  split_part(tab_key, '_', 1)                                   AS course_code,
  count(*) FILTER (WHERE passed)                                AS passed_count,
  count(*)                                                      AS attempted_count,
  bool_or(passed AND (is_final = TRUE OR tab_key ILIKE '%\_Final' ESCAPE '\'))
                                                                AS final_passed,
  max(score) FILTER (WHERE passed AND (is_final = TRUE OR tab_key ILIKE '%\_Final' ESCAPE '\'))
                                                                AS final_score,
  round(avg(score) FILTER (WHERE passed AND is_final IS NOT TRUE))
                                                                AS avg_score,
  max(completed_at)                                             AS last_pass_at
FROM training_assessment_results
WHERE tab_key LIKE '%\_%' ESCAPE '\'
GROUP BY email, split_part(tab_key, '_', 1);

COMMENT ON VIEW certificate_eligibility_raw IS
  'Per (email, course_code): pass counters and final-exam status. Consumed by certificateEligibility.findAllEligibleFromSupabase to seed the certificate cron independently of Apps Script.';

-- Provenance fields on student_certificates so the audit trail distinguishes
-- between normal auto-issuance, the new Supabase-native scan, and admin force-
-- issues. Kept optional to stay backwards-compatible with existing rows.
ALTER TABLE student_certificates
  ADD COLUMN IF NOT EXISTS issued_via       TEXT,   -- 'auto' | 'forced' | 'apps_script'
  ADD COLUMN IF NOT EXISTS issued_by_admin  TEXT;   -- admin email when force-issued
