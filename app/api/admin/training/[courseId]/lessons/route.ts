import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as any).role === 'admin');
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { courseId } = await params;
  const { title, youtube_url, description, duration_minutes, display_order, file_url } = await req.json();
  const sb = getServerClient();
  const { data, error } = await sb.from('lessons').insert({ course_id: courseId, title, youtube_url: youtube_url ?? '', description: description ?? '', duration_minutes: duration_minutes ?? 0, display_order: display_order ?? 0, file_url: file_url ?? null }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lesson: data });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, title, youtube_url, description, duration_minutes, display_order, file_url } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const update: Record<string, unknown> = {};
  if (title !== undefined) update.title = title;
  if (youtube_url !== undefined) update.youtube_url = youtube_url;
  if (description !== undefined) update.description = description;
  if (duration_minutes !== undefined) update.duration_minutes = duration_minutes;
  if (display_order !== undefined) update.display_order = display_order;
  if (file_url !== undefined) update.file_url = file_url || null;
  const sb = getServerClient();
  const { error } = await sb.from('lessons').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('lessons').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
