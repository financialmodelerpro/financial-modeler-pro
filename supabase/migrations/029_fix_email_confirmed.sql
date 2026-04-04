-- Migration 029: Fix email_confirmed for pre-027 existing students
-- Migration 027 added the email_confirmed column. Depending on the DEFAULT used,
-- existing rows may have email_confirmed = false instead of true.
-- This migration marks all students who registered before the new confirmation
-- flow (pre-2025) as confirmed, so they are not blocked on signin.

UPDATE training_registrations_meta
SET email_confirmed = true
WHERE email_confirmed IS NULL
   OR (email_confirmed = false AND (created_at IS NULL OR created_at < '2025-01-01'));

-- Clean up any stale entries in email_confirmations that are expired and unused
DELETE FROM email_confirmations
WHERE expires_at < NOW() - INTERVAL '7 days'
  AND used_at IS NULL;
