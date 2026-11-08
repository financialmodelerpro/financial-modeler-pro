/**
 * Reschedule a live-course session (a course session is never cancelled: it
 * always moves to a new date). Pure planning; the admin route applies it.
 *
 *   single     only this session moves to the new start
 *   following  this session AND every later session of the course move by the
 *              same gap (new start minus old start)
 *
 * Every time-driven behaviour reads `scheduled_datetime`, so moving it moves
 * the Join window, the materials and recording release, the time zone table
 * and the pages. The plan also resets what was keyed to the OLD date: the
 * same-day reminder and the attendance sync stamp.
 */

export interface PlanSession { id: string; course_session_no: number | null; scheduled_datetime: string | null; ics_sequence?: number | null }
export interface PlannedMove { id: string; no: number | null; oldStart: string; newStart: string; icsSequence: number }

export function planReschedule(
  sessions: PlanSession[],
  targetId: string,
  newStartIso: string,
  mode: 'single' | 'following',
): { ok: boolean; moves: PlannedMove[]; error?: string } {
  const target = sessions.find((s) => s.id === targetId);
  if (!target) return { ok: false, moves: [], error: 'Session not found.' };
  if (!target.scheduled_datetime) return { ok: false, moves: [], error: 'This session has no date to move from.' };
  const newT = new Date(newStartIso).getTime();
  if (!Number.isFinite(newT)) return { ok: false, moves: [], error: 'The new date and time are not valid.' };
  const oldT = new Date(target.scheduled_datetime).getTime();
  if (newT === oldT) return { ok: false, moves: [], error: 'The new time is the same as the current time.' };
  const gap = newT - oldT;

  const affected = mode === 'single'
    ? [target]
    : sessions.filter((s) => s.scheduled_datetime && (
        s.id === target.id
        || (target.course_session_no != null && s.course_session_no != null
          ? s.course_session_no > target.course_session_no
          : new Date(s.scheduled_datetime).getTime() > oldT)
      ));
  const moves = affected.map((s) => ({
    id: s.id,
    no: s.course_session_no,
    oldStart: new Date(s.scheduled_datetime!).toISOString(),
    newStart: new Date(new Date(s.scheduled_datetime!).getTime() + gap).toISOString(),
    icsSequence: (s.ics_sequence ?? 0) + 1,
  }));
  return { ok: true, moves };
}

/** The columns one move writes. */
export function moveUpdate(m: PlannedMove, now: Date = new Date()): Record<string, unknown> {
  return {
    scheduled_datetime: m.newStart,
    rescheduled_from: m.oldStart,
    rescheduled_at: now.toISOString(),
    ics_sequence: m.icsSequence,
    // Keyed to the old date: the new day gets its own reminder and sync.
    day_reminder_sent_at: null,
    attendance_synced_at: null,
    attendance_sync_error: null,
    updated_at: now.toISOString(),
  };
}
