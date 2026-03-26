import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getCourseDetails, updateCourseLink } from '@/src/lib/sheets';

// ── In-memory cache (5 minutes) ───────────────────────────────────────────────
const _cache = new Map<string, { sessions: unknown[]; at: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const course = req.nextUrl.searchParams.get('course') ?? undefined;
  const bust   = req.nextUrl.searchParams.get('bust');
  const key    = course ?? 'all';

  if (!bust) {
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return NextResponse.json({ sessions: hit.sessions });
    }
  }

  try {
    const sessions = await getCourseDetails(course);
    _cache.set(key, { sessions, at: Date.now() });
    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ sessions: [] });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { tabKey, youtubeUrl } = await req.json() as { tabKey: string; youtubeUrl: string };
  if (!tabKey) return NextResponse.json({ error: 'tabKey required' }, { status: 400 });
  const ok = await updateCourseLink(tabKey, youtubeUrl ?? '');
  // Bust all cached entries so the next GET returns fresh data
  _cache.clear();
  return NextResponse.json({ ok });
}
