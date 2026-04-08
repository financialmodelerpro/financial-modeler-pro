import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data } = await sb.from('live_playlists').select('*').order('display_order');
  return NextResponse.json({ playlists: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();
  const { data, error } = await sb.from('live_playlists').insert({
    name:          body.name ?? '',
    description:   body.description ?? '',
    thumbnail_url: body.thumbnail_url ?? '',
    display_order: body.display_order ?? 0,
    is_published:  body.is_published ?? true,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ playlist: data });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json() as Record<string, unknown>;
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined)          updates.name = body.name;
  if (body.description !== undefined)   updates.description = body.description;
  if (body.thumbnail_url !== undefined) updates.thumbnail_url = body.thumbnail_url;
  if (body.display_order !== undefined) updates.display_order = body.display_order;
  if (body.is_published !== undefined)  updates.is_published = body.is_published;
  const { error } = await sb.from('live_playlists').update(updates).eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json() as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('live_playlists').delete().eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
