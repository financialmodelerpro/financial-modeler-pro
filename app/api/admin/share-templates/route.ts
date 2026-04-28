import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { DEFAULT_BRAND_MENTION, DEFAULT_FOUNDER_MENTION, type ShareSettings } from '@/src/shared/share/shareTemplates';

export const dynamic = 'force-dynamic';

const SETTINGS_KEYS = [
  'share_brand_mention',
  'share_founder_mention',
  'share_brand_prefix_at',
  'share_founder_prefix_at',
] as const;

/**
 * GET /api/admin/share-templates
 *
 * Admin-only — returns every share template (active + inactive) plus the
 * global mention settings (brand + founder @-handle text + @-prefix
 * toggles). Settings are edited via
 * PATCH /api/admin/share-templates/settings.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const [templatesRes, settingsRes] = await Promise.all([
    sb.from('share_templates').select('*').order('template_key'),
    sb.from('training_settings').select('key, value').in('key', [...SETTINGS_KEYS]),
  ]);

  if (templatesRes.error) {
    return NextResponse.json({ error: templatesRes.error.message }, { status: 500 });
  }

  const settingsMap = new Map((settingsRes.data ?? []).map(r => [r.key as string, r.value as string]));
  const settings: ShareSettings = {
    brand_mention:     settingsMap.get('share_brand_mention')     || DEFAULT_BRAND_MENTION,
    founder_mention:   settingsMap.get('share_founder_mention')   || DEFAULT_FOUNDER_MENTION,
    brand_prefix_at:   settingsMap.get('share_brand_prefix_at')   === 'true',
    founder_prefix_at: settingsMap.get('share_founder_prefix_at') === 'true',
  };

  // Inline settings into each template row so the shape matches the public
  // endpoint — admin editors can render a preview without a second fetch.
  const templates = (templatesRes.data ?? []).map(t => ({
    ...t,
    brand_mention:     settings.brand_mention,
    founder_mention:   settings.founder_mention,
    brand_prefix_at:   settings.brand_prefix_at,
    founder_prefix_at: settings.founder_prefix_at,
  }));

  return NextResponse.json({ templates, settings });
}
