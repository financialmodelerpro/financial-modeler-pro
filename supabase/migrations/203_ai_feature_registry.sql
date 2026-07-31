-- ============================================================
--  203_ai_feature_registry.sql
--  AI foundation, Unit 2: the feature registry.
--  ADDITIVE ONLY: creates two new tables, alters/drops nothing.
--
--  Context (docs/AI_FOUNDATION_GUIDELINE.md, Unit 2): every AI capability is a
--  registered feature with its own id, category, platform, grounding rules,
--  on/off toggle and per-plan monthly caps. Unit 3 (metering) reads the caps,
--  Unit 5 (admin panel) edits the toggles and caps, Unit 6 registers the first
--  real feature (M7 IC narrative). This migration is schema only: NO feature
--  rows are seeded, because registration is the job of the feature's own unit.
--
--  Why these are NOT columns on features_registry (mig 158):
--    features_registry is the SELLABLE capability catalog. Every row in it
--    surfaces in the Plan Builder and the public pricing comparison, which is
--    not where AI features belong (they get their own admin panel in Unit 5).
--    It is also keyed globally with no platform_slug and has no home for a
--    grounding type. So AI features get their own registry, deliberately
--    independent of the entitlement catalog.
--
--  Relationship to entitlement plans:
--    ai_feature_caps.plan_key is FREE TEXT and carries the SAME values as
--    entitlement_plans.plan_key / users.subscription_plan (trial, solo, pro,
--    firm today). It is intentionally NOT a foreign key, for the same reason
--    plan_permissions.plan_key is not: a new plan must be creatable as data
--    without a schema migration, and an AI cap must survive a plan being
--    renamed or retired.
--
--  Apply manually via the Supabase dashboard (project convention).
--  Idempotent: CREATE TABLE IF NOT EXISTS, guarded trigger creation.
--  No em dashes anywhere in this file.
-- ============================================================

-- -- ai_features -------------------------------------------------------------
-- One row per registered AI capability, per platform.
CREATE TABLE IF NOT EXISTS ai_features (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable code-level identifier, e.g. 'm7_ic_narrative'. Lower snake case.
  -- The code registers against this, never against the uuid.
  feature_id    text NOT NULL,

  -- Owning platform slug ('real-estate', 'equity-research', ...). The reserved
  -- value 'all' marks a genuinely cross-platform feature (an onboarding guide,
  -- say) that every platform should see. Uniqueness is per platform so ERM can
  -- register its own 'ic_narrative' with its own caps without colliding with
  -- the REFM one.
  platform_slug text NOT NULL,

  name          text NOT NULL,
  description   text,

  -- The four categories from the guideline. A CHECK rather than free text
  -- because this is a fixed conceptual taxonomy, not admin-editable data.
  category      text NOT NULL
                  CHECK (category IN ('narrative', 'validation', 'guidance', 'generation')),

  -- What the feature is grounded in. An ARRAY, not a single value, because
  -- category 4 (generation) is grounded in model AND context from day one.
  -- Must be non-empty and a subset of the three supported types.
  grounding     text[] NOT NULL
                  CHECK (
                    array_length(grounding, 1) >= 1
                    AND grounding <@ ARRAY['model', 'external', 'context']::text[]
                  ),

  -- Off by default: AI calls cost money, so a newly registered feature is
  -- inert until an admin turns it on. Registration NEVER flips this back.
  enabled       boolean NOT NULL DEFAULT false,

  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (platform_slug, feature_id)
);

CREATE INDEX IF NOT EXISTS ai_features_platform_idx ON ai_features(platform_slug);

-- -- ai_feature_caps ---------------------------------------------------------
-- Per-plan monthly generation cap for one feature. One row per feature-plan
-- pair, mirroring the plan_permissions shape so a new plan is data, not schema.
-- ABSENCE of a row is meaningful: it means no cap has been configured for that
-- plan, which the resolver reports as null rather than inventing a number.
-- The FK column is named ai_feature_id, NOT feature_id, on purpose:
-- ai_features carries both an `id` (uuid) and a `feature_id` (the text code
-- key), so a uuid column called feature_id would be a standing invitation to
-- join on the wrong one.
CREATE TABLE IF NOT EXISTS ai_feature_caps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_feature_id uuid NOT NULL REFERENCES ai_features(id) ON DELETE CASCADE,
  plan_key      text NOT NULL,
  monthly_cap   integer NOT NULL DEFAULT 0 CHECK (monthly_cap >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ai_feature_id, plan_key)
);

CREATE INDEX IF NOT EXISTS ai_feature_caps_feature_idx ON ai_feature_caps(ai_feature_id);

-- RLS: both tables are managed server-side (the service role bypasses RLS) and
-- have no public-read need. Enable RLS with no permissive policy so anon and
-- authenticated client roles are denied by default. Same posture as mig 158.
ALTER TABLE ai_features     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feature_caps ENABLE ROW LEVEL SECURITY;

-- auto-update updated_at (reuses the update_updated_at() function if present).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    DROP TRIGGER IF EXISTS ai_features_updated_at ON ai_features;
    CREATE TRIGGER ai_features_updated_at BEFORE UPDATE ON ai_features
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

    DROP TRIGGER IF EXISTS ai_feature_caps_updated_at ON ai_feature_caps;
    CREATE TRIGGER ai_feature_caps_updated_at BEFORE UPDATE ON ai_feature_caps
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  ELSE
    RAISE NOTICE '203: update_updated_at() absent, updated_at triggers skipped';
  END IF;
END $$;

-- NO SEED. Feature rows are registered by the unit that builds the feature
-- (Unit 6 registers the M7 IC narrative), through registerAiFeature() in
-- src/shared/ai/registry.ts, so the registry and the code that uses it can
-- never drift apart.
