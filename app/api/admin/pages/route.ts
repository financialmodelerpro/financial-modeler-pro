import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return false;
  return (session.user as { role?: string }).role === 'admin';
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data } = await sb.from('site_pages').select('*').order('display_order');
  return NextResponse.json({ pages: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { label, href, visible = true, display_order = 99, can_toggle = true } = await req.json();
  if (!label || !href) return NextResponse.json({ error: 'label and href required' }, { status: 400 });
  const sb = getServerClient();
  const { data, error } = await sb
    .from('site_pages')
    .insert({ label, href, visible, display_order, can_toggle })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ page: data });
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('site_pages').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  const { id, label, href, visible, display_order } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const update: Record<string, unknown> = {};
  if (label !== undefined) update.label = label;
  if (href !== undefined) update.href = href;
  if (visible !== undefined) update.visible = visible;
  if (display_order !== undefined) update.display_order = display_order;
  const { data, error } = await sb.from('site_pages').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ page: data });
}
