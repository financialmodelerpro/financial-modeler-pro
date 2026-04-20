import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/community-links
 *
 * Public endpoint that returns Training Hub community/social links
 * the dashboard sidebar renders. Currently: WhatsApp group invite.
 * Empty string means the feature is disabled for this deployment.
 */
export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key, value')
      .in('key', ['whatsapp_group_url']);

    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;

    const raw = (map.whatsapp_group_url ?? '').trim();
    const whatsappGroupUrl = /^https:\/\/chat\.whatsapp\.com\//i.test(raw) ? raw : '';

    return NextResponse.json({ whatsappGroupUrl });
  } catch {
    return NextResponse.json({ whatsappGroupUrl: '' });
  }
}
