import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getServerClient } from '@/src/lib/supabase';

async function checkAdmin() {
  const session = await getServerSession();
  if (!session?.user || (session.user as any).role !== 'admin') return false;
  return true;
}

export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('modules').select('*').order('display_order');
    return NextResponse.json({ modules: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch modules' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, status, name, description, icon, display_order, launch_date } = await req.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (status !== undefined) update.status = status;
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (icon !== undefined) update.icon = icon;
    if (display_order !== undefined) update.display_order = display_order;
    if (launch_date !== undefined) update.launch_date = launch_date;
    const sb = getServerClient();
    const { error } = await sb.from('modules').update(update).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to update module' }, { status: 500 });
  }
}
