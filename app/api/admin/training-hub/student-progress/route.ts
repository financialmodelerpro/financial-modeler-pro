import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getStudentProgressFromSupabase as getStudentProgress } from '@/src/hubs/training/lib/progress/progressFromSupabase';
import { getServerClient } from '@/src/core/db/supabase';

interface WatchRow {
  tab_key:           string;
  status:            string | null;
  watch_seconds:     number | null;
  total_seconds:     number | null;
  watch_percentage:  number | null;
  completed_via:     string | null;
  video_load_at:     string | null;
  updated_at:        string | null;
  source:            'cert' | 'live';
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const email = req.nextUrl.searchParams.get('email');
  const regId = req.nextUrl.searchParams.get('regId');
  if (!email || !regId) {
    return NextResponse.json({ error: 'email and regId required' }, { status: 400 });
  }

  const cleanEmail = email.toLowerCase();

  // Run progress + watch fetches in parallel. Watch data is read-only
  // here; the admin acts on it via the /api/admin/sessions/[tabKey]/
  // force-complete-for-student endpoint, not through this one.
  const sb = getServerClient();
  const [progressResult, certWatchRes, liveWatchRes] = await Promise.all([
    getStudentProgress(email, regId),
    sb.from('certification_watch_history')
      .select('tab_key, status, watch_seconds, total_seconds, watch_percentage, completed_via, video_load_at, updated_at')
      .eq('student_email', cleanEmail),
    sb.from('session_watch_history')
      .select('session_id, status, watch_seconds, total_seconds, watch_percentage, completed_via, video_load_at, updated_at')
      .eq('student_email', cleanEmail),
  ]);

  if (!progressResult.success) {
    return NextResponse.json({ error: progressResult.error ?? 'Failed to fetch progress' }, { status: 400 });
  }

  const watch: WatchRow[] = [];
  for (const r of certWatchRes.data ?? []) {
    watch.push({
      tab_key:          String(r.tab_key),
      status:           r.status as string | null,
      watch_seconds:    r.watch_seconds as number | null,
      total_seconds:    r.total_seconds as number | null,
      watch_percentage: r.watch_percentage as number | null,
      completed_via:    r.completed_via as string | null,
      video_load_at:    r.video_load_at as string | null,
      updated_at:       r.updated_at as string | null,
      source:           'cert',
    });
  }
  for (const r of liveWatchRes.data ?? []) {
    watch.push({
      tab_key:          `LIVE_${r.session_id as string}`,
      status:           r.status as string | null,
      watch_seconds:    r.watch_seconds as number | null,
      total_seconds:    r.total_seconds as number | null,
      watch_percentage: r.watch_percentage as number | null,
      completed_via:    r.completed_via as string | null,
      video_load_at:    r.video_load_at as string | null,
      updated_at:       r.updated_at as string | null,
      source:           'live',
    });
  }

  return NextResponse.json({ progress: progressResult.data, watch });
}
