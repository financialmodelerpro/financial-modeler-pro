import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { serverClient } from '@/src/lib/shared/supabase';

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session?.user)               return { error: 'Unauthorized', status: 401, session: null };
  if (session.user.role !== 'admin') return { error: 'Admin only',   status: 403, session: null };
  return { error: null, status: 200, session };
}

// GET — list all announcements
export async function GET() {
  const { error, status } = await guard();
  if (error) return NextResponse.json({ error }, { status });

  const { data, error: dbErr } = await serverClient
    .from('announcements')
    .select('id, title, body, type, active, starts_at, ends_at, created_at')
    .order('created_at', { ascending: false });

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ announcements: data ?? [] });
}

// POST — create announcement
export async function POST(req: NextRequest) {
  const { error, status, session } = await guard();
  if (error || !session) return NextResponse.json({ error }, { status });

  const body = await req.json() as {
    title: string; body: string; type: string;
    active?: boolean; starts_at?: string | null; ends_at?: string | null;
  };
  if (!body.title || !body.body) {
    return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
  }

  const { data, error: dbErr } = await serverClient
    .from('announcements')
    .insert({ ...body, created_by: session.user.id })
    .select()
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ announcement: data });
}

// PATCH — update (toggle active, edit fields)
export async function PATCH(req: NextRequest) {
  const { error, status } = await guard();
  if (error) return NextResponse.json({ error }, { status });

  const body = await req.json() as { id: string; [key: string]: unknown };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { id, ...updates } = body;
  const { data, error: dbErr } = await serverClient
    .from('announcements')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ announcement: data });
}

// DELETE — remove announcement
export async function DELETE(req: NextRequest) {
  const { error, status } = await guard();
  if (error) return NextResponse.json({ error }, { status });

  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error: dbErr } = await serverClient.from('announcements').delete().eq('id', id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
