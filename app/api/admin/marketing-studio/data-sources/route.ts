import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { COURSES } from '@/src/config/courses';

export const runtime = 'nodejs';

export interface DataSourceItem {
  id: string;
  title: string;
  subtitle?: string;
  session?: string;
  date?: string;
  url?: string;
}

/** GET /api/admin/marketing-studio/data-sources — content for Quick Fill */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();

  const [articlesRes, liveRes] = await Promise.all([
    sb.from('articles')
      .select('id, title, slug, seo_description, category, status, published_at, created_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(100),
    sb.from('live_sessions')
      .select('id, title, description, scheduled_datetime, category, is_published')
      .order('scheduled_datetime', { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  const articles: DataSourceItem[] = (articlesRes.data ?? []).map((a: Record<string, unknown>) => ({
    id: String(a.id),
    title: String(a.title ?? ''),
    subtitle: (a.seo_description as string | null) ?? (a.category as string | null) ?? '',
    date: (a.published_at as string | null) ?? (a.created_at as string | null) ?? '',
    url: `/articles/${a.slug}`,
  }));

  const liveSessions: DataSourceItem[] = (liveRes.data ?? []).map((s: Record<string, unknown>) => ({
    id: String(s.id),
    title: String(s.title ?? ''),
    subtitle: (s.description as string | null) ?? (s.category as string | null) ?? '',
    date: (s.scheduled_datetime as string | null) ?? '',
  }));

  // Flatten all courses' sessions into a single list, tagged with course + session order.
  const trainingSessions: DataSourceItem[] = [];
  for (const [courseKey, course] of Object.entries(COURSES)) {
    course.sessions.forEach((s, idx) => {
      // Strip "Session N: " prefix from title for cleaner subtitle
      const cleanTitle = s.title.replace(/^Session\s+\d+\s*:\s*/i, '').replace(/^Lesson\s+\d+\s*:\s*/i, '');
      trainingSessions.push({
        id: `${courseKey}:${s.id}`,
        title: cleanTitle,
        subtitle: `${course.shortTitle} · ${s.id}`,
        session: `${idx + 1} of ${course.sessions.length}`,
      });
    });
  }

  return NextResponse.json({ articles, liveSessions, trainingSessions });
}
