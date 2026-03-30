-- 023 Training Intelligence: email log, cohorts, cohort members, admin notes

-- ── training_email_log ────────────────────────────────────────────────────────
create table if not exists training_email_log (
  id               uuid primary key default gen_random_uuid(),
  campaign_name    text not null,
  recipient_reg_id text not null,
  recipient_email  text not null,
  email_type       text not null,
  subject          text,
  sent_at          timestamptz default now(),
  status           text default 'sent'
);

alter table training_email_log enable row level security;
create policy "Admin full access email_log" on training_email_log for all using (true);

-- ── training_cohorts ──────────────────────────────────────────────────────────
create table if not exists training_cohorts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  course_code text not null,
  start_date  date,
  end_date    date,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

alter table training_cohorts enable row level security;
create policy "Admin full access cohorts" on training_cohorts for all using (true);

-- ── training_cohort_members ───────────────────────────────────────────────────
create table if not exists training_cohort_members (
  id              uuid primary key default gen_random_uuid(),
  cohort_id       uuid references training_cohorts(id) on delete cascade,
  registration_id text not null,
  joined_at       timestamptz default now(),
  unique(cohort_id, registration_id)
);

alter table training_cohort_members enable row level security;
create policy "Admin full access members" on training_cohort_members for all using (true);

-- ── student_admin_notes ────────────────────────────────────────────────────────
create table if not exists student_admin_notes (
  id              uuid primary key default gen_random_uuid(),
  registration_id text not null,
  note            text not null,
  created_by      text,
  created_at      timestamptz default now()
);

alter table student_admin_notes enable row level security;
create policy "Admin full access admin_notes" on student_admin_notes for all using (true);

-- ── training_settings extra keys (bvm_unlock, email toggles) ─────────────────
-- training_settings table already exists; just insert defaults
insert into training_settings (key, value) values
  ('bvm_requires_sfm', 'true'),
  ('email_milestones', 'true'),
  ('email_reminders', 'true'),
  ('email_weekly', 'false'),
  ('inactivity_days', '7')
on conflict (key) do nothing;
