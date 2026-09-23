-- 246_project_last_seen.sql
--
-- WHEN DID THIS PERSON LAST LOOK AT THIS PROJECT?
--
-- One row per (user, project). It exists so the Collaborate screen can mark
-- what has changed since a reader last opened a project, which is the question
-- the Overview is there to answer and the only one it could not.
--
-- IN THE DATABASE, NOT THE BROWSER (founder decision, 2026-09-22). Browser
-- storage is lost on another device, in another browser and on a cleared
-- cache, and each of those makes the marker WRONG rather than absent: a reader
-- who checked yesterday on a laptop would be told everything is new. A marker
-- that is sometimes wrong is worse than none, because it is trusted.
--
-- PRIMARY KEY (user_id, project_id): a person has exactly one last-seen per
-- project, so the shape makes a second row impossible rather than relying on
-- the writer to upsert correctly.
--
-- BOTH SIDES CASCADE. This is a convenience marker, not a record of anything:
-- when the project goes it is meaningless, and when the account goes it must
-- not outlive the person. Neither is an audit fact, so neither is SET NULL.
--
-- NO seen_at DEFAULT. The writer always supplies the time, and a default would
-- quietly record "now" for a row somebody inserted for another reason.
--
-- No em dashes in this file.

create table if not exists public.refm_project_last_seen (
  user_id    uuid not null references public.users(id)         on delete cascade,
  project_id uuid not null references public.refm_projects(id) on delete cascade,
  seen_at    timestamptz not null,
  primary key (user_id, project_id)
);

comment on table public.refm_project_last_seen is
  'When a person last opened a project, for the Collaborate unread marker (migration 246). One row per user per project. Not an audit record: both FKs cascade.';

-- The read is always "this person, this project", which the primary key
-- already serves. This index serves the other direction, a project asking who
-- has looked at it recently, which is what a future "seen by" surface needs.
create index if not exists refm_project_last_seen_project_idx
  on public.refm_project_last_seen (project_id, seen_at desc);

alter table public.refm_project_last_seen enable row level security;
