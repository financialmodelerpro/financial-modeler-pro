import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** GET — list all registrations for a session */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();
  const { data, count } = await sb
    .from('session_registrations')
    .select('*', { count: 'exact' })
    .eq('session_id', id)
    .order('registered_at');

  const attended = (data ?? []).filter(r => r.attended).length;
  return NextResponse.json({ registrations: data ?? [], total: count ?? 0, attended });
}

/** PATCH — mark student(s) as attended */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = await req.json() as { regId?: string; attended?: boolean; markAll?: boolean };
  const sb = getServerClient();

  if (body.markAll) {
    await sb.from('session_registrations').update({ attended: true }).eq('session_id', id);
  } else if (body.regId !== undefined) {
    await sb.from('session_registrations').update({ attended: body.attended ?? true }).eq('session_id', id).eq('student_reg_id', body.regId);
  }

  return NextResponse.json({ ok: true });
}
