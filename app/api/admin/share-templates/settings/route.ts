import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { DEFAULT_BRAND_MENTION, DEFAULT_FOUNDER_MENTION, type ShareSettings } from '@/src/lib/training/shareTemplates';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/share-templates/settings
 *
 * Admin-only — updates the global mention settings used by the share-
 * template render engine. All four fields are independently updatable.
 * Settings are stored in `training_settings` under:
 *   - share_brand_mention        (text)
 *   - share_founder_mention      (text)
 *   - share_brand_prefix_at      (boolean, stringified)
 *   - share_founder_prefix_at    (boolean, stringified)
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;

  const upserts: { key: string; value: string }[] = [];
  if (typeof body.brand_mention === 'string') {
    // Strip any leading @ — the render engine adds it when
    // share_brand_prefix_at is on. Storing with `@` would produce "@@Foo".
    upserts.push({ key: 'share_brand_mention', value: body.brand_mention.trim().replace(/^@+/, '') });
  }
  if (typeof body.founder_mention === 'string') {
    upserts.push({ key: 'share_founder_mention', value: body.founder_mention.trim().replace(/^@+/, '') });
  }
  if (typeof body.brand_prefix_at === 'boolean') {
    upserts.push({ key: 'share_brand_prefix_at', value: body.brand_prefix_at ? 'true' : 'false' });
  }
  if (typeof body.founder_prefix_at === 'boolean') {
    upserts.push({ key: 'share_founder_prefix_at', value: body.founder_prefix_at ? 'true' : 'false' });
  }

  if (upserts.length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const sb = getServerClient();
  const { error } = await sb.from('training_settings').upsert(upserts, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Re-read the full settings after update so the client sees the final
  // merged state (covers any fields not included in the patch).
  const { data: rows } = await sb
    .from('training_settings')
    .select('key, value')
    .in('key', [
      'share_brand_mention', 'share_founder_mention',
      'share_brand_prefix_at', 'share_founder_prefix_at',
    ]);
  const map = new Map((rows ?? []).map(r => [r.key as string, r.value as string]));
  const settings: ShareSettings = {
    brand_mention:     map.get('share_brand_mention')     || DEFAULT_BRAND_MENTION,
    founder_mention:   map.get('share_founder_mention')   || DEFAULT_FOUNDER_MENTION,
    brand_prefix_at:   map.get('share_brand_prefix_at')   === 'true',
    founder_prefix_at: map.get('share_founder_prefix_at') === 'true',
  };

  return NextResponse.json({ settings });
}
