import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** GET — return all templates + branding */
export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();

  const [{ data: templates }, { data: branding }] = await Promise.all([
    sb.from('email_templates').select('*').order('template_key'),
    sb.from('email_branding').select('*').limit(1).single(),
  ]);

  return NextResponse.json({ templates: templates ?? [], branding: branding ?? null });
}
