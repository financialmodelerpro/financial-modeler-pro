import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { DEFAULT_BRAND_MENTION, DEFAULT_FOUNDER_MENTION, type ShareSettings } from '@/src/lib/training/shareTemplates';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/share-templates
 *
 * Admin-only — returns every share template (active + inactive) plus the
 * global mention settings (brand + founder @-handle text). Settings are
 * edited separately via PATCH /api/admin/share-templates/settings.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const [templatesRes, settingsRes] = await Promise.all([
    sb.from('share_templates').select('*').order('template_key'),
    sb.from('training_settings')
      .select('key, value')
      .in('key', ['share_brand_mention', 'share_founder_mention']),
  ]);

  if (templatesRes.error) {
    return NextResponse.json({ error: templatesRes.error.message }, { status: 500 });
  }

  const settingsMap = new Map((settingsRes.data ?? []).map(r => [r.key as string, r.value as string]));
  const settings: ShareSettings = {
    brand_mention:   settingsMap.get('share_brand_mention')   || DEFAULT_BRAND_MENTION,
    founder_mention: settingsMap.get('share_founder_mention') || DEFAULT_FOUNDER_MENTION,
  };

  // Inline settings into each template row so the shape matches the public
  // endpoint — admin editors can render a preview without a second fetch.
  const templates = (templatesRes.data ?? []).map(t => ({
    ...t,
    brand_mention:   settings.brand_mention,
    founder_mention: settings.founder_mention,
  }));

  return NextResponse.json({ templates, settings });
}
