import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

const SECTION = 'badge_layout';
const KEY     = 'layout_json';

async function upsertCmsValue(
  sb: ReturnType<typeof import('@/src/lib/shared/supabase').getServerClient>,
  section: string,
  key: string,
  value: string,
) {
  const { data: existing } = await sb
    .from('cms_content')
    .select('id')
    .eq('section', section)
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    await sb.from('cms_content').update({ value }).eq('section', section).eq('key', key);
  } else {
    await sb.from('cms_content').insert({ section, key, value });
  }
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_content')
      .select('value')
      .eq('section', SECTION)
      .eq('key', KEY)
      .maybeSingle();

    let layout: unknown = null;
    try {
      layout = data?.value ? JSON.parse(data.value) : null;
    } catch {
      layout = null;
    }

    return NextResponse.json({ layout });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { layout?: unknown };

    if (!body.layout) {
      return NextResponse.json({ error: 'layout required' }, { status: 400 });
    }

    const sb = getServerClient();
    await upsertCmsValue(sb, SECTION, KEY, JSON.stringify(body.layout));

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
