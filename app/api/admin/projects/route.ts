import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { serverClient } from '@/src/lib/supabase';

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session?.user)               return { error: 'Unauthorized', status: 401, session: null };
  if (session.user.role !== 'admin') return { error: 'Admin only',   status: 403, session: null };
  return { error: null, status: 200, session };
}

// GET /api/admin/projects — all projects with owner info
export async function GET() {
  const { error, status } = await guard();
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbErr } = await serverClient
    .from('projects')
    .select('id, name, platform, is_archived, created_at, updated_at, user_id, users(email, name)')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ projects: data ?? [] });
}

// DELETE /api/admin/projects — archive or hard-delete a project
export async function DELETE(req: NextRequest) {
  const { error, status, session } = await guard();
  if (error || !session) return NextResponse.json({ error }, { status });

  const { id, hard } = await req.json() as { id: string; hard?: boolean };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  if (hard) {
    const { error: dbErr } = await serverClient.from('projects').delete().eq('id', id);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  } else {
    const { error: dbErr } = await serverClient.from('projects').update({ is_archived: true }).eq('id', id);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  await serverClient.from('admin_audit_log').insert({
    admin_id: session.user.id,
    action:   hard ? 'delete_project' : 'archive_project',
    after_value: { project_id: id },
  });

  return NextResponse.json({ ok: true });
}
