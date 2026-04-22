import { NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/community-links
 *
 * Public endpoint that returns Training Hub community / discovery links
 * the dashboard renders. Currently:
 *   - whatsappGroupUrl: WhatsApp group invite (sidebar button)
 *   - platformWalkthroughUrl: YouTube walkthrough video shown in the
 *     dashboard hero as "Watch Platform Walkthrough"
 *
 * Empty string for either field means the corresponding UI element is
 * hidden for this deployment.
 */
export async function GET() {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key, value')
      .in('key', ['whatsapp_group_url', 'platform_walkthrough_url']);

    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;

    const rawWa = (map.whatsapp_group_url ?? '').trim();
    const whatsappGroupUrl = /^https:\/\/chat\.whatsapp\.com\//i.test(rawWa) ? rawWa : '';

    const rawWalk = (map.platform_walkthrough_url ?? '').trim();
    const platformWalkthroughUrl = /^https?:\/\//i.test(rawWalk) ? rawWalk : '';

    return NextResponse.json({ whatsappGroupUrl, platformWalkthroughUrl });
  } catch {
    return NextResponse.json({ whatsappGroupUrl: '', platformWalkthroughUrl: '' });
  }
}
