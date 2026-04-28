import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getCourseDetails, updateCourseLink } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/core/db/supabase';

// ── In-memory cache (5 minutes) ───────────────────────────────────────────────
const _cache = new Map<string, { sessions: unknown[]; courses: Record<string, unknown>; at: number }>();
const TTL_MS = 5 * 60 * 1000;

// ── Fixed course IDs (from migration 017) ────────────────────────────────────
const COURSE_IDS: Record<string, string> = {
  '3SFM': '00000000-0000-0000-0000-0000000035f0',
  'BVM':  '00000000-0000-0000-0000-00000000b600',
};

/**
 * Convert tabKey → { courseId, displayOrder } for the lessons table.
 * e.g. "3SFM_S4" → { courseId: '...35f0', displayOrder: 4 }
 *      "3SFM_Final" → { courseId: '...35f0', displayOrder: 18 }
 *      "BVM_L2"    → { courseId: '...b600', displayOrder: 2 }
 *      "BVM_Final" → { courseId: '...b600', displayOrder: 7 }
 */
function tabKeyToLesson(tabKey: string): { courseId: string; displayOrder: number } | null {
  const sfm = tabKey.match(/^3SFM_S(\d+)$/);
  if (sfm) return { courseId: COURSE_IDS['3SFM'], displayOrder: parseInt(sfm[1]) };
  if (tabKey === '3SFM_Final') return { courseId: COURSE_IDS['3SFM'], displayOrder: 18 };
  const bvm = tabKey.match(/^BVM_L(\d+)$/);
  if (bvm) return { courseId: COURSE_IDS['BVM'], displayOrder: parseInt(bvm[1]) };
  if (tabKey === 'BVM_Final') return { courseId: COURSE_IDS['BVM'], displayOrder: 7 };
  return null;
}

/**
 * Convert (category, displayOrder) → tabKey - reverse of tabKeyToLesson.
 * Used to build the fallback map from the lessons table.
 */
function lessonToTabKey(category: string, displayOrder: number): string | null {
  if (category === '3SFM') {
    if (displayOrder === 18) return '3SFM_Final';
    return `3SFM_S${displayOrder}`;
  }
  if (category === 'BVM') {
    if (displayOrder === 7) return 'BVM_Final';
    return `BVM_L${displayOrder}`;
  }
  return null;
}

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

/**
 * Fetch per-session durations from the lessons table (fallback when Apps Script
 * column J is not yet returned by getCourseDetails).
 * Returns a map of tabKey → duration_minutes.
 */
async function fetchLessonDurations(): Promise<Record<string, number>> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('lessons')
      .select('display_order, duration_minutes, course_id')
      .gt('duration_minutes', 0);
    if (!data) return {};

    // Reverse map: courseId → category
    const idToCategory: Record<string, string> = Object.fromEntries(
      Object.entries(COURSE_IDS).map(([cat, id]) => [id, cat]),
    );

    const map: Record<string, number> = {};
    for (const row of data as { display_order: number; duration_minutes: number; course_id: string }[]) {
      const category = idToCategory[row.course_id];
      if (!category) continue;
      const tk = lessonToTabKey(category, row.display_order);
      if (tk) map[tk] = row.duration_minutes;
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
    const sb = getServerClient();
    const [rawSessions, courses, lessonDurations, bypassRow] = await Promise.all([
      getCourseDetails(course),
      fetchCourseDescriptions(),
      fetchLessonDurations(),
      sb.from('training_settings').select('value').eq('key', 'timer_bypass_enabled').maybeSingle(),
    ]);
    const timerBypassed = bypassRow.data?.value === 'true';

    // videoDuration priority: Apps Script col J > lessons.duration_minutes > 0
    const sessions = rawSessions.map(s => {
      const fromScript = typeof s.videoDuration === 'number' ? s.videoDuration : Number(s.videoDuration) || 0;
      return {
        ...s,
        videoDuration: fromScript > 0 ? fromScript : (lessonDurations[s.tabKey] ?? 0),
      };
    });

    _cache.set(key, { sessions, courses, at: Date.now() });
    return NextResponse.json({ sessions, courses, timerBypassed });
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

  const duration = typeof videoDuration === 'number' ? videoDuration : 0;

  // Save to Apps Script (col J) and lessons table in parallel
  const lessonRef = tabKeyToLesson(tabKey);
  const saves: Promise<unknown>[] = [
    updateCourseLink(tabKey, youtubeUrl ?? '', videoDuration),
  ];
  if (lessonRef && duration > 0) {
    saves.push(
      (async () => {
        await getServerClient()
          .from('lessons')
          .update({ duration_minutes: duration })
          .eq('course_id', lessonRef.courseId)
          .eq('display_order', lessonRef.displayOrder);
      })(),
    );
  }
  await Promise.all(saves);

  _cache.clear();
  return NextResponse.json({ ok: true });
}
