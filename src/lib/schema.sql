-- ============================================================
--  REFM Pro — Supabase Schema
--  Run this in the Supabase SQL editor (or supabase db push)
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── users ─────────────────────────────────────────────────────────────────────
create table if not exists users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  name                text,
  password_hash       text,                          -- hashed via scrypt; null for OAuth users
  role                text not null default 'user'
                        check (role in ('user', 'admin')),
  subscription_plan   text not null default 'free'
                        check (subscription_plan in ('free', 'professional', 'enterprise')),
  subscription_status text not null default 'trial'
                        check (subscription_status in ('active', 'trial', 'expired', 'cancelled')),
  projects_limit      integer not null default 3,    -- -1 = unlimited
  admin_notes         text,                          -- internal admin notes, never shown to user
  last_login_at       timestamptz,                   -- updated on successful auth
  trial_ends_at       timestamptz,                   -- explicit trial expiry date
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Migration helpers (safe to re-run on existing DBs)
alter table users add column if not exists admin_notes   text;
alter table users add column if not exists last_login_at timestamptz;
alter table users add column if not exists trial_ends_at timestamptz;

-- ── projects ──────────────────────────────────────────────────────────────────
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  platform    text not null default 'refm',
  module_data jsonb not null default '{}',
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_id_idx on projects(user_id);
create index if not exists projects_user_active_idx on projects(user_id) where not is_archived;

-- ── project_scenarios ─────────────────────────────────────────────────────────
create table if not exists project_scenarios (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  scenario_name text not null,
  scenario_type text not null default 'base'
                  check (scenario_type in ('base', 'bull', 'bear', 'custom')),
  module_data   jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists scenarios_project_id_idx on project_scenarios(project_id);

-- ── features_registry ─────────────────────────────────────────────────────────
create table if not exists features_registry (
  id           uuid primary key default gen_random_uuid(),
  feature_key  text not null unique,
  display_name text not null,
  description  text,
  category     text
);

-- ── plan_permissions ──────────────────────────────────────────────────────────
create table if not exists plan_permissions (
  id          uuid primary key default gen_random_uuid(),
  plan        text not null
                check (plan in ('free', 'professional', 'enterprise')),
  feature_key text not null references features_registry(feature_key) on delete cascade,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id),
  unique(plan, feature_key)
);

-- ── user_permissions ──────────────────────────────────────────────────────────
create table if not exists user_permissions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  feature_key    text not null references features_registry(feature_key) on delete cascade,
  override_value boolean not null,
  reason         text,
  created_at     timestamptz not null default now(),
  created_by     uuid references users(id),
  unique(user_id, feature_key)
);

create index if not exists user_perms_user_idx on user_permissions(user_id);

-- ── branding_config ───────────────────────────────────────────────────────────
create table if not exists branding_config (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,               -- 'global' | 'platform' | 'user'
  platform_id text,                        -- null for global scope
  config      jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id)
);

-- ── admin_audit_log ───────────────────────────────────────────────────────────
create table if not exists admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid not null references users(id),
  action         text not null,
  target_user_id uuid references users(id),
  before_value   jsonb,
  after_value    jsonb,
  reason         text,
  created_at     timestamptz not null default now()
);

create index if not exists audit_log_admin_idx on admin_audit_log(admin_id);
create index if not exists audit_log_target_idx on admin_audit_log(target_user_id);
create index if not exists audit_log_created_idx on admin_audit_log(created_at desc);

-- ── announcements ─────────────────────────────────────────────────────────────
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  type       text not null default 'info'
               check (type in ('info', 'warning', 'success', 'maintenance')),
  active     boolean not null default true,
  starts_at  timestamptz,
  ends_at    timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger announcements_updated_at
  before update on announcements
  for each row execute function update_updated_at();

-- ── auto-update updated_at ────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger users_updated_at
  before update on users
  for each row execute function update_updated_at();

create or replace trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

-- ── Seed: feature registry + plan defaults ────────────────────────────────────
-- Full seed is in supabase/seed-permissions.sql (run that after schema creation).
-- This is a minimal inline seed for initial setup only.

insert into features_registry (feature_key, display_name, description, category) values
  ('module_1',           'Module 1 — Project Setup',        'Timeline, land, area, development costs, financing',       'modules'),
  ('module_2',           'Module 2 — Revenue Analysis',     'Unit sales, rental pricing, phased delivery',              'modules'),
  ('module_3',           'Module 3 — Operating Expenses',   'Property management, maintenance, staff costs',            'modules'),
  ('module_4',           'Module 4 — Returns & Valuation',  'IRR, NPV, equity multiple, cap rate',                     'modules'),
  ('module_5',           'Module 5 — Financial Statements', 'Auto-generated P&L, Balance Sheet, Cash Flow',            'modules'),
  ('module_6',           'Module 6 — Reports & Export',     'Investor PDF and Excel workbooks',                        'modules'),
  ('module_7',           'Module 7 — Scenario Analysis',    'Multi-scenario comparison and stress testing',             'modules'),
  ('module_8',           'Module 8 — Portfolio Dashboard',  'Multi-project portfolio view and aggregated KPIs',        'modules'),
  ('module_9',           'Module 9 — Market Data',          'Live market benchmarks and comparable data feeds',        'modules'),
  ('module_10',          'Module 10 — Collaboration',       'Team sharing, comments, review workflows',                'modules'),
  ('module_11',          'Module 11 — API Access',          'REST API and webhook integrations',                       'modules'),
  ('module_8_full',      'Module 8 — Full Edit',            'Full portfolio edit vs read-only view',                   'module_quality'),
  ('module_9_full',      'Module 9 — Full Metrics',         'Full market metrics vs basic KPIs',                       'module_quality'),
  ('ai_contextual',      'AI Contextual Assist',            'In-module AI help buttons (Mode 1)',                      'ai'),
  ('ai_research',        'AI Research Agent',               'Full investment memo research (Mode 2)',                   'ai'),
  ('pdf_basic',          'PDF Export — Basic',              'Standard PDF summary export',                             'export'),
  ('pdf_full',           'PDF Export — Full',               'Full formatted investor PDF report',                      'export'),
  ('pdf_whitelabel',     'PDF Export — White-Label',        'White-label branded PDF with custom cover',               'export'),
  ('excel_static',       'Excel Export — Static',           'Static values Excel workbook',                            'export'),
  ('excel_formula',      'Excel Export — Formula',          'Formula-linked Excel workbook',                           'export'),
  ('white_label',        'White-Label Branding',            'Custom logo, colours, client name, and domain',           'admin'),
  ('admin_panel',        'Admin Panel',                     'Access to /admin route',                                  'admin'),
  ('projects_10',        'Up to 10 Projects',               'Save and manage up to 10 projects',                       'limits'),
  ('projects_unlimited', 'Unlimited Projects',              'Unlimited project storage',                               'limits')
on conflict (feature_key) do update set
  display_name = excluded.display_name,
  description  = excluded.description,
  category     = excluded.category;

-- Run supabase/seed-permissions.sql for the full plan_permissions matrix.
