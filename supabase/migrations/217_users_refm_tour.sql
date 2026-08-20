-- 217: per-user REFM guided-tour state (2026-08-20).
--
-- ONE nullable jsonb column, additive only. Holds { startedAt, step,
-- completedAt, skippedAt } so the tour runs automatically on a user's FIRST
-- platform open, can be paused and resumed later, and never repeats once
-- completed or skipped. NULL means the tour has never run for this user,
-- which is exactly the state a fresh account should be in.
--
-- The client is schema tolerant: until this migration is applied the API
-- reports available:false and the tour falls back to localStorage, so nothing
-- breaks on a database that has not caught up. localStorage is per browser,
-- not per user, which is why this column exists at all.

alter table users add column if not exists refm_tour jsonb;

comment on column users.refm_tour is
  'REFM guided tour state: { startedAt, step, completedAt, skippedAt }. NULL = never run. See lib/guide/tourState.ts.';
