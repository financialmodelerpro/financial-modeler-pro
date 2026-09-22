-- 245_project_changes_label_and_save_id.sql
--
-- Two additive columns on the append-only change log, for the Collaborate
-- activity-log readability work.
--
-- `label`: the HUMAN SENTENCE for a change. `snapshot-diff` has produced one
-- since the log was built (ChangeLogEntry.label, "human-friendly fallback for
-- renderers") and `rowsForSave` dropped it on the floor, because there was
-- nowhere to put it. The screen therefore rendered the raw path, which reads
-- like a debugger on what is now a client-facing surface. Nullable: most
-- entries are scalar updates the differ does not label yet, and a row with no
-- label falls back to its path exactly as today.
--
-- `save_id`: which SAVE a row belongs to, so the screen can show one save as
-- one expandable entry instead of forty rows. A uuid minted per save by the
-- appender, NOT a timestamp tolerance: a tolerance eventually merges two quick
-- saves or splits one slow one, and there is no width that is right for both.
-- Nullable, because every row written before this migration belongs to a save
-- nobody recorded, and inventing an id for them would be a claim about history.
--
-- ADDITIVE AND REVERSIBLE. No backfill, no rewrite of existing rows, no change
-- to the append-only trigger (which guards CONTENT on UPDATE; an INSERT that
-- sets these is an ordinary append).
--
-- No em dashes in this file.

alter table public.refm_project_changes
  add column if not exists label text;

alter table public.refm_project_changes
  add column if not exists save_id uuid;

-- The activity screen reads a project's log newest-first and groups by save, so
-- the index carries save_id to keep that grouping cheap as a log grows.
create index if not exists refm_project_changes_project_save_idx
  on public.refm_project_changes (project_id, created_at desc, save_id);

comment on column public.refm_project_changes.label is
  'Human sentence for this change, from snapshot-diff. Null = render the path.';
comment on column public.refm_project_changes.save_id is
  'The save this row belongs to. Null for rows written before migration 245.';

-- ── THE GUARD STOPS ENUMERATING COLUMNS ──────────────────────────────────
--
-- 234's append-only trigger listed the columns that carry meaning and compared
-- them one by one. That list is a MIRROR of the table, and a mirror drifts: the
-- applier dry run for THIS migration proved it by updating the brand new
-- `label` on a logged row and being allowed to, because a guard written in 2026
-- cannot know about a column added later. `label` is the sentence a reader
-- actually reads, so the log's "never rewritten" promise would have been false
-- for the field that carries its meaning, while the path it sits beside stayed
-- immutable.
--
-- Inverted, so it needs no list: EVERYTHING is immutable except the two FK
-- releases that ON DELETE SET NULL performs. A column added tomorrow is guarded
-- the day it is added, by default, with nobody remembering to do anything.
create or replace function refm_project_changes_no_update()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(NEW) - 'version_id' - 'user_id')
       is distinct from (to_jsonb(OLD) - 'version_id' - 'user_id')
     -- An FK may be RELEASED to NULL (ON DELETE SET NULL doing its job) but
     -- never re-pointed at a different row, which would silently re-attribute
     -- a change to another person or another version.
     or (NEW.version_id is distinct from OLD.version_id and NEW.version_id is not null)
     or (NEW.user_id    is distinct from OLD.user_id    and NEW.user_id    is not null)
  then
    raise exception
      'refm_project_changes is APPEND ONLY: an audit row cannot be rewritten (attempted on id %). The only permitted update is an FK being released to NULL by ON DELETE SET NULL. If a correction is needed, append a new row that records it.',
      OLD.id;
  end if;
  return NEW;
end;
$$;
