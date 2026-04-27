/**
 * POST /api/admin/newsletter/campaigns/[id]/retry
 *
 * Re-fires the campaign for every recipient in the recipient_log whose
 * status is 'failed' or 'bounced'. The campaign row itself is NOT changed
 * to 'sending' (we're patching individual rows, not relaunching), but
 * sent_count / failed_count are updated by sendCampaign() at completion.
 *
 * Implementation reuses sendCampaign() with an explicit `recipients` list
 * so segment resolution + dedupe are skipped - the failure set is the
 * source of truth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendCampaign } from '@/src/lib/newsletter/sender';
import type { ResolvedRecipient } from '@/src/lib/newsletter/segments';

interface CampaignRow {
  id:          string;
  subject:     string;
  body:        string;
  target_hub:  'training' | 'modeling' | 'all';
  segment:     string | null;
}

interface FailedRow {
  email: string;
}

interface SubscriberRow {
  email:             string;
  hub:               string;
  unsubscribe_token: string;
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const sb = getServerClient();

  const { data: campaign } = await sb
    .from('newsletter_campaigns')
    .select('id, subject, body, target_hub, segment')
    .eq('id', id)
    .maybeSingle<CampaignRow>();
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const { data: failed } = await sb
    .from('newsletter_recipient_log')
    .select('email')
    .eq('campaign_id', id)
    .in('status', ['failed', 'bounced']);
  const failedRows = (failed ?? []) as FailedRow[];
  if (failedRows.length === 0) {
    return NextResponse.json({ ok: true, attempted: 0, sent: 0, failed: 0 });
  }

  // Resolve email -> subscriber row (need hub + unsubscribe_token)
  const emails = Array.from(new Set(failedRows.map(r => r.email)));
  const { data: subs } = await sb
    .from('newsletter_subscribers')
    .select('email, hub, unsubscribe_token')
    .in('email', emails)
    .eq('status', 'active');
  const subsByEmail = new Map<string, SubscriberRow>();
  for (const s of (subs ?? []) as SubscriberRow[]) {
    if (!subsByEmail.has(s.email)) subsByEmail.set(s.email, s);
  }

  const recipients: ResolvedRecipient[] = emails
    .map(e => subsByEmail.get(e))
    .filter((s): s is SubscriberRow => !!s);

  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, attempted: 0, sent: 0, failed: 0, note: 'No active subscribers among failed recipients' });
  }

  const result = await sendCampaign({
    campaignId: campaign.id,
    subject:    campaign.subject,
    body:       campaign.body,
    targetHub:  campaign.target_hub,
    segment:    'all_active',
    recipients,
  });

  // sendCampaign() set sent_count/failed_count to ONLY the retry batch's
  // counts. Recompute aggregates from the full recipient_log so the
  // campaign reflects total successes after the retry.
  const { data: agg } = await sb
    .from('newsletter_recipient_log')
    .select('status')
    .eq('campaign_id', campaign.id);
  const allRows = (agg ?? []) as Array<{ status: string }>;
  const totalSent   = allRows.filter(r => ['sent', 'opened', 'clicked'].includes(r.status)).length;
  const totalFailed = allRows.filter(r => ['failed', 'bounced'].includes(r.status)).length;
  await sb.from('newsletter_campaigns').update({
    sent_count:   totalSent,
    failed_count: totalFailed,
    status:       totalFailed === allRows.length ? 'failed' : 'sent',
  }).eq('id', campaign.id);

  return NextResponse.json({ ok: true, ...result, totalSent, totalFailed });
}
