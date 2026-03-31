import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getCourseDetails, updateCourseLink } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';

// ── In-memory cache (5 minutes) ───────────────────────────────────────────────
const _cache = new Map<string, { sessions: unknown[]; courses: Record<string, unknown>; at: number }>();
const TTL_MS = 5 * 60 * 1000;

async function fetchCourseDescriptions(): Promise<Record<string, unknown>> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('courses')
      .select('category, tagline, full_description, what_you_learn, prerequisites, who_is_this_for, skill_level, duration_hours, language, certificate_description');
    if (!data) return {};
    const map: Record<string, unknown> = {};
    for (const row of data as Record<string, unknown>[]) {
      const cat = (row.category as string | null) ?? '';
      if (cat) {
        map[cat] = {
          tagline:                row.tagline,
          fullDescription:        row.full_description,
          whatYouLearn:           Array.isArray(row.what_you_learn) ? row.what_you_learn : [],
          prerequisites:          row.prerequisites,
          whoIsThisFor:           row.who_is_this_for,
          skillLevel:             row.skill_level,
          durationHours:          row.duration_hours,
          language:               row.language,
          certificateDescription: row.certificate_description,
        };
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** Fetch per-session video durations stored in Supabase (keyed by tabKey). */
async function fetchSessionDurations(): Promise<Record<string, number>> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('session_config')
      .select('tab_key, video_duration_minutes');
    if (!data) return {};
    const map: Record<string, number> = {};
    for (const row of data as { tab_key: string; video_duration_minutes: number }[]) {
      if (row.tab_key) map[row.tab_key] = row.video_duration_minutes ?? 0;
    }
    return map;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const course = req.nextUrl.searchParams.get('course') ?? undefined;
  const bust   = req.nextUrl.searchParams.get('bust');
  const key    = course ?? 'all';

  if (!bust) {
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return NextResponse.json({ sessions: hit.sessions, courses: hit.courses });
    }
  }

  try {
    const [rawSessions, courses, sessionDurations] = await Promise.all([
      getCourseDetails(course),
      fetchCourseDescriptions(),
      fetchSessionDurations(),
    ]);

    // Normalise: ensure videoDuration is always a number.
    // Priority: Apps Script column J > Supabase session_config > 0
    const sessions = rawSessions.map(s => ({
      ...s,
      videoDuration: (s.videoDuration && s.videoDuration > 0)
        ? s.videoDuration
        : (sessionDurations[s.tabKey] ?? 0),
    }));

    _cache.set(key, { sessions, courses, at: Date.now() });
    return NextResponse.json({ sessions, courses });
  } catch {
    return NextResponse.json({ sessions: [], courses: {} });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { tabKey, youtubeUrl, videoDuration } = await req.json() as { tabKey: string; youtubeUrl: string; videoDuration?: number };
  if (!tabKey) return NextResponse.json({ error: 'tabKey required' }, { status: 400 });

  // Save to Apps Script (column J in Form Registry) and Supabase session_config in parallel
  const duration = typeof videoDuration === 'number' ? videoDuration : 0;
  const [ok] = await Promise.all([
    updateCourseLink(tabKey, youtubeUrl ?? '', videoDuration),
    getServerClient()
      .from('session_config')
      .upsert({ tab_key: tabKey, video_duration_minutes: duration, updated_at: new Date().toISOString() }, { onConflict: 'tab_key' }),
  ]);

  // Bust all cached entries so the next GET returns fresh data
  _cache.clear();
  return NextResponse.json({ ok });
}
