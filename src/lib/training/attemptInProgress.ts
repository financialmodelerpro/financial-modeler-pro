/**
 * Server-anchored in-progress attempt tracking for the assessment timer.
 *
 * Used by /api/training/assessment/{start,pause,resume,state} and called from
 * both submit endpoints to delete the row on successful submission.
 *
 * Pause semantics (Option C in the diagnosis):
 *   - Regular assessments  : 1 pause max, 120 grace seconds total per attempt
 *   - Final exams (is_final): pauseAttempt always returns { ok: false, code: 'final_no_pause' }
 *   - Server caps pause duration at remaining grace; clock resumes from
 *     where grace ran out rather than letting students bank arbitrary time
 *
 * Identifier shapes are mutually exclusive: cert path uses tab_key, live
 * session path uses session_id. The DB CHECK constraint enforces this and
 * the partial unique indexes from migration 126 dedupe per (email, key, attempt).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AttemptKey =
  | { kind: 'cert'; tabKey: string }
  | { kind: 'live'; sessionId: string };

export interface AttemptStateView {
  startedAt:               string;
  expiresAt:               string;
  paused:                  boolean;
  pausedAt:                string | null;
  graceSecondsRemaining:   number;
  graceSecondsUsed:        number;
  graceSecondsMax:         number;
  pauseCount:              number;
  maxPauses:               number;
  pauseAllowed:            boolean;
  isFinal:                 boolean;
  secondsRemaining:        number;
  pauseLog:                PauseLogEntry[];
}

export interface PauseLogEntry {
  pausedAt:        string;
  resumedAt:       string;
  durationSeconds: number;
}

interface AttemptRow {
  id:                  string;
  email:               string;
  tab_key:             string | null;
  session_id:          string | null;
  attempt_number:      number;
  started_at:          string;
  expires_at:          string;
  paused_at:           string | null;
  grace_seconds_used:  number;
  grace_seconds_max:   number;
  pause_count:         number;
  max_pauses:          number;
  is_final:            boolean;
  pause_log:           PauseLogEntry[];
}

const DEFAULT_GRACE_SECONDS_MAX = 120;
const DEFAULT_MAX_PAUSES        = 1;

// Generic typing of Supabase's chainable query builder is awkward to reach
// from outside the SDK, so the helper takes the table name + filter values
// and returns a typed maybeSingle promise. Inlining keeps the inferred
// generic depth small (avoids TS2589 from chained `.eq()` calls).
async function findAttemptRow(
  sb:    SupabaseClient,
  email: string,
  key:   AttemptKey,
  attemptNumber: number,
): Promise<{ data: AttemptRow | null; error: { message: string } | null }> {
  const base = sb
    .from('assessment_attempts_in_progress')
    .select('*')
    .eq('email', email.toLowerCase())
    .eq('attempt_number', attemptNumber);
  const filtered = key.kind === 'cert'
    ? base.eq('tab_key',    key.tabKey)
    : base.eq('session_id', key.sessionId);
  const { data, error } = await filtered.maybeSingle<AttemptRow>();
  return { data, error: error ? { message: error.message } : null };
}

function buildView(row: AttemptRow): AttemptStateView {
  const nowMs       = Date.now();
  const expiresMs   = new Date(row.expires_at).getTime();
  const pausedAtMs  = row.paused_at ? new Date(row.paused_at).getTime() : null;
  const isPaused    = pausedAtMs !== null;

  // While paused, secondsRemaining freezes at the value it had at pause time.
  // The deadline doesn't tick down because the wall clock isn't being burned.
  const liveSecondsRemaining = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  const pausedSecondsRemaining = pausedAtMs
    ? Math.max(0, Math.floor((expiresMs - pausedAtMs) / 1000))
    : liveSecondsRemaining;

  const graceRemaining = Math.max(0, row.grace_seconds_max - row.grace_seconds_used);
  const pauseAllowed   = !row.is_final
    && row.pause_count < row.max_pauses
    && graceRemaining > 0;

  return {
    startedAt:             row.started_at,
    expiresAt:             row.expires_at,
    paused:                isPaused,
    pausedAt:              row.paused_at,
    graceSecondsRemaining: graceRemaining,
    graceSecondsUsed:      row.grace_seconds_used,
    graceSecondsMax:       row.grace_seconds_max,
    pauseCount:            row.pause_count,
    maxPauses:             row.max_pauses,
    pauseAllowed,
    isFinal:               row.is_final,
    secondsRemaining:      isPaused ? pausedSecondsRemaining : liveSecondsRemaining,
    pauseLog:              Array.isArray(row.pause_log) ? row.pause_log : [],
  };
}

/** Idempotent: returns existing row's state if a row already exists. */
export async function startAttempt(
  sb:    SupabaseClient,
  email: string,
  key:   AttemptKey,
  attemptNumber: number,
  timerMinutes:  number | null,
  isFinal:       boolean,
): Promise<AttemptStateView> {
  const { data: existing } = await findAttemptRow(sb, email, key, attemptNumber);

  if (existing) return buildView(existing);

  const startedAt = new Date();
  const expiresAt = timerMinutes && timerMinutes > 0
    ? new Date(startedAt.getTime() + timerMinutes * 60 * 1000)
    : new Date(startedAt.getTime() + 24 * 60 * 60 * 1000); // 24h sentinel for untimed quizzes

  const insert: Partial<AttemptRow> = {
    email:              email.toLowerCase(),
    attempt_number:     attemptNumber,
    started_at:         startedAt.toISOString(),
    expires_at:         expiresAt.toISOString(),
    paused_at:          null,
    grace_seconds_used: 0,
    grace_seconds_max:  DEFAULT_GRACE_SECONDS_MAX,
    pause_count:        0,
    max_pauses:         isFinal ? 0 : DEFAULT_MAX_PAUSES,
    is_final:           isFinal,
    pause_log:          [],
  };
  if (key.kind === 'cert') insert.tab_key    = key.tabKey;
  else                     insert.session_id = key.sessionId;

  const { data: created, error } = await sb
    .from('assessment_attempts_in_progress')
    .insert(insert)
    .select()
    .single<AttemptRow>();

  if (error) {
    // Concurrency: another tab inserted the row between our SELECT and INSERT.
    // Re-read and return the winner so both tabs converge on identical state.
    const { data: raced } = await findAttemptRow(sb, email, key, attemptNumber);
    if (raced) return buildView(raced);
    throw new Error(error.message);
  }

  return buildView(created);
}

