import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getServerClient } from '@/src/lib/supabase';

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const err = await guard();
  if (err) return err;
  const sb = getServerClient();
  const all = req.nextUrl.searchParams.get('all') !== 'false';
  let q = sb.from('pricing_plans').select('*').order('display_order');
  if (!all) q = q.eq('is_active', true).eq('is_public', true);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ plans: data ?? [] });
}

export async function POST(req: NextRequest) {
  const err = await guard();
  if (err) return err;
  try {
    const body = await req.json();
    const sb = getServerClient();
    const { data, error } = await sb.from('pricing_plans').insert(body).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ plan: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const err = await guard();
  if (err) return err;
  try {
    const { id, ...patch } = await req.json() as { id?: string; [k: string]: unknown };
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const sb = getServerClient();
    const { data, error } = await sb
      .from('pricing_plans')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ plan: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const err = await guard();
  if (err) return err;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('pricing_plans').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
