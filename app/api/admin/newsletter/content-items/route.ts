import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get('type');
  const sb = getServerClient();

  if (type === 'live_session') {
    const { data } = await sb.from('live_sessions')
      .select('id, title, description, scheduled_datetime, timezone, platform, live_url')
      .order('scheduled_datetime', { ascending: false })
      .limit(20);
    return NextResponse.json({ items: (data ?? []).map(s => ({ id: s.id, label: `${s.title} - ${fmtDate(s.scheduled_datetime)}`, data: s })) });
  }

  if (type === 'live_recording') {
    const { data } = await sb.from('live_sessions')
      .select('id, title, description, scheduled_datetime, recording_url')
      .not('recording_url', 'is', null)
      .order('scheduled_datetime', { ascending: false })
      .limit(20);
    return NextResponse.json({ items: (data ?? []).map(s => ({ id: s.id, label: `${s.title} - ${fmtDate(s.scheduled_datetime)}`, data: s })) });
  }

  if (type === 'article') {
    const { data } = await sb.from('articles')
      .select('id, title, slug, excerpt, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(20);
    return NextResponse.json({ items: (data ?? []).map(a => ({ id: a.id, label: `${a.title} - ${fmtDate(a.created_at)}`, data: a })) });
  }

  if (type === 'certification_update') {
    const { count: totalStudents } = await sb.from('training_registrations_meta').select('*', { count: 'exact', head: true });
    const { count: totalCertified } = await sb.from('student_certificates').select('*', { count: 'exact', head: true });
    return NextResponse.json({
      items: [{ id: 'stats', label: 'Current Stats', data: { totalStudents: totalStudents ?? 0, totalCertified: totalCertified ?? 0 } }],
    });
  }

  return NextResponse.json({ items: [] });
}

function fmtDate(iso: string | null) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; }
}
