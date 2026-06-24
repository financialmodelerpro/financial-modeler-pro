-- ============================================================
--  172_users_company_job_title.sql
--  Registration now captures Company / Organization and Job Title. ADDITIVE:
--  two nullable text columns on users, alters/drops nothing. The register route
--  is schema-tolerant (it retries without these columns if the migration has not
--  been applied yet), so registration never breaks pre-apply.
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS company   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text;
