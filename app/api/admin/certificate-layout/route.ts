import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { DEFAULT_CERT_LAYOUT, type CertLayout } from '@/src/hubs/training/lib/certificates/certificateLayout';

const SECTION     = 'certificate_layout';
const KEY         = 'layout_json';
const PDF_KEY     = 'pdf_layout_json';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertCmsValue(sb: ReturnType<typeof import('@/src/core/db/supabase').getServerClient>, section: string, key: string, value: string) {
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

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sb = getServerClient();

    const [layoutRes, pdfLayoutRes] = await Promise.all([
      sb.from('cms_content').select('value').eq('section', SECTION).eq('key', KEY).maybeSingle(),
      sb.from('cms_content').select('value').eq('section', SECTION).eq('key', PDF_KEY).maybeSingle(),
    ]);

    let layout: CertLayout;
    try {
      layout = layoutRes.data?.value ? JSON.parse(layoutRes.data.value) as CertLayout : DEFAULT_CERT_LAYOUT;
    } catch {
      layout = DEFAULT_CERT_LAYOUT;
    }

    let pdfLayout: unknown = null;
    try {
      pdfLayout = pdfLayoutRes.data?.value ? JSON.parse(pdfLayoutRes.data.value) : null;
    } catch {
      pdfLayout = null;
    }

    return NextResponse.json({ layout, pdfLayout });
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
    const body = (await req.json()) as { layout?: CertLayout; pdfLayout?: unknown };

    if (!body.layout && !body.pdfLayout) {
      return NextResponse.json({ error: 'layout or pdfLayout required' }, { status: 400 });
    }

    const sb = getServerClient();
    const ops: Promise<void>[] = [];

    if (body.layout) {
      ops.push(upsertCmsValue(sb, SECTION, KEY, JSON.stringify(body.layout)));
    }
    if (body.pdfLayout) {
      ops.push(upsertCmsValue(sb, SECTION, PDF_KEY, JSON.stringify(body.pdfLayout)));
    }

    await Promise.all(ops);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
