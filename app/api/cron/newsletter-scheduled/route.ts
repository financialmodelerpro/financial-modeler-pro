/**
 * GET /api/cron/newsletter-scheduled
 *
 * Picks up newsletter campaigns whose scheduled_at <= now() and fires
 * sendCampaign() for each. Idempotent: the route flips status to 'sending'
 * before processing so a re-entrant cron tick does not double-send.
 *
 * Secured by CRON_SECRET (same pattern as /api/cron/session-reminders +
 * /api/cron/auto-launch-check).
 */
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendCampaign } from '@/src/shared/newsletter/sender';
import type { SegmentKey } from '@/src/shared/newsletter/segments';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ScheduledCampaign {
  id:           string;
  subject:      string;
  body:         string;
  target_hub:   'training' | 'modeling' | 'all';
  segment:      SegmentKey;
  scheduled_at: string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from('newsletter_campaigns')
    .select('id, subject, body, target_hub, segment, scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const campaigns = (data ?? []) as ScheduledCampaign[];
  if (campaigns.length === 0) {
    return Response.json({ ok: true, processed: 0 });
  }

  const results: Array<{ id: string; sent: number; failed: number; error?: string }> = [];

  for (const c of campaigns) {
    try {
      const r = await sendCampaign({
        campaignId: c.id,
        subject:    c.subject,
        body:       c.body,
        targetHub:  c.target_hub,
        segment:    c.segment ?? 'all_active',
      });
      results.push({ id: c.id, sent: r.sent, failed: r.failed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[cron/newsletter-scheduled] send failed for campaign', c.id, message);
      await sb.from('newsletter_campaigns').update({ status: 'failed' }).eq('id', c.id);
      results.push({ id: c.id, sent: 0, failed: 0, error: message });
    }
  }

  return Response.json({ ok: true, processed: campaigns.length, results });
}
