-- ============================================================
--  167_payment_settings.sql
--  Provider-agnostic PAYMENT CONFIG store. Holds the active provider selection
--  and the per-provider credentials (API key, API secret, webhook secret) plus
--  a sandbox/live mode flag. ADDITIVE ONLY: new table, alters/drops nothing.
--
--  SECURITY: this row holds SECRETS. It is read ONLY server-side with the
--  service-role client (checkout handler, webhook, admin config API). RLS is
--  ENABLED with NO policies, so the anon / authenticated keys can never read or
--  write it; the service role bypasses RLS. The admin config API returns a
--  MASKED view (booleans for "secret is set"), never the raw secret values, so
--  secrets never reach the client.
--
--  Singleton per platform (primary key = platform_slug). Default active provider
--  is 'none', so checkout stays the clearly-labelled placeholder until an admin
--  activates a provider. Both providers start sandbox = true.
--
--    active_provider   text   'none' | 'paddle' | 'paypro'  (default 'none')
--    paddle_api_key / paddle_api_secret / paddle_webhook_secret   text (secret)
--    paddle_sandbox    boolean  default true
--    paypro_api_key / paypro_api_secret / paypro_webhook_secret   text (secret)
--    paypro_sandbox    boolean  default true
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_settings (
  platform_slug          text PRIMARY KEY,
  active_provider        text NOT NULL DEFAULT 'none'
                           CHECK (active_provider IN ('none', 'paddle', 'paypro')),
  paddle_api_key         text,
  paddle_api_secret      text,
  paddle_webhook_secret  text,
  paddle_sandbox         boolean NOT NULL DEFAULT true,
  paypro_api_key         text,
  paypro_api_secret      text,
  paypro_webhook_secret  text,
  paypro_sandbox         boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Lock the table to the service role only (defense in depth: secrets live here).
ALTER TABLE payment_settings ENABLE ROW LEVEL SECURITY;

-- Seed the singleton row for REFM with provider = none (placeholder checkout).
INSERT INTO payment_settings (platform_slug, active_provider)
VALUES ('real-estate', 'none')
ON CONFLICT (platform_slug) DO NOTHING;
