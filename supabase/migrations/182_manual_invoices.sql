-- ============================================================
--  182_manual_invoices.sql
--  FMP-branded receipts for MANUAL (offline / bank) payments. When an admin
--  assigns or renews a manual plan WITH an amount, the server generates a
--  branded receipt PDF (receipt number, date, plan, amount, FMP + PaceMakers
--  branding), stores it in the private 'invoices' storage bucket, emails it, and
--  records a row here so the billing tab can list + serve it alongside Paddle
--  invoices.
--
--  Ownership: the PDF lives in a PRIVATE bucket keyed by user id; it is only ever
--  served through /api/payments/manual-invoice/[id], which verifies the row
--  belongs to the signed-in user and returns a short-lived signed URL. RLS is
--  ENABLED with no policies (service-role only), so the anon/auth keys can never
--  read this table directly.
--
--  ENFORCEMENT: unchanged. This is billing display only; it touches no plan/gate
--  state. Additive: new table only. Idempotent. Apply manually via the Supabase
--  dashboard. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS manual_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL,
  user_id        uuid NOT NULL,
  platform_slug  text NOT NULL DEFAULT 'real-estate',
  plan_key       text,
  amount_minor   integer NOT NULL,
  currency       text,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  storage_path   text NOT NULL,          -- path within the private 'invoices' bucket
  email_sent_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One receipt number per issue (human-facing id on the PDF + the list row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_invoices_receipt_number
  ON manual_invoices (receipt_number);

CREATE INDEX IF NOT EXISTS idx_manual_invoices_user
  ON manual_invoices (user_id, platform_slug, issued_at DESC);

ALTER TABLE manual_invoices ENABLE ROW LEVEL SECURITY;
