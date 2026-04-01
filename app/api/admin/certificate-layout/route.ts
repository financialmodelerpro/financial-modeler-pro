import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { getServerClient } from '@/src/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ElemPos {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CertLayout {
  logo: ElemPos;
  heading: ElemPos;
  studentBlock: ElemPos;
  signature: ElemPos;
}

// ── Default layout (canvas 680×960) ──────────────────────────────────────────

export const DEFAULT_LAYOUT: CertLayout = {
  logo:         { left: 195, top: 46,  width: 290, height: 80  },
  heading:      { left: 40,  top: 185, width: 600, height: 60  },
  studentBlock: { left: 40,  top: 280, width: 600, height: 380 },
  signature:    { left: 80,  top: 750, width: 520, height: 70  },
};

const SECTION = 'certificate_layout';
const KEY     = 'layout_json';

// ── GET ───────────────────────────────────────────────────────────────────────

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

    if (!data?.value) {
      return NextResponse.json({ layout: DEFAULT_LAYOUT });
    }

    let layout: CertLayout;
    try {
      layout = JSON.parse(data.value) as CertLayout;
    } catch {
      layout = DEFAULT_LAYOUT;
    }

    return NextResponse.json({ layout });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { layout } = (await req.json()) as { layout: CertLayout };
    if (!layout) return NextResponse.json({ error: 'layout required' }, { status: 400 });

    const sb = getServerClient();
    const value = JSON.stringify(layout);

    // Try update first
    const { data: updated } = await sb
      .from('cms_content')
      .update({ value })
      .eq('section', SECTION)
      .eq('key', KEY)
      .select()
      .maybeSingle();

    if (updated) return NextResponse.json({ ok: true });

    // Insert if not exists
    const { error: insertError } = await sb
      .from('cms_content')
      .insert({ section: SECTION, key: KEY, value })
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
