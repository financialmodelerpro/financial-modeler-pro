import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** GET - return email_branding row */
export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data } = await sb.from('email_branding').select('*').limit(1).single();
  return NextResponse.json({ branding: data });
}

/** PATCH - upsert email_branding */
export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const body = await req.json() as Record<string, unknown>;

  // Get existing row ID (there's only one)
  const { data: existing } = await sb.from('email_branding').select('id').limit(1).single();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['logo_url', 'logo_width', 'logo_alt', 'signature_html', 'footer_text', 'primary_color']) {
    if (body[k] !== undefined) updates[k] = body[k];
  }

  if (existing) {
    const { error } = await sb.from('email_branding').update(updates).eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await sb.from('email_branding').insert(updates);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
