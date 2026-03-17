import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getServerClient } from '@/src/lib/supabase';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sb = getServerClient();
    const { data, error } = await sb.from('cms_content').select('*').order('section').order('key');
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ rows: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { section, key, value } = await req.json();
    if (!section || !key) return NextResponse.json({ error: 'section and key required' }, { status: 400 });

    const sb = getServerClient();
    const { data, error } = await sb
      .from('cms_content')
      .upsert({ section, key, value: value ?? '' }, { onConflict: 'section,key' })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ row: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
