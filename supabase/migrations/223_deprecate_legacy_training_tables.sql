-- 223_deprecate_legacy_training_tables.sql
--
-- DEPRECATES the five legacy training tables in place. NO DATA CHANGE, NO
-- DROP: comments only, each guarded so an environment without the table is a
-- no-op (the mig-220 pattern).
--
-- Why they are kept and why they are dead (2026-08-30 retirement):
--   * All five are EMPTY on prod (certificates 0, enrollments 0, assessments
--     0, assessment_questions untouched, assessment_attempts 0) and as of this
--     date have ZERO application readers or writers: the legacy per-course
--     assessment flow (/training/[courseId]/assessment + its two APIs), the
--     legacy "My Certificates" page + /api/training/certificates, the
--     /api/admin/assessments API family, and the assessment tab of the admin
--     course editor were all removed (the pages were orphaned: nothing linked
--     to them, and the flow could not have worked anyway, since the live
--     `certificates` table is 002's shape and the code read/wrote 005's
--     never-landed columns).
--   * The LIVE certificate system is student_certificates (roster-keyed,
--     admin sync + certificateEngine + dashboard + /verify/[uuid]); the LIVE
--     assessment system is training_assessment_results (241 rows) +
--     live_session_assessments. One system remains, by decision.
--   * Kept, not dropped: a drop is irreversible, empty unreferenced tables
--     are harmless, and their users-FK cascades on empty tables cost nothing.
--   * NAME COLLISION WARNING: the STORAGE BUCKET named `certificates` is part
--     of the LIVE system (templates, generated PDFs, transcripts) and shares
--     the deprecated TABLE's name. sb.storage.from('certificates') is live;
--     sb.from('certificates') is the dead table. See docs/TRAPS.md 2.10.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['certificates','enrollments','assessments','assessment_questions','assessment_attempts']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'COMMENT ON TABLE public.%I IS %L',
        t,
        'DEPRECATED 2026-08-30. Legacy 002/005-era training system: empty, zero application readers or writers since the retirement (CHANGELOG 2026-08-30g). The live systems are student_certificates and training_assessment_results. Kept, not dropped, because a drop is irreversible and an empty unreferenced table is harmless. NOTE the storage BUCKET named certificates is LIVE and unrelated to the deprecated certificates TABLE. Do not add new readers or writers.'
      );
    END IF;
  END LOOP;
END $$;
