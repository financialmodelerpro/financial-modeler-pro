-- 242_asset_type_standards.sql
--
-- THE ASSET TYPE REGISTRY AND COMPANY STANDARDS (2026-09-07, land planning
-- step 1).
--
-- A firm keys two standards off an asset type in its land planning: AVERAGE
-- UNIT SIZE (sqm per unit or key) and PARKING RATIO (slots per unit, or sqm
-- of GFA per slot for retail-style types), plus one account-wide scalar,
-- PARKING AREA PER SLOT. This migration gives those a home.
--
-- ACCOUNT SCOPED FROM BIRTH, the scope the cost catalog had to migrate to
-- (mig 241): the vocabulary is the firm's, it survives across the firm's
-- projects, every member of the account resolves the same list, and it dies
-- with the account (CASCADE). user_id is the AUTHOR only, released to NULL
-- when the login goes (the 230/234/238/241 rule: the entry outlives the
-- person).
--
-- NOTHING HERE IS READ BY THE CALCULATION ENGINE. Selecting an asset type
-- STAMPS the resolved values onto the asset in the snapshot, and any future
-- consumer reads the asset. An unreachable or edited registry can never
-- change a number in a saved version.
--
-- A BLANK AND A TYPED ZERO ARE DIFFERENT ANSWERS. The standards columns are
-- nullable NUMERIC: NULL means the firm has not decided, 0 is a decision
-- (villas with no parking requirement are a real 0). The CHECKs forbid
-- negatives but deliberately allow both NULL and 0.
--
-- Values are TEXT, not enums, per the mig 214 rationale: the unions live in
-- code (lib/state/assetTypeStandards.ts) and the API route validates against
-- them, so a vocabulary change stays a code change.
--
-- Idempotent: guarded per statement. No em dashes in this file.

BEGIN;

CREATE TABLE IF NOT EXISTS refm_asset_types (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  entry_id     TEXT NOT NULL CHECK (entry_id ~ '^[a-z0-9-]{1,48}$'),
  label        TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  category     TEXT CHECK (category IS NULL OR length(btrim(category)) BETWEEN 1 AND 40),
  avg_unit_size NUMERIC CHECK (avg_unit_size IS NULL OR avg_unit_size >= 0),
  parking_ratio NUMERIC CHECK (parking_ratio IS NULL OR parking_ratio >= 0),
  parking_ratio_basis TEXT NOT NULL DEFAULT 'slots_per_unit'
    CHECK (parking_ratio_basis IN ('slots_per_unit', 'sqm_per_slot')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT refm_asset_types_account_entry_unique UNIQUE (account_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_refm_asset_types_account
  ON refm_asset_types (account_id, label);

-- Same posture as refm_cost_catalog: RLS on with no anon policy; every server
-- read goes through SERVICE_ROLE and the API route filters by the caller's
-- account. An anon-key client denies all.
ALTER TABLE refm_asset_types ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE refm_asset_types IS
  'Account-scoped REFM asset type registry with company standards (mig 242): the firm''s own asset type vocabulary carrying avg unit size and parking ratio, shared by every member across the account''s projects. user_id is the AUTHOR (SET NULL when they leave). NULL standards mean not decided; 0 is a decision. Nothing here is read by the calculation engine: selecting a type stamps the resolved values onto the asset and any consumer reads the asset.';

CREATE TABLE IF NOT EXISTS refm_account_standards (
  account_id   UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  parking_area_per_slot NUMERIC CHECK (parking_area_per_slot IS NULL OR parking_area_per_slot >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE refm_account_standards ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE refm_account_standards IS
  'Account-wide REFM company standards scalars (mig 242), one row per account. parking_area_per_slot: sqm one parking slot occupies. NULL means not decided; 0 is a decision. Never read by the calculation engine: values stamp onto assets at selection time.';

COMMIT;