export type PauseResult =
  | { ok: true;  state: AttemptStateView }
  | { ok: false; code: 'not_found' | 'final_no_pause' | 'no_pauses_left' | 'grace_exhausted' | 'already_paused'; state?: AttemptStateView };

export async function pauseAttempt(
  sb:    SupabaseClient,
  email: string,
  key:   AttemptKey,
  attemptNumber: number,
): Promise<PauseResult> {
  const { data: row } = await findAttemptRow(sb, email, key, attemptNumber);

  if (!row)               return { ok: false, code: 'not_found' };
  if (row.is_final)       return { ok: false, code: 'final_no_pause', state: buildView(row) };
  if (row.paused_at)      return { ok: true,  state: buildView(row) }; // idempotent: already paused
  if (row.pause_count >= row.max_pauses) return { ok: false, code: 'no_pauses_left', state: buildView(row) };
  const graceRemaining = row.grace_seconds_max - row.grace_seconds_used;
  if (graceRemaining <= 0) return { ok: false, code: 'grace_exhausted', state: buildView(row) };

  const { data: updated, error } = await sb
    .from('assessment_attempts_in_progress')
    .update({ paused_at: new Date().toISOString() })
    .eq('id', row.id)
    .select()
    .single<AttemptRow>();
  if (error || !updated) return { ok: false, code: 'not_found' };
  return { ok: true, state: buildView(updated) };
}

export type ResumeResult =
  | { ok: true;  state: AttemptStateView }
  | { ok: false; code: 'not_found' | 'not_paused'; state?: AttemptStateView };

export async function resumeAttempt(
  sb:    SupabaseClient,
  email: string,
  key:   AttemptKey,
  attemptNumber: number,
): Promise<ResumeResult> {
  const { data: row } = await findAttemptRow(sb, email, key, attemptNumber);

  if (!row)            return { ok: false, code: 'not_found' };
  if (!row.paused_at)  return { ok: true,  state: buildView(row) }; // idempotent: already running

  const pausedAtMs       = new Date(row.paused_at).getTime();
  const nowMs            = Date.now();
  const requestedSeconds = Math.max(0, Math.floor((nowMs - pausedAtMs) / 1000));

  // Cap pause duration at remaining grace. If the student stayed away
  // longer than allowed, the wall clock has effectively been ticking for
  // the over-cap portion and we extend expires_at by only the grace slice.
  const graceRemaining = Math.max(0, row.grace_seconds_max - row.grace_seconds_used);
  const cappedSeconds  = Math.min(requestedSeconds, graceRemaining);

  const newExpiresAt = new Date(new Date(row.expires_at).getTime() + cappedSeconds * 1000).toISOString();
  const newGraceUsed = row.grace_seconds_used + cappedSeconds;
  const newPauseCount = row.pause_count + 1;

  const newLogEntry: PauseLogEntry = {
    pausedAt:        row.paused_at,
    resumedAt:       new Date(nowMs).toISOString(),
    durationSeconds: cappedSeconds,
  };
  const newLog: PauseLogEntry[] = [...(Array.isArray(row.pause_log) ? row.pause_log : []), newLogEntry];

  const { data: updated, error } = await sb
    .from('assessment_attempts_in_progress')
    .update({
      paused_at:          null,
      expires_at:         newExpiresAt,
      grace_seconds_used: newGraceUsed,
      pause_count:        newPauseCount,
      pause_log:          newLog,
    })
    .eq('id', row.id)
    .select()
    .single<AttemptRow>();
  if (error || !updated) return { ok: false, code: 'not_found' };
  return { ok: true, state: buildView(updated) };
}

export async function getAttemptState(
  sb:    SupabaseClient,
  email: string,
  key:   AttemptKey,
  attemptNumber: number,
): Promise<AttemptStateView | null> {
  const { data: row } = await findAttemptRow(sb, email, key, attemptNumber);
  return row ? buildView(row) : null;
}

/** Best-effort cleanup. Submit endpoints call this after a successful score write. */
export async function deleteInProgressForKey(
  sb:    SupabaseClient,
  email: string,
  key:   AttemptKey,
): Promise<void> {
  let q = sb.from('assessment_attempts_in_progress').delete().eq('email', email.toLowerCase());
  if (key.kind === 'cert') q = q.eq('tab_key', key.tabKey);
  else                     q = q.eq('session_id', key.sessionId);
  await q;
}
