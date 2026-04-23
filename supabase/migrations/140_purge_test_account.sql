-- Migration 140: purge test account FMP-2026-0037 (pacemakersglobal@gmail.com)
--
-- One-off cleanup. The account was created during pre-launch testing of the
-- new register flow and never belonged to a real student. Production was
-- purged via service-role script on 2026-04-23 and the deletion is captured
-- in admin_audit_log (action='training_account_purge', see audit row id
-- e45c3a81-da3e-46af-8430-31671244eac6). This file mirrors that cleanup so
-- any other environment (staging, local rebuild from migrations) lands in
-- the same state.
--
-- Idempotent: every DELETE is keyed on the exact email / RegID; if the row
-- has already been removed (or was never present in the target environment)
-- the statement is a no-op.
--
-- Order is FK-safe: children of training_registrations_meta (passwords,
-- enrollments, admin actions) go first, parent row last.

-- Identity children
DELETE FROM training_passwords             WHERE registration_id = 'FMP-2026-0037';
DELETE FROM training_enrollments           WHERE registration_id = 'FMP-2026-0037';
DELETE FROM training_admin_actions         WHERE registration_id = 'FMP-2026-0037';

-- Email-keyed artefacts
DELETE FROM training_email_otps            WHERE email      = 'pacemakersglobal@gmail.com';
DELETE FROM email_confirmations            WHERE email      = 'pacemakersglobal@gmail.com';
DELETE FROM trusted_devices                WHERE identifier = 'pacemakersglobal@gmail.com';
DELETE FROM training_pending_registrations WHERE email      = 'pacemakersglobal@gmail.com';

-- Activity rows (the test account never produced any in production, but
-- we DELETE defensively so a local replay covers the case where someone
-- did exercise the account end-to-end in their own environment).
DELETE FROM training_assessment_results    WHERE email         = 'pacemakersglobal@gmail.com';
DELETE FROM certification_watch_history    WHERE student_email = 'pacemakersglobal@gmail.com';
DELETE FROM session_watch_history          WHERE student_email = 'pacemakersglobal@gmail.com';
DELETE FROM session_registrations          WHERE student_email = 'pacemakersglobal@gmail.com';
DELETE FROM session_notes                  WHERE student_email = 'pacemakersglobal@gmail.com';
DELETE FROM student_certificates           WHERE email         = 'pacemakersglobal@gmail.com';
DELETE FROM training_email_log             WHERE recipient_email = 'pacemakersglobal@gmail.com';
DELETE FROM announcement_recipient_log     WHERE email           = 'pacemakersglobal@gmail.com';
DELETE FROM training_cohort_members        WHERE registration_id = 'FMP-2026-0037';
DELETE FROM newsletter_subscribers         WHERE email           = 'pacemakersglobal@gmail.com';

-- Parent last
DELETE FROM training_registrations_meta    WHERE registration_id = 'FMP-2026-0037';
