-- 022 Student Dashboard Features: notes, feedback, profiles, badges

-- ── student_notes ─────────────────────────────────────────────────────────────
create table if not exists student_notes (
  id             uuid primary key default gen_random_uuid(),
  registration_id text not null,
  session_key    text not null,  -- e.g. "3SFM_S3"
  content        text not null default '',
  updated_at     timestamptz not null default now(),
  unique(registration_id, session_key)
);

alter table student_notes enable row level security;
create policy "notes_insert" on student_notes for insert with check (true);
create policy "notes_update" on student_notes for update using (true);
create policy "notes_select_own" on student_notes for select using (true);
create policy "notes_delete_own" on student_notes for delete using (true);

-- ── session_feedback ──────────────────────────────────────────────────────────
create table if not exists session_feedback (
  id             uuid primary key default gen_random_uuid(),
  registration_id text not null,
  session_key    text not null,
  rating         integer not null check (rating between 1 and 5),
  comment        text,
  created_at     timestamptz not null default now(),
  unique(registration_id, session_key)
);

alter table session_feedback enable row level security;
create policy "feedback_insert" on session_feedback for insert with check (true);
create policy "feedback_select_admin" on session_feedback for select using (true);

-- ── student_profiles ──────────────────────────────────────────────────────────
create table if not exists student_profiles (
  registration_id  text primary key,
  job_title        text,
  company          text,
  location         text,
  linkedin_url     text,
  notify_milestones boolean not null default true,
  notify_reminders  boolean not null default true,
  last_active_at   timestamptz,
  streak_days      integer not null default 0,
  total_points     integer not null default 0,
  updated_at       timestamptz not null default now()
);

alter table student_profiles enable row level security;
create policy "profiles_all" on student_profiles for all using (true);

-- ── student_badges ────────────────────────────────────────────────────────────
create table if not exists student_badges (
  id             uuid primary key default gen_random_uuid(),
  registration_id text not null,
  badge_key      text not null,  -- e.g. "first_step", "on_fire"
  earned_at      timestamptz not null default now(),
  unique(registration_id, badge_key)
);

alter table student_badges enable row level security;
create policy "badges_all" on student_badges for all using (true);
