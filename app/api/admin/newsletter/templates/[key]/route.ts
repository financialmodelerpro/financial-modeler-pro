import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { key } = await ctx.params;

  try {
    const body = await req.json() as Partial<{
      name: string; subject_template: string; body_html: string;
      event_type: string | null; active: boolean;
    }>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string') update.name = body.name.trim();
    if (typeof body.subject_template === 'string') update.subject_template = body.subject_template;
    if (typeof body.body_html === 'string') update.body_html = body.body_html;
    if (body.event_type !== undefined) update.event_type = body.event_type;
    if (typeof body.active === 'boolean') update.active = body.active;

    const sb = getServerClient();
    const { data, error } = await sb.from('newsletter_templates').update(update).eq('template_key', key).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ template: data });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { key } = await ctx.params;
  const sb = getServerClient();
  const { error } = await sb.from('newsletter_templates').delete().eq('template_key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
