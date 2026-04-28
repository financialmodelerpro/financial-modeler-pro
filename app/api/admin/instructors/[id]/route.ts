import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export const dynamic = 'force-dynamic';

async function checkAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();
  const { data, error } = await sb.from('instructors').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ instructor: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const sb = getServerClient();

  // Promoting to default → demote the previous one first.
  if (body.is_default === true) {
    await sb.from('instructors').update({ is_default: false }).eq('is_default', true).neq('id', id);
  }

  const allowed = [
    'name', 'title', 'bio', 'photo_url', 'email', 'linkedin_url',
    'credentials', 'display_order', 'is_default', 'active',
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (body[k] !== undefined) updates[k] = body[k];
  }

  const { data, error } = await sb
    .from('instructors')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep linked sessions' denormalized name/title in sync when the instructor's
  // own name/title changed — legacy readers still pull from those columns.
  if (data && (body.name !== undefined || body.title !== undefined)) {
    await sb
      .from('live_sessions')
      .update({
        instructor_name: data.name,
        instructor_title: data.title,
        updated_at: new Date().toISOString(),
      })
      .eq('instructor_id', id);
  }

  return NextResponse.json({ instructor: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();

  const { count } = await sb
    .from('live_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('instructor_id', id);

  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `Cannot delete. This instructor is linked to ${count} live session${count === 1 ? '' : 's'}. Reassign those sessions to another instructor first.`,
      inUse: true,
      sessionCount: count,
    }, { status: 409 });
  }

  const { error } = await sb.from('instructors').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
