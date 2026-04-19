import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { DEFAULT_BRAND_MENTION, DEFAULT_FOUNDER_MENTION } from '@/src/lib/training/shareTemplates';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/share-templates/settings
 *
 * Admin-only — updates the global brand + founder @-mention text used by
 * the share-template render engine. Stored in `training_settings` under
 * keys `share_brand_mention` and `share_founder_mention`.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();

  const upserts: { key: string; value: string }[] = [];
  if (typeof body.brand_mention === 'string') {
    // Strip any leading @ — the render engine adds it when the template's
    // mention_brand flag is on. Storing with the @ would produce `@@Foo`.
    upserts.push({ key: 'share_brand_mention', value: body.brand_mention.trim().replace(/^@+/, '') });
  }
  if (typeof body.founder_mention === 'string') {
    upserts.push({ key: 'share_founder_mention', value: body.founder_mention.trim().replace(/^@+/, '') });
  }

  if (upserts.length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const { error } = await sb.from('training_settings').upsert(upserts, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    settings: {
      brand_mention:   upserts.find(u => u.key === 'share_brand_mention')?.value   ?? DEFAULT_BRAND_MENTION,
      founder_mention: upserts.find(u => u.key === 'share_founder_mention')?.value ?? DEFAULT_FOUNDER_MENTION,
    },
  });
}
