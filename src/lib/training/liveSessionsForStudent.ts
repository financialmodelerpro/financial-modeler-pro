export interface LiveSession {
  id: string;
  title: string;
  description?: string;
  session_type: 'upcoming' | 'live' | 'recorded';
  scheduled_datetime?: string | null;
  timezone?: string;
  banner_url?: string | null;
  youtube_url?: string | null;
  live_url?: string | null;
  category?: string;
  instructor_name?: string;
  instructor_title?: string;
  duration_minutes?: number | null;
  playlist?: { id: string; name: string } | null;
  show_join_link_minutes_before?: number;
  tags?: string[];
}

export interface RegistrationStatus {
  registered: boolean;
  joinLinkAvailable: boolean;
}

export interface WatchHistoryEntry {
  session_id: string;
  status: 'in_progress' | 'completed' | string;
  watch_percentage: number;
  watched_at: string;
}

export interface LiveSessionsForStudent {
  upcoming: LiveSession[];              // not registered, soonest first, capped at 3
  upcomingRegistered: LiveSession[];    // registered but not yet started, soonest first, capped at 3
  recorded: LiveSession[];              // past recordings w/ recording URL, newest first, capped at 3
  regStatus: Record<string, RegistrationStatus>;
  watchHistory: Record<string, WatchHistoryEntry>;
}

const EMPTY: LiveSessionsForStudent = {
  upcoming: [], upcomingRegistered: [], recorded: [], regStatus: {}, watchHistory: {},
};

function hasRecording(s: LiveSession): boolean {
  return Boolean(s.youtube_url || s.live_url);
}

/**
 * Client-side fetcher that bundles the three calls needed to render live session
 * cards on the student dashboard. Matches by playlist name if `courseId` is
 * provided (best-effort string contains match — the live_sessions schema has no
 * course_id column, only category / playlist / tags).
 */
export async function getLiveSessionsForStudent(
  email: string,
  courseId?: string,
  limit = 3,
): Promise<LiveSessionsForStudent> {
  if (!email) return EMPTY;

  try {
    const [upRes, recRes, watchRes] = await Promise.all([
      fetch('/api/training/live-sessions?type=upcoming').then(r => r.json() as Promise<{ sessions?: LiveSession[] }>),
      fetch('/api/training/live-sessions?type=recorded').then(r => r.json() as Promise<{ sessions?: LiveSession[] }>),
      fetch(`/api/training/watch-history?email=${encodeURIComponent(email)}`).then(r => r.json() as Promise<{ history?: WatchHistoryEntry[] }>),
    ]);

    const upcomingAll = (upRes.sessions ?? []).filter(s => {
      if (!courseId) return true;
      const hay = `${s.category ?? ''} ${s.playlist?.name ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase();
      return hay.includes(courseId.toLowerCase());
    });

    const recordedAll = (recRes.sessions ?? []).filter(s => {
      if (!hasRecording(s)) return false;
      if (!courseId) return true;
      const hay = `${s.category ?? ''} ${s.playlist?.name ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase();
      return hay.includes(courseId.toLowerCase());
    });

    const ids = [...upcomingAll.map(s => s.id), ...recordedAll.map(s => s.id)];
    let regStatus: Record<string, RegistrationStatus> = {};
    if (ids.length > 0) {
      try {
        const r = await fetch('/api/training/live-sessions/registration-status-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionIds: ids, email }),
        });
        const d = await r.json() as { registrations?: Record<string, RegistrationStatus> };
        regStatus = d.registrations ?? {};
      } catch { /* ignore */ }
    }

    const watchHistory: Record<string, WatchHistoryEntry> = {};
    for (const w of watchRes.history ?? []) watchHistory[w.session_id] = w;

    const upcoming = upcomingAll
      .filter(s => !regStatus[s.id]?.registered)
      .slice(0, limit);

    const upcomingRegistered = upcomingAll
      .filter(s => regStatus[s.id]?.registered)
      .slice(0, limit);

    const recorded = recordedAll.slice(0, limit);

    return { upcoming, upcomingRegistered, recorded, regStatus, watchHistory };
  } catch {
    return EMPTY;
  }
}
