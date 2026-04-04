import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

const SECTION = 'certificate_settings';
const KEY     = 'auto_generation_enabled';
const TS_KEY  = 'cert_last_generated';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();

  const [settingRes, tsRes] = await Promise.all([
    sb.from('cms_content').select('value').eq('section', SECTION).eq('key', KEY).maybeSingle(),
    sb.from('training_settings').select('value').eq('key', TS_KEY).maybeSingle(),
  ]);

  return NextResponse.json({
    autoEnabled:   settingRes.data?.value === 'true',
    lastGenerated: tsRes.data?.value ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { autoEnabled } = (await req.json()) as { autoEnabled: boolean };
  const sb = getServerClient();

  const { data: existing } = await sb
    .from('cms_content')
    .select('id')
    .eq('section', SECTION)
    .eq('key', KEY)
    .maybeSingle();

  if (existing) {
    await sb.from('cms_content').update({ value: autoEnabled ? 'true' : 'false' })
      .eq('section', SECTION).eq('key', KEY);
  } else {
    await sb.from('cms_content').insert({ section: SECTION, key: KEY, value: autoEnabled ? 'true' : 'false' });
  }

  return NextResponse.json({ ok: true });
}
