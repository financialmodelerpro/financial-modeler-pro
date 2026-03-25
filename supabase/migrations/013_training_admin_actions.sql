-- Admin actions table: blocks + certificate revocations for Training Hub
create table if not exists training_admin_actions (
  id              uuid default gen_random_uuid() primary key,
  registration_id text not null,
  email           text not null,
  action_type     text not null check (action_type in ('block', 'revoke_certificate')),
  course          text,
  reason          text,
  actioned_by     text default 'admin',
  actioned_at     timestamptz default now(),
  is_active       boolean default true
);

create index if not exists idx_training_admin_actions_regid  on training_admin_actions (registration_id);
create index if not exists idx_training_admin_actions_email  on training_admin_actions (email);
create index if not exists idx_training_admin_actions_type   on training_admin_actions (action_type, is_active);

alter table training_admin_actions enable row level security;
create policy "Admin full access" on training_admin_actions using (true);
