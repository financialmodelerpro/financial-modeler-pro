-- Migration 139: phone number required for new Training Hub signups
--
-- Defensive: the `phone` column already exists on both tables in production
-- (added in earlier migrations alongside city/country) but the schema is not
-- fully reproducible from the migration log. This migration declares the
-- column with `ADD COLUMN IF NOT EXISTS` so a rebuild from scratch lands in
-- the same state.
--
-- The column stays NULLable at the DB level so 9 pre-existing rows that
-- predate phone collection (registered before the field was added) are not
-- broken. The "required" rule is enforced at the application layer:
--   - app/training/register/RegisterForm.tsx: client-side required + format
--   - app/api/training/register/route.ts: server-side required + E.164 check
-- Anyone whose meta row has phone IS NULL keeps signing in normally; the
-- next time they update their profile (or admin edits them) the value can
-- be backfilled.

ALTER TABLE training_registrations_meta
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE training_pending_registrations
  ADD COLUMN IF NOT EXISTS phone TEXT;
