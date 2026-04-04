-- Auth Enhancements: city/country, device trust, email confirmations, pending registrations

-- Add columns to training_registrations_meta
ALTER TABLE training_registrations_meta
  ADD COLUMN IF NOT EXISTS city             TEXT,
  ADD COLUMN IF NOT EXISTS country          TEXT,
  ADD COLUMN IF NOT EXISTS email_confirmed  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmed_at     TIMESTAMPTZ;

-- Add columns to users (Modeling Hub)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone           TEXT,
  ADD COLUMN IF NOT EXISTS city            TEXT,
  ADD COLUMN IF NOT EXISTS country         TEXT,
  ADD COLUMN IF NOT EXISTS email_confirmed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmed_at    TIMESTAMPTZ;

-- Pending training registrations (before email confirmation)
CREATE TABLE IF NOT EXISTS training_pending_registrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  course        TEXT NOT NULL,
  phone         TEXT,
  city          TEXT,
  country       TEXT,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Trusted devices (shared by both hubs)
CREATE TABLE IF NOT EXISTS trusted_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub           TEXT NOT NULL,
  identifier    TEXT NOT NULL,
  device_token  TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_token      ON trusted_devices(device_token);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_identifier ON trusted_devices(identifier, hub);

-- Email confirmation tokens (shared by both hubs)
CREATE TABLE IF NOT EXISTS email_confirmations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub         TEXT NOT NULL,
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_confirmations_token ON email_confirmations(token);

-- OTP table for Training Hub device verification
CREATE TABLE IF NOT EXISTS training_email_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_otps_email ON training_email_otps(email);

-- OTP table for Modeling Hub device verification
CREATE TABLE IF NOT EXISTS modeling_email_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_modeling_otps_email ON modeling_email_otps(email);
