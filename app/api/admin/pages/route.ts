import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getServerClient } from '@/src/lib/supabase';

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

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  const { id, label, visible, display_order } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const update: Record<string, unknown> = {};
  if (label !== undefined) update.label = label;
  if (visible !== undefined) update.visible = visible;
  if (display_order !== undefined) update.display_order = display_order;
  const { data, error } = await sb.from('site_pages').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ page: data });
}
