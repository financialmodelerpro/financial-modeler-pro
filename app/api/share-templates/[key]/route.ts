import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { DEFAULT_BRAND_MENTION, DEFAULT_FOUNDER_MENTION } from '@/src/lib/training/shareTemplates';

export const dynamic = 'force-dynamic';

/**
 * GET /api/share-templates/[key]
 *
 * Public endpoint — returns the admin-configured share template for the
 * given key, with brand/founder @-mention text merged in from
 * `training_settings`. Returns `null` when the template doesn't exist or
 * is disabled; the client hook falls back to DEFAULT_TEMPLATES in that
 * case so share buttons never break.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const sb = getServerClient();

  const [templateRes, settingsRes] = await Promise.all([
    sb.from('share_templates')
      .select('template_key, title, template_text, hashtags, mention_brand, mention_founder, active')
      .eq('template_key', key)
      .maybeSingle(),
    sb.from('training_settings')
      .select('key, value')
      .in('key', ['share_brand_mention', 'share_founder_mention']),
  ]);

  if (!templateRes.data || !templateRes.data.active) {
    return NextResponse.json({ template: null });
  }

  const settingsMap = new Map((settingsRes.data ?? []).map(r => [r.key as string, r.value as string]));
  const merged = {
    ...templateRes.data,
    brand_mention:   settingsMap.get('share_brand_mention')   || DEFAULT_BRAND_MENTION,
    founder_mention: settingsMap.get('share_founder_mention') || DEFAULT_FOUNDER_MENTION,
  };

  return NextResponse.json({ template: merged });
}
