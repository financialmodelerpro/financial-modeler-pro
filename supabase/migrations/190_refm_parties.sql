-- 190_refm_parties.sql
-- Per-project Parties for REFM Module 1 (identity data ONLY). Additive,
-- non-destructive, idempotent. The model engine NEVER reads this table: parties
-- live outside the version snapshot, so old projects load unchanged and returns
-- math is untouched. Scoped per project (not per version), since identity data
-- does not vary by model version.
BEGIN;

CREATE TABLE IF NOT EXISTS refm_parties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES refm_projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  identifier    text,                              -- optional (e.g. company reg, license, email)
  roles         text[] NOT NULL DEFAULT '{}',      -- one or more of the fixed set (enforced in-app):
                                                    -- Sponsor, Developer, Investor/Equity Partner,
                                                    -- Advisor, Lender, Prepared-by, Contact, Other
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refm_parties_project ON refm_parties(project_id);

-- RLS mirrors refm_project_versions (mig 149): owner-scoped via a join back to
-- refm_projects.user_id = auth.uid(). Today the app uses NextAuth + the
-- service-role client (bypasses RLS) after verifying project ownership in the
-- server route; this policy is deny-all defense-in-depth for anon/authed keys.
ALTER TABLE refm_parties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own refm_parties" ON refm_parties;
CREATE POLICY "Users read own refm_parties" ON refm_parties FOR SELECT
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_parties.project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users write own refm_parties" ON refm_parties;
CREATE POLICY "Users write own refm_parties" ON refm_parties FOR ALL
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_parties.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_parties.project_id AND p.user_id = auth.uid()));

COMMIT;

-- Note: roles is text[] with the fixed set validated in the app + API rather than
-- a DB CHECK (Postgres cannot cleanly CHECK array-element membership); this keeps
-- the set extensible without a migration. Drops nothing.
