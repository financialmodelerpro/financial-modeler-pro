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
  const planId = req.nextUrl.searchParams.get('plan_id');
  if (!planId) return NextResponse.json({ error: 'plan_id required' }, { status: 400 });
  const sb = getServerClient();
  const { data, error } = await sb.from('pricing_modules').select('*').eq('plan_id', planId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ modules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const err = await guard();
  if (err) return err;
  try {
    const { plan_id, module_code, is_included } = await req.json() as { plan_id?: string; module_code?: string; is_included?: boolean };
    if (!plan_id || !module_code) return NextResponse.json({ error: 'plan_id and module_code required' }, { status: 400 });
    const sb = getServerClient();
    const { data, error } = await sb
      .from('pricing_modules')
      .upsert({ plan_id, module_code, is_included: is_included ?? true }, { onConflict: 'plan_id,module_code' })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ module: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const err = await guard();
  if (err) return err;
  const planId = req.nextUrl.searchParams.get('plan_id');
  const moduleCode = req.nextUrl.searchParams.get('module_code');
  if (!planId || !moduleCode) return NextResponse.json({ error: 'plan_id and module_code required' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('pricing_modules').delete().eq('plan_id', planId).eq('module_code', moduleCode);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
