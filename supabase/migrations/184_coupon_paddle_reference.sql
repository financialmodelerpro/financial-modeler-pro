-- ============================================================
--  184_coupon_paddle_reference.sql
--  Evolve coupon_codes (mig 076) from a LOCAL-ONLY concept into a REFERENCE to a
--  real Paddle discount (Model 1: Paddle owns the discount; the platform
--  references, displays, and passes it at checkout).
--
--  A coupon reduces the ACTUAL Paddle charge only when it carries the id of a
--  discount that ALREADY EXISTS in Paddle. That id is stored in
--  paddle_discount_id and passed to Paddle.Checkout.open({ discountId }); Paddle
--  validates + applies it. discount_type / discount_value (mig 076) stay as the
--  marketing TEXT ("20% off") only.
--
--    - paddle_discount_id : the Paddle discount id (dsc_...) this code references.
--                           NULL = display-only / not yet wired to Paddle (will
--                           not apply at checkout; the admin UI warns).
--    - kind               : 'private' (customer types the code at checkout) or
--                           'public' (auto-applied + shown on the pricing page).
--    - display_label      : optional marketing label (e.g. "Launch offer").
--    - starts_at          : optional validity start (expires_at from mig 076 is
--                           the end). NULL start = valid from creation.
--
--  ENFORCEMENT: unchanged. A discount affects PRICE only, never entitlements or
--  the gate. Additive columns only. Idempotent. Apply manually via the Supabase
--  dashboard. No em dashes.
-- ============================================================

ALTER TABLE coupon_codes ADD COLUMN IF NOT EXISTS paddle_discount_id TEXT;
ALTER TABLE coupon_codes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'private';
ALTER TABLE coupon_codes ADD COLUMN IF NOT EXISTS display_label TEXT;
ALTER TABLE coupon_codes ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

-- kind is 'public' | 'private'. Guard with a CHECK, added only once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'coupon_codes' AND constraint_name = 'coupon_codes_kind_check'
  ) THEN
    ALTER TABLE coupon_codes
      ADD CONSTRAINT coupon_codes_kind_check CHECK (kind IN ('public', 'private'));
  END IF;
END $$;

-- At most one ACTIVE public promo per platform-less config is not enforced here
-- (an admin may stage several); the resolver picks the newest active public
-- promo. A partial index keeps that lookup fast.
CREATE INDEX IF NOT EXISTS idx_coupon_codes_active_public
  ON coupon_codes (kind, is_active) WHERE kind = 'public' AND is_active = true;
