import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sb = getServerClient();
    const section = new URL(req.url).searchParams.get('section');
    let query = sb.from('cms_content').select('*').order('section').order('key');
    if (section) query = query.eq('section', section);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ rows: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { section, key, value } = await req.json();
    if (!section || !key) return NextResponse.json({ error: 'section and key required' }, { status: 400 });

    const sb = getServerClient();

    // Update the specific row - never touch other rows
    const { data: updated } = await sb
      .from('cms_content')
      .update({ value: value ?? '' })
      .eq('section', section)
      .eq('key', key)
      .select()
      .maybeSingle();

    if (updated) return NextResponse.json({ row: updated });

    // Row does not exist yet - insert it
    const { data: inserted, error: insertError } = await sb
      .from('cms_content')
      .insert({ section, key, value: value ?? '' })
      .select()
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });
    return NextResponse.json({ row: inserted });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
