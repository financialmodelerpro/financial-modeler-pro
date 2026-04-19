import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/share-templates
 * Admin-only — returns every share template (active + inactive).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const sb = getServerClient();
  const { data, error } = await sb
    .from('share_templates')
    .select('*')
    .order('template_key');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}
