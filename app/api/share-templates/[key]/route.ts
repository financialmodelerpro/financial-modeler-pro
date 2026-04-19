import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/share-templates/[key]
 *
 * Public endpoint — returns the admin-configured share template for the
 * given key. Returns `null` when the template doesn't exist or is disabled;
 * the client hook falls back to DEFAULT_TEMPLATES in that case so share
 * buttons never break.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const sb = getServerClient();
  const { data } = await sb
    .from('share_templates')
    .select('template_key, title, template_text, hashtags, mention_brand, mention_founder, active')
    .eq('template_key', key)
    .maybeSingle();

  if (!data || !data.active) {
    return NextResponse.json({ template: null });
  }
  return NextResponse.json({ template: data });
}
