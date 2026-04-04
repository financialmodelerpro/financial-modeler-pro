import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

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
  const planId = req.nextUrl.searchParams.get('plan_id');
  let q = sb.from('pricing_features').select('*').order('category').order('display_order');
  if (planId) q = q.eq('plan_id', planId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ features: data ?? [] });
}

export async function POST(req: NextRequest) {
  const err = await guard();
  if (err) return err;
  try {
    const body = await req.json();
    const sb = getServerClient();
    const { data, error } = await sb.from('pricing_features').insert(body).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ feature: data });
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
    const { data, error } = await sb.from('pricing_features').update(patch).eq('id', id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ feature: data });
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
  const { error } = await sb.from('pricing_features').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
