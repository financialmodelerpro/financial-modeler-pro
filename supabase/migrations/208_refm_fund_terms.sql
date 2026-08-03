-- 208_refm_fund_terms.sql
-- Fund layer Step 2: per-project fund terms (management fee, hurdle, carry,
-- committed capital, fee share by party role).
--
-- ADDITIVE, non-destructive, idempotent. Drops nothing, changes no existing
-- table, and a project with no row here behaves exactly as it does today
-- (standalone, no fund economics). See docs/FUND_LAYER_GUIDELINE.md.
--
-- ONE ROW PER PROJECT: project_id is the PRIMARY KEY, mirroring
-- refm_report_decks (migration 199). Fund terms describe the vehicle, not a
-- point in time, so there is no version_number here and no history table.
--
-- RELATIONSHIP TO THE VERSION SNAPSHOT, read this before changing anything.
-- This table is the DURABLE store the Fund Terms tab reads and writes. It is
-- NOT what the engine will read. From Step 3 the engine reads
-- `Project.fundTerms` inside the refm_project_versions.snapshot jsonb, which
-- the tab mirrors on every save. That split is deliberate and already has
-- precedent: an M5 equity partner links to a party by partyId but SNAPSHOTS
-- the name, so the engine never depends on a mutable side table. It is what
-- makes a saved version reproduce the numbers it was computed with, lets
-- Module 6 scenarios override fund terms later, and keeps the PDF/Excel
-- version picker honest about old versions. Storing fee terms ONLY here would
-- silently re-price every historical version whenever someone edits the tab.
--
-- Reads must stay schema-tolerant (prod lags the repo): the application treats
-- a missing table as "no fund terms saved yet" and the tab still works from the
-- snapshot, rather than failing Module 1.
BEGIN;

CREATE TABLE IF NOT EXISTS refm_fund_terms (
  project_id            uuid PRIMARY KEY REFERENCES refm_projects(id) ON DELETE CASCADE,

  -- The standalone-vs-fund toggle. FALSE (the default, and the state of every
  -- project that exists today) means every other column here is stored but
  -- inert: no fee, no hurdle, no carry, no change to any number anywhere.
  -- scripts/verify-fund-layer-guard.ts pins that.
  fund_enabled          boolean NOT NULL DEFAULT false,

  -- Management fee as a DECIMAL fraction (0.02 = 2%), matching every other
  -- rate in the platform (discountRate, payoutRatio, tax rate) rather than
  -- introducing a percent-valued column the engine would have to divide.
  management_fee_pct    numeric NOT NULL DEFAULT 0 CHECK (management_fee_pct >= 0 AND management_fee_pct <= 1),

  -- WHICH BASE THE FEE IS CHARGED ON. Exactly TWO options in v1, both LINEAR:
  -- an input the user types, or a computed development cost that does not
  -- depend on the fee. Fund size (equity + debt) is deliberately NOT here: the
  -- fee raises the funding requirement, so a fund-size base would feed the fee
  -- back into its own base and pull the whole thing into the M4 circular
  -- solve. It is deferred to v1.1 and, when it arrives, it is an additive
  -- CHECK change plus one enum value, not a rebuild.
  fee_base              text NOT NULL DEFAULT 'committed_capital'
                          CHECK (fee_base IN ('committed_capital', 'total_development_cost')),

  -- Preferred return / hurdle, decimal fraction. Investors are paid up to this
  -- before the manager takes carry.
  hurdle_rate_pct       numeric NOT NULL DEFAULT 0 CHECK (hurdle_rate_pct >= 0 AND hurdle_rate_pct <= 1),

  -- Performance fee (carry), decimal fraction of the residual above the hurdle.
  carry_pct             numeric NOT NULL DEFAULT 0 CHECK (carry_pct >= 0 AND carry_pct <= 1),

  -- Committed capital in project currency. Only meaningful when fee_base is
  -- 'committed_capital'; kept regardless so switching the base back and forth
  -- never loses the number the user typed.
  committed_capital     numeric NOT NULL DEFAULT 0 CHECK (committed_capital >= 0),

  -- Fee share by party ROLE, as [{ "role": "Sponsor", "sharePct": 0.6 }, ...].
  -- Roles come from the fixed PARTY_ROLES set in src/.../lib/parties.ts and are
  -- validated in the app and the API rather than by a DB constraint, exactly as
  -- refm_parties.roles is (migration 190): Postgres cannot cleanly CHECK array
  -- element membership, and in-app validation keeps the role set extensible
  -- without a migration. jsonb rather than a child table because this is a
  -- short list edited as one unit, always read whole, and never queried by role.
  fee_shares            jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE refm_fund_terms IS
  'Per-project fund terms (management fee, fee base, hurdle, carry, committed capital, fee share by party role). One row per project. Durable store for the M1 Fund Terms tab; the ENGINE reads the mirrored copy in refm_project_versions.snapshot -> project.fundTerms, so a saved version reproduces the terms it was computed with. fund_enabled = false means every value here is stored but inert.';

COMMENT ON COLUMN refm_fund_terms.fee_base IS
  'committed_capital | total_development_cost. Both LINEAR: the fee raises the funding requirement but the higher funding never raises the fee. Fund size (equity + debt) is deliberately excluded in v1 because it is circular; adding it later is one additive enum value.';

COMMENT ON COLUMN refm_fund_terms.fee_shares IS
  'jsonb array of { role, sharePct } splitting fee income across party roles. Roles validated in-app against PARTY_ROLES (same rationale as refm_parties.roles). sharePct is a decimal fraction.';

-- RLS mirrors refm_parties (mig 190) and refm_project_versions (mig 149):
-- owner-scoped via a join back to refm_projects.user_id. The app uses NextAuth
-- plus the service-role client (which bypasses RLS) after verifying ownership
-- in the server route, so this is deny-all defense-in-depth for anon/authed keys.
ALTER TABLE refm_fund_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own refm_fund_terms" ON refm_fund_terms;
CREATE POLICY "Users read own refm_fund_terms" ON refm_fund_terms FOR SELECT
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_fund_terms.project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users write own refm_fund_terms" ON refm_fund_terms;
CREATE POLICY "Users write own refm_fund_terms" ON refm_fund_terms FOR ALL
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_fund_terms.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_fund_terms.project_id AND p.user_id = auth.uid()));

COMMIT;

-- Verification after applying (behavioural, not a grep of this file):
--   1. INSERT a row with fee_base = 'fund_size' must FAIL with 23514.
--   2. INSERT with management_fee_pct = 1.5 must FAIL with 23514.
--   3. A second INSERT for the same project_id must FAIL with 23505.
--   4. DELETE the project must remove the row (ON DELETE CASCADE).
