import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getStudentProgress } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const email = req.nextUrl.searchParams.get('email') ?? '';
  const regId = req.nextUrl.searchParams.get('regId') ?? '';

  if (!email || !regId) return NextResponse.json({ error: 'email and regId required' }, { status: 400 });

  const sb = getServerClient();

  const [progressRes, profileRes, notesRes, adminNotesRes] = await Promise.all([
    getStudentProgress(email, regId),
    sb.from('student_profiles').select('*').eq('registration_id', regId).maybeSingle(),
    sb.from('student_notes').select('session_key,content,updated_at').eq('registration_id', regId),
    sb.from('student_admin_notes').select('*').eq('registration_id', regId).order('created_at', { ascending: false }),
  ]);

  return NextResponse.json({
    progress: progressRes.data ?? null,
    profile: profileRes.data ?? null,
    notes: notesRes.data ?? [],
    adminNotes: adminNotesRes.data ?? [],
    dataAvailable: progressRes.success,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { regId, note, adminEmail } = await req.json() as { regId: string; note: string; adminEmail: string };
  if (!regId || !note) return NextResponse.json({ error: 'regId and note required' }, { status: 400 });

  const sb = getServerClient();
  await sb.from('student_admin_notes').insert({ registration_id: regId, note, created_by: adminEmail });
  return NextResponse.json({ ok: true });
}
