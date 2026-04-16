import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

/**
 * GET /api/training/certification-watch?email=x
 * Returns all certification watch history records for a student.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ history: [] });

  const sb = getServerClient();
  const { data } = await sb
    .from('certification_watch_history')
    .select('tab_key, status, started_at, completed_at')
    .eq('student_email', email.toLowerCase());

  return NextResponse.json({ history: data ?? [] });
}

/**
 * POST /api/training/certification-watch
 * Upserts a watch record. Body: { student_email, tab_key, course_id, status }
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    student_email?: string;
    tab_key?: string;
    course_id?: string;
    status?: string;
  };

  const { student_email, tab_key, course_id, status } = body;
  if (!student_email || !tab_key || !course_id || !status) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (status !== 'in_progress' && status !== 'completed') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const sb = getServerClient();
  const record: Record<string, unknown> = {
    student_email: student_email.toLowerCase(),
    tab_key,
    course_id,
    status,
  };
  if (status === 'completed') {
    record.completed_at = new Date().toISOString();
  }

  await sb
    .from('certification_watch_history')
    .upsert(record, { onConflict: 'student_email,tab_key' });

  return NextResponse.json({ success: true });
}
