import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { listTemplates, TEMPLATE_VARIABLES } from '@/src/shared/newsletter/templates';

export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const templates = await listTemplates();
  return NextResponse.json({ templates, variables: TEMPLATE_VARIABLES });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { template_key, name, subject_template, body_html, event_type, active } = await req.json() as {
      template_key: string; name: string; subject_template: string; body_html: string;
      event_type?: string | null; active?: boolean;
    };
    if (!template_key?.trim() || !name?.trim() || !subject_template?.trim() || !body_html?.trim()) {
      return NextResponse.json({ error: 'template_key, name, subject_template, body_html required' }, { status: 400 });
    }
    const sb = getServerClient();
    const { data, error } = await sb.from('newsletter_templates').insert({
      template_key: template_key.trim(),
      name:         name.trim(),
      subject_template,
      body_html,
      event_type:   event_type ?? null,
      active:       active ?? true,
    }).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ template: data });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
